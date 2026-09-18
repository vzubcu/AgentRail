import { providers } from './providers/index.js';
import { fetchWithProviderTimeout } from './providers/timeout.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  MODEL_TIMEOUT_THRESHOLD,
  isProviderTimeoutError,
  isUnsupportedModelResponse,
} from './providers/model-failures.js';
import { getCodexValidationStatus } from './providers/codex-verified-catalog.js';
import { getEffectiveApiKeyFingerprints } from './config.js';
import { isUsingRedis } from './cache/manager.js';
import { onHealthChange } from './router.js';

export type ProviderHealthState = 'missing_key' | 'configured' | 'healthy' | 'unhealthy';

export interface ProviderHealth {
  provider: string;
  state: ProviderHealthState;
  message: string;
  checkedAt: number | null;
  latencyMs?: number | null;
  lastStatusCode?: number | null;
  lastError?: string | null;
  lastSuccessAt?: number | null;
  isStale?: boolean;
  source?: 'runtime' | 'snapshot';
  failureReason?: 'missing_key' | 'no_models' | 'http_error' | 'timeout_error' | 'request_error' | null;
  failureContext?: {
    provider: string;
    envVar: string;
    keyFingerprint: string | null;
    unhealthyKeyFingerprint: string | null;
    attemptedKeyOrder: string[];
    checkedAt: number;
    modelId?: string;
    statusCode?: number | null;
    lastError?: string | null;
  } | null;
}

export interface HealthSummary {
  total: number;
  missing_key: number;
  configured: number;
  healthy: number;
  unhealthy: number;
  lastCheckedAt: number | null;
  redisAvailable: boolean;
}

export type ProviderHealthCheckJobState = 'idle' | 'running' | 'completed' | 'failed';

export interface ProviderHealthCheckJob {
  id: string;
  state: ProviderHealthCheckJobState;
  startedAt: number | null;
  completedAt: number | null;
  total: number;
  completed: number;
  error: string | null;
}

const healthStore = new Map<string, ProviderHealth>();
const PROVIDER_HEALTH_SNAPSHOT_PATH = path.resolve(process.cwd(), '.agentrail', 'provider-health.json');
let persistedHealthSnapshotPathOverride: string | null = null;
let currentAllProvidersHealthJob: ProviderHealthCheckJob = {
  id: '',
  state: 'idle',
  startedAt: null,
  completedAt: null,
  total: providers.length,
  completed: 0,
  error: null,
};

interface ProviderHealthSnapshotFile {
  savedAt: number;
  providers: ProviderHealth[];
}

function getProviderHealthSnapshotPath(): string {
  return persistedHealthSnapshotPathOverride ?? PROVIDER_HEALTH_SNAPSHOT_PATH;
}

function getDefaultHealth(providerName: string, hasKey: boolean): ProviderHealth {
  return {
    provider: providerName,
    state: hasKey ? 'configured' : 'missing_key',
    message: hasKey ? 'Key configured, not tested yet' : 'Missing API key',
    checkedAt: null,
    latencyMs: null,
    lastStatusCode: null,
    lastError: null,
    lastSuccessAt: null,
    isStale: false,
    source: 'runtime',
    failureReason: hasKey ? null : 'missing_key',
    failureContext: null,
  };
}

function normalizeSnapshotHealth(entry: ProviderHealth): ProviderHealth {
  return {
    provider: entry.provider,
    state: entry.state,
    message: entry.message,
    checkedAt: entry.checkedAt ?? null,
    latencyMs: entry.latencyMs ?? null,
    lastStatusCode: entry.lastStatusCode ?? null,
    lastError: entry.lastError ?? null,
    lastSuccessAt: entry.lastSuccessAt ?? null,
    isStale: entry.isStale ?? false,
    source: entry.source ?? 'runtime',
    failureReason: entry.failureReason ?? null,
    failureContext: entry.failureContext ?? null,
  };
}

