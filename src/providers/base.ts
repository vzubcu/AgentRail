import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { ChatCompletionRequest, ProviderModel } from '../types.js';
import { fingerprintApiKey, getEffectiveApiKey, getNextApiKey } from '../config.js';
import { fetchOpenAIModels, mergeFetchedModels, type OpenAIModelEntry } from '../models/sync.js';
import { fetchWithProviderTimeout } from './timeout.js';

function traceProviderEvent(event: string, payload: Record<string, unknown>): void {
  if (process.env.AGENTRAIL_DEBUG_TRACE !== '1') {
    return;
  }
  console.log(`[Trace ${new Date().toISOString()}] ${event} ${JSON.stringify(payload)}`);
}

export interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKeyEnvVar: string;
  models: ProviderModel[];
  headers?: Record<string, string>;
  website?: string;
  envVars?: string[];
  apiKeyInstructions?: string[];
}

export interface BlockedModelsState {
  ids: string[];
  timeoutStreaks?: Record<string, number>;
  reasons?: Record<string, BlockedModelReason>;
}

export interface BlockedModelReason {
  statusCode?: number | null;
  reason?: string;
  checkedAt?: number;
}

export interface ProviderRequestKeyContext {
  envVar: string;
  keyFingerprint: string | null;
  keySource: 'managed_or_env' | 'oauth' | 'unknown';
}

function serializeBlockedModelState(ids: Set<string>, timeoutStreaks: Map<string, number>): BlockedModelsState {
  return {
    ids: Array.from(ids),
    timeoutStreaks: Object.fromEntries(
      Array.from(timeoutStreaks.entries()).filter(([, count]) => Number.isFinite(count) && count > 0),
    ),
  };
}