function buildFailureContext(
  providerName: string,
  envVar: string,
  keyFingerprint: string | null,
  checkedAt: number,
  options: {
    modelId?: string;
    statusCode?: number | null;
    lastError?: string | null;
  } = {},
): NonNullable<ProviderHealth['failureContext']> {
  const attemptedKeyOrder = getEffectiveApiKeyFingerprints(envVar);
  const resolvedKeyFingerprint = keyFingerprint ?? attemptedKeyOrder[0] ?? null;
  return {
    provider: providerName,
    envVar,
    keyFingerprint: resolvedKeyFingerprint,
    unhealthyKeyFingerprint: resolvedKeyFingerprint,
    attemptedKeyOrder,
    checkedAt,
    modelId: options.modelId,
    statusCode: options.statusCode ?? null,
    lastError: options.lastError ?? null,
  };
}

export function getProviderHealth(providerName: string, hasKey: boolean): ProviderHealth {
  const current = healthStore.get(providerName);
  if (!current) {
    const initial = getDefaultHealth(providerName, hasKey);
    healthStore.set(providerName, initial);
    onHealthChange();
    return initial;
  }

  if (!hasKey && current.state !== 'missing_key') {
    const reset = getDefaultHealth(providerName, false);
    healthStore.set(providerName, reset);
    onHealthChange();
    return reset;
  }

  if (hasKey && current.state === 'missing_key') {
    const reset = getDefaultHealth(providerName, true);
    healthStore.set(providerName, reset);
    onHealthChange();
    return reset;
  }

  return current;
}

export function getAllProviderHealth(): ProviderHealth[] {
  return providers.map((provider) => getProviderHealth(provider.name, provider.isAvailable));
}

export function isProviderHealthy(providerName: string): boolean {
  const health = getProviderHealth(
    providerName,
    providers.some((provider) => provider.name === providerName && provider.isAvailable),
  );
  return health.state === 'healthy' && health.isStale !== true;
}

export function getHealthyProviderNames(): string[] {
  return providers
    .filter((provider) => isProviderHealthy(provider.name))
    .map((provider) => provider.name);
}

export async function checkProviderHealth(providerName: string): Promise<ProviderHealth> {
  const provider = providers.find((item) => item.name === providerName);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  if (!provider.isAvailable) {
    const missing = getDefaultHealth(provider.name, false);
    healthStore.set(provider.name, missing);
    onHealthChange();
    return missing;
  }

  const previous = getProviderHealth(provider.name, true);
  if (provider.models.length === 0) {
    if (!provider.usesVerifiedModelCatalog) {
      provider.recoverEmptyCatalogFromOriginalModels();
    }
  }

  const sampleModels = provider.models;
  if (!sampleModels.length) {
    const now = Date.now();
    const codexValidation = provider.name === 'codex' ? getCodexValidationStatus() : null;
    const noModelMessage = codexValidation?.state === 'validating'
      ? 'Codex model validation in progress; no verified models are currently routable'
      : provider.usesVerifiedModelCatalog
        ? 'No verified models configured for provider'
        : 'No models configured for provider';
    const noModel: ProviderHealth = {
      provider: provider.name,
      state: 'unhealthy',
      message: noModelMessage,
      checkedAt: now,
      latencyMs: null,
      lastStatusCode: null,
      lastError: noModelMessage,
      lastSuccessAt: previous.lastSuccessAt ?? null,
      isStale: false,
      source: 'runtime',
      failureReason: 'no_models',
      failureContext: buildFailureContext(provider.name, provider.apiKeyEnvVar, null, now, {
        lastError: noModelMessage,
      }),
    };
    healthStore.set(provider.name, noModel);
    onHealthChange();
    return noModel;
  }

  let lastStatusCode: number | null = null;
  let lastErrorMessage: string | null = null;
  let lastFailureReason: ProviderHealth['failureReason'] = null;
  let lastFailureContext: ProviderHealth['failureContext'] = null;

  for (const sampleModel of sampleModels) {
    const startedAt = Date.now();
    const sampleRouteModel = `${provider.name}/${sampleModel.id}`;

    try {
      let response: Response;

      if (provider.name === 'cohere') {
        response = await fetchWithProviderTimeout(
          { providerName: provider.name, operation: 'health check' },
          `${provider.baseURL}/chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify({
              model: sampleModel.providerModelId,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 8,
              temperature: 0,
            }),
          },
        );
      } else {
        response = await provider.chatCompletion({
          model: sampleRouteModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
          temperature: 0,
          stream: false,
        });
      }

      const now = Date.now();
      const latencyMs = now - startedAt;

      if (response.ok) {
        provider.clearModelFailureState(sampleRouteModel);
        const healthy: ProviderHealth = {
          provider: provider.name,
          state: 'healthy',
          message: `Connectivity test passed with model ${sampleModel.id}`,
          checkedAt: now,
          latencyMs,
          lastStatusCode: response.status,
          lastError: null,
          lastSuccessAt: now,
          isStale: false,
          source: 'runtime',
          failureReason: null,
          failureContext: null,
        };
        healthStore.set(provider.name, healthy);
        onHealthChange();
        return healthy;
      }

      const body = await response.text().catch(() => '');
      if (response.status === 404 || isUnsupportedModelResponse(response.status, body)) {
        provider.markModelUnavailable(sampleRouteModel);
      }
      lastStatusCode = response.status;
      lastErrorMessage = `HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`;
      lastFailureReason = 'http_error';
      const keyContext = provider.getLastRequestKeyContext();
      lastFailureContext = buildFailureContext(provider.name, keyContext.envVar || provider.apiKeyEnvVar, keyContext.keyFingerprint, Date.now(), {
        modelId: sampleModel.id,
        statusCode: response.status,
        lastError: lastErrorMessage,
      });
    } catch (error) {
      if (isProviderTimeoutError(error)) {
        provider.recordTimeoutFailure(sampleRouteModel, MODEL_TIMEOUT_THRESHOLD);
        lastFailureReason = 'timeout_error';
      } else {
        lastFailureReason = 'request_error';
      }
      lastStatusCode = null;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      const keyContext = provider.getLastRequestKeyContext();
      lastFailureContext = buildFailureContext(provider.name, keyContext.envVar || provider.apiKeyEnvVar, keyContext.keyFingerprint, Date.now(), {
        modelId: sampleModel.id,
        lastError: lastErrorMessage,
      });
    }
  }

  const now = Date.now();
  const unhealthy: ProviderHealth = {
    provider: provider.name,
    state: 'unhealthy',
    message: lastErrorMessage ?? 'Health check failed for all configured models',
    checkedAt: now,
    latencyMs: null,
    lastStatusCode,
    lastError: lastErrorMessage,
    lastSuccessAt: previous.lastSuccessAt ?? null,
    isStale: false,
    source: 'runtime',
    failureReason: lastFailureReason,
    failureContext: lastFailureContext,
  };
  healthStore.set(provider.name, unhealthy);
  onHealthChange();
  return unhealthy;
}

export async function checkAllProvidersHealth(): Promise<ProviderHealth[]> {
  const results = await Promise.allSettled(
    providers.map((provider) => checkProviderHealth(provider.name)),
  );

  const healthResults = results.map((result, index): ProviderHealth => {
    const provider = providers[index];
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const reason = (result as PromiseRejectedResult).reason;
    return {
      provider: provider.name,
      state: 'unhealthy',
      message: String(reason),
      checkedAt: Date.now(),
      latencyMs: 0,
      lastStatusCode: null,
      lastError: String(reason),
      lastSuccessAt: null,
      isStale: false,
      source: 'runtime',
      failureReason: 'request_error',
      failureContext: buildFailureContext(provider.name, provider.apiKeyEnvVar, null, Date.now(), {
        lastError: String(reason),
      }),
    };
  });

  onHealthChange();
  return healthResults;
}

export function getAllProvidersHealthCheckJob(): ProviderHealthCheckJob {
  return { ...currentAllProvidersHealthJob };
}

export function startAllProvidersHealthCheck(): ProviderHealthCheckJob {
  if (currentAllProvidersHealthJob.state === 'running') {
    return getAllProvidersHealthCheckJob();
  }

  const startedAt = Date.now();
  currentAllProvidersHealthJob = {
    id: `health-${startedAt}`,
    state: 'running',
    startedAt,
    completedAt: null,
    total: providers.length,
    completed: 0,
    error: null,
  };

  const tasks = providers.map(async (provider) => {
    try {
      return await checkProviderHealth(provider.name);
    } finally {
      currentAllProvidersHealthJob = {
        ...currentAllProvidersHealthJob,
        completed: Math.min(currentAllProvidersHealthJob.completed + 1, currentAllProvidersHealthJob.total),
      };
    }
  });

  void Promise.allSettled(tasks)
    .then(async (results) => {
      const failed = results.filter((result) => result.status === 'rejected');
      await persistProviderHealthSnapshot(getAllProviderHealth());
      currentAllProvidersHealthJob = {
        ...currentAllProvidersHealthJob,
        state: failed.length > 0 ? 'failed' : 'completed',
        completedAt: Date.now(),
        completed: currentAllProvidersHealthJob.total,
        error: failed.length > 0 ? `${failed.length} provider health check(s) failed unexpectedly.` : null,
      };
      onHealthChange();
    })
    .catch((error) => {
      currentAllProvidersHealthJob = {
        ...currentAllProvidersHealthJob,
        state: 'failed',
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      onHealthChange();
    });

  onHealthChange();
  return getAllProvidersHealthCheckJob();
}

export async function loadPersistedProviderHealthSnapshot(): Promise<ProviderHealth[]> {
  try {
    const raw = await readFile(getProviderHealthSnapshotPath(), 'utf-8');
    const parsed = JSON.parse(raw) as ProviderHealthSnapshotFile;
    const snapshotProviders = Array.isArray(parsed.providers) ? parsed.providers : [];
    const loaded = snapshotProviders
      .filter((entry): entry is ProviderHealth => !!entry?.provider && !!entry?.state)
      .map((entry) => {
        const normalized = normalizeSnapshotHealth(entry);
        return {
          ...normalized,
          isStale: true,
          source: 'snapshot' as const,
          message: normalized.checkedAt
            ? `Last known ${normalized.state} state loaded from snapshot; revalidating in background`
            : 'Loaded from snapshot; revalidating in background',
        };
      });

    for (const entry of loaded) {
      healthStore.set(entry.provider, entry);
    }
    onHealthChange();

    return loaded;
  } catch {
    return [];
  }
}

export async function persistProviderHealthSnapshot(healthEntries: ProviderHealth[]): Promise<void> {
  const payload: ProviderHealthSnapshotFile = {
    savedAt: Date.now(),
    providers: healthEntries.map((entry) => ({
      ...normalizeSnapshotHealth(entry),
      isStale: false,
      source: 'runtime',
    })),
  };

  const targetPath = getProviderHealthSnapshotPath();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf-8');
}

export function setPersistedHealthSnapshotForTests(nextPath: string | null): void {
  persistedHealthSnapshotPathOverride = nextPath;
}

export function checkRedisAvailability(): boolean {
  return isUsingRedis();
}

export function getHealthSummary(): HealthSummary {
  const items = getAllProviderHealth();
  const summary: HealthSummary = {
    total: items.length,
    missing_key: 0,
    configured: 0,
    healthy: 0,
    unhealthy: 0,
    lastCheckedAt: null,
    redisAvailable: checkRedisAvailability(),
  };

  for (const item of items) {
    summary[item.state] += 1;
    if (item.checkedAt && (!summary.lastCheckedAt || item.checkedAt > summary.lastCheckedAt)) {
      summary.lastCheckedAt = item.checkedAt;
    }
  }

  return summary;
}