export abstract class BaseProvider {
  readonly name: string;
  readonly baseURL: string;
  models: ProviderModel[];
  readonly originalModels: ProviderModel[];
  blockedModelIds: Set<string> = new Set();
  timeoutModelStreaks: Map<string, number> = new Map();
  readonly apiKeyEnvVar: string;
  readonly customHeaders: Record<string, string>;
  readonly website?: string;
  readonly envVars: string[];
  readonly apiKeyInstructions: string[];
  private lastRequestKeyContext: ProviderRequestKeyContext = {
    envVar: '',
    keyFingerprint: null,
    keySource: 'unknown',
  };

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.baseURL = config.baseURL;
    this.models = config.models;
    this.originalModels = [...config.models];
    this.apiKeyEnvVar = config.apiKeyEnvVar;
    this.customHeaders = config.headers ?? {};
    this.website = config.website;
    this.envVars = config.envVars ?? [config.apiKeyEnvVar];
    this.apiKeyInstructions = config.apiKeyInstructions ?? [];
  }

  updateModels(models: ProviderModel[]): void {
    this.models = models;
  }

  get apiKey(): string | undefined {
    return getEffectiveApiKey(this.apiKeyEnvVar);
  }

  protected getRequestApiKey(): string | undefined {
    return getNextApiKey(this.apiKeyEnvVar);
  }

  protected rememberRequestKeyContext(apiKey: string | undefined, source: ProviderRequestKeyContext['keySource'] = 'managed_or_env'): void {
    this.lastRequestKeyContext = {
      envVar: this.apiKeyEnvVar,
      keyFingerprint: apiKey ? fingerprintApiKey(apiKey) : null,
      keySource: source,
    };
  }

  getLastRequestKeyContext(): ProviderRequestKeyContext {
    return { ...this.lastRequestKeyContext };
  }

  buildAuthHeaders(apiKey = this.getRequestApiKey()): Record<string, string> {
    this.rememberRequestKeyContext(apiKey);
    return apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
          ...this.customHeaders,
        }
      : {
          ...this.customHeaders,
        };
  }

  async getRequestHeaders(contentType?: string): Promise<Record<string, string> | undefined> {
    const apiKey = this.getRequestApiKey();
    const headers = this.buildAuthHeaders(apiKey);
    if (!apiKey && Object.keys(headers).length === 0) {
      return undefined;
    }
    return contentType ? { 'Content-Type': contentType, ...headers } : headers;
  }

  getEndpointUrl(pathname: string): string | null {
    const normalizedPath = pathname.replace(/^\/v1(?=\/|$)/, '');
    return `${this.baseURL}${normalizedPath}`;
  }

  async getModelSyncAuthHeaders(): Promise<Record<string, string> | undefined> {
    const apiKey = this.apiKey;
    return apiKey ? this.buildAuthHeaders(apiKey) : undefined;
  }

  getModelSyncUrl(): string {
    return `${this.baseURL}/models`;
  }

  protected async fetchModelSyncEntries(headers: Record<string, string>): Promise<OpenAIModelEntry[]> {
    return fetchOpenAIModels(this.getModelSyncUrl(), headers);
  }

  async syncModelsForCatalog(): Promise<ProviderModel[] | null> {
    const headers = await this.getModelSyncAuthHeaders();
    if (!headers) {
      return null;
    }

    const fetched = await this.fetchModelSyncEntries(headers);
    return mergeFetchedModels(fetched, this.originalModels);
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  protected normalizeBareModelId(modelId: string): string {
    return modelId.startsWith(`${this.name}/`) ? modelId.slice(this.name.length + 1) : modelId;
  }

  buildRouteModel(modelId: string): string {
    return `${this.name}/${this.normalizeBareModelId(modelId)}`;
  }

  supportsModel(modelId: string): ProviderModel | undefined {
    const bareModelId = this.normalizeBareModelId(modelId);
    return this.models.find((model) => model.id === bareModelId);
  }

  resolveModelId(modelId: string): string {
    const bareModelId = this.normalizeBareModelId(modelId);
    const model = this.supportsModel(bareModelId);
    return model?.providerModelId ?? bareModelId;
  }

  async chatCompletion(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<Response> {
    const url = `${this.baseURL}/chat/completions`;
    const body = this.transformRequest(request);
    const apiKey = this.getRequestApiKey();
    this.rememberRequestKeyContext(apiKey);
    const startedAt = Date.now();
    const routeModel = typeof body.model === 'string' ? body.model : this.resolveModelId(request.model);

    traceProviderEvent('provider.request', {
      provider: this.name,
      operation: 'chat completion',
      requestedModel: request.model,
      routeModel,
      stream: !!request.stream,
      hasApiKey: !!apiKey,
    });

    try {
      const response = await fetchWithProviderTimeout(
        { providerName: this.name, operation: 'chat completion' },
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.buildAuthHeaders(apiKey),
          },
          body: JSON.stringify(body),
          signal: options?.signal,
        },
      );
      traceProviderEvent('provider.response', {
        provider: this.name,
        operation: 'chat completion',
        routeModel,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        contentType: response.headers.get('content-type') ?? '',
        requestId: response.headers.get('x-request-id') ?? response.headers.get('openai-request-id') ?? null,
      });
      return response;
    } catch (err) {
      traceProviderEvent('provider.error', {
        provider: this.name,
        operation: 'chat completion',
        routeModel,
        durationMs: Date.now() - startedAt,
        errorName: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  protected transformRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    return {
      ...request,
      model: this.resolveModelId(request.model),
    };
  }

  listModels(): ProviderModel[] {
    return this.models;
  }

  get canRecoverEmptyCatalogFromOriginalModels(): boolean {
    return false;
  }

  get usesVerifiedModelCatalog(): boolean {
    return false;
  }

  recoverEmptyCatalogFromOriginalModels(): boolean {
    if (!this.canRecoverEmptyCatalogFromOriginalModels || this.models.length > 0 || this.originalModels.length === 0) {
      return false;
    }

    this.blockedModelIds.clear();
    this.timeoutModelStreaks.clear();
    this.models = [...this.originalModels];
    void saveBlockedModelState(this.name, serializeBlockedModelState(this.blockedModelIds, this.timeoutModelStreaks)).catch(() => {});
    return true;
  }

  markModelUnavailable(modelId: string): void {
    const bareModelId = this.normalizeBareModelId(modelId);
    this.blockedModelIds.add(bareModelId);
    this.timeoutModelStreaks.delete(bareModelId);
    this.models = this.models.filter((model) => model.id !== bareModelId);
    void saveBlockedModelState(this.name, serializeBlockedModelState(this.blockedModelIds, this.timeoutModelStreaks)).catch(() => {});
  }

  isModelBlocked(modelId: string): boolean {
    return this.blockedModelIds.has(this.normalizeBareModelId(modelId));
  }

  getTimeoutFailureCount(modelId: string): number {
    return this.timeoutModelStreaks.get(this.normalizeBareModelId(modelId)) ?? 0;
  }

  recordTimeoutFailure(modelId: string, threshold: number): number {
    const bareModelId = this.normalizeBareModelId(modelId);
    const nextCount = (this.timeoutModelStreaks.get(bareModelId) ?? 0) + 1;
    this.timeoutModelStreaks.set(bareModelId, nextCount);

    if (nextCount >= threshold) {
      this.markModelUnavailable(bareModelId);
      return nextCount;
    }

    void saveBlockedModelState(this.name, serializeBlockedModelState(this.blockedModelIds, this.timeoutModelStreaks)).catch(() => {});
    return nextCount;
  }

  clearModelFailureState(modelId: string): void {
    const bareModelId = this.normalizeBareModelId(modelId);
    if (!this.timeoutModelStreaks.has(bareModelId)) {
      return;
    }

    this.timeoutModelStreaks.delete(bareModelId);
    void saveBlockedModelState(this.name, serializeBlockedModelState(this.blockedModelIds, this.timeoutModelStreaks)).catch(() => {});
  }
}

const BLOCKED_CACHE_DIR = path.resolve(process.cwd(), '.agentrail', 'models');

export async function loadBlockedModelState(providerName: string): Promise<{ ids: Set<string>; timeoutStreaks: Map<string, number> }> {
  try {
    const raw = await readFile(path.join(BLOCKED_CACHE_DIR, `${providerName}-blocked.json`), 'utf-8');
    const parsed = JSON.parse(raw) as BlockedModelsState;
    const timeoutStreaks = new Map<string, number>();

    for (const [modelId, count] of Object.entries(parsed.timeoutStreaks ?? {})) {
      if (Number.isFinite(count) && count > 0) {
        timeoutStreaks.set(modelId, count);
      }
    }

    return {
      ids: new Set(parsed.ids ?? []),
      timeoutStreaks,
    };
  } catch {
    return {
      ids: new Set(),
      timeoutStreaks: new Map(),
    };
  }
}

export async function loadBlockedModelIds(providerName: string): Promise<Set<string>> {
  const state = await loadBlockedModelState(providerName);
  return state.ids;
}

export async function saveBlockedModelState(providerName: string, state: BlockedModelsState): Promise<void> {
  await mkdir(BLOCKED_CACHE_DIR, { recursive: true });
  await writeFile(
    path.join(BLOCKED_CACHE_DIR, `${providerName}-blocked.json`),
    JSON.stringify(state, null, 2),
  );
}

export async function saveBlockedModelIds(providerName: string, ids: Set<string>): Promise<void> {
  await saveBlockedModelState(providerName, serializeBlockedModelState(ids, new Map()));
}
