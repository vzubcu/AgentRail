import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getEffectiveApiKeys } from '../config.js';
import type { ProviderModel } from '../types.js';
import type { BaseProvider, BlockedModelReason, BlockedModelsState } from './base.js';
import { saveBlockedModelState } from './base.js';
import { isProviderTimeoutError, isUnsupportedModelResponse } from './model-failures.js';

const CODEX_PROVIDER_NAME = 'codex';
const CODEX_MODEL_CANDIDATES_ENV = 'CODEX_MODEL_CANDIDATES';
const VERIFIED_CACHE_PATH = path.resolve(process.cwd(), '.agentrail', 'models', 'codex-verified.json');
const VERIFICATION_CONCURRENCY = 2;
const PROBE_TIMEOUT_MS = 8_000;

export interface CodexVerifiedModelMetadata {
  model: ProviderModel;
  verifiedAt: number;
  source: 'probe';
  statusCode: number;
}

export interface CodexTransientFailureMetadata {
  checkedAt: number;
  statusCode?: number | null;
  reason: string;
}

export interface CodexVerifiedCatalogState {
  version: 1;
  savedAt: number;
  supported: Record<string, CodexVerifiedModelMetadata>;
  blockedReasons: Record<string, BlockedModelReason>;
  transientFailures: Record<string, CodexTransientFailureMetadata>;
}

export interface CodexValidationStatus {
  state: 'idle' | 'validating' | 'completed' | 'failed';
  startedAt: number | null;
  finishedAt: number | null;
  candidateCount: number;
  verifiedCount: number;
  blockedCount: number;
  unknownCount: number;
  lastError: string | null;
  blockedReasons: Record<string, BlockedModelReason>;
}

const emptyState = (): CodexVerifiedCatalogState => ({
  version: 1,
  savedAt: Date.now(),
  supported: {},
  blockedReasons: {},
  transientFailures: {},
});

let validationStatus: CodexValidationStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  candidateCount: 0,
  verifiedCount: 0,
  blockedCount: 0,
  unknownCount: 0,
  lastError: null,
  blockedReasons: {},
};

let inFlightValidation: Promise<CodexVerifiedCatalogState> | null = null;

function normalizeState(parsed: Partial<CodexVerifiedCatalogState> | null | undefined): CodexVerifiedCatalogState {
  return {
    version: 1,
    savedAt: typeof parsed?.savedAt === 'number' ? parsed.savedAt : Date.now(),
    supported: parsed?.supported && typeof parsed.supported === 'object' ? parsed.supported : {},
    blockedReasons: parsed?.blockedReasons && typeof parsed.blockedReasons === 'object' ? parsed.blockedReasons : {},
    transientFailures: parsed?.transientFailures && typeof parsed.transientFailures === 'object' ? parsed.transientFailures : {},
  };
}

function sanitizeReason(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function mergeCandidates(primary: ProviderModel[] | null | undefined, fallback: ProviderModel[]): ProviderModel[] {
  const merged = new Map<string, ProviderModel>();
  for (const model of [...(primary ?? []), ...fallback, ...loadConfiguredCodexCandidates()]) {
    merged.set(model.providerModelId || model.id, model);
  }
  return Array.from(merged.values());
}

function parseConfiguredCandidateIds(value: string): string[] {
  return value
    .split(/[\r\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadConfiguredCodexCandidates(): ProviderModel[] {
  const ids = [...new Set(getEffectiveApiKeys(CODEX_MODEL_CANDIDATES_ENV).flatMap(parseConfiguredCandidateIds))];
  return ids.map((id) => ({
    id,
    providerModelId: id,
    context: 200000,
    maxOutput: 100000,
    modality: 'Text',
    capabilities: ['chat'],
  }));
}

function applyStatusFromState(state: CodexVerifiedCatalogState, status: CodexValidationStatus['state'] = validationStatus.state): void {
  const supportedCount = Object.keys(state.supported).length;
  const blockedCount = Object.keys(state.blockedReasons).length;
  validationStatus = {
    ...validationStatus,
    state: status,
    verifiedCount: supportedCount,
    blockedCount,
    unknownCount: Math.max(0, validationStatus.candidateCount - supportedCount - blockedCount),
    blockedReasons: state.blockedReasons,
  };
}

export function getCodexValidationStatus(): CodexValidationStatus {
  return {
    ...validationStatus,
    blockedReasons: { ...validationStatus.blockedReasons },
  };
}

export async function loadCodexVerifiedCatalogState(): Promise<CodexVerifiedCatalogState> {
  try {
    const raw = await readFile(VERIFIED_CACHE_PATH, 'utf-8');
    return normalizeState(JSON.parse(raw) as Partial<CodexVerifiedCatalogState>);
  } catch {
    return emptyState();
  }
}

export async function saveCodexVerifiedCatalogState(state: CodexVerifiedCatalogState): Promise<void> {
  await mkdir(path.dirname(VERIFIED_CACHE_PATH), { recursive: true });
  await writeFile(VERIFIED_CACHE_PATH, JSON.stringify({ ...state, savedAt: Date.now() }, null, 2));
}

export function applyCodexVerifiedCatalog(provider: BaseProvider, state: CodexVerifiedCatalogState): ProviderModel[] {
  for (const modelId of Object.keys(state.blockedReasons)) {
    provider.blockedModelIds.add(modelId);
  }

  const visibleModels = Object.values(state.supported)
    .map((entry) => entry.model)
    .filter((model) => !provider.blockedModelIds.has(model.id));
  provider.updateModels(visibleModels);
  applyStatusFromState(state);
  return visibleModels;
}

async function probeCandidate(provider: BaseProvider, candidate: ProviderModel): Promise<{
  modelId: string;
  outcome: 'supported' | 'blocked' | 'transient';
  statusCode?: number | null;
  reason?: string;
}> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await provider.chatCompletion({
      model: provider.buildRouteModel(candidate.id),
      messages: [{ role: 'user', content: 'Reply with ok.' }],
      max_tokens: 4,
      temperature: 0,
      store: false,
      stream: true,
      signal: timeoutController.signal,
    });

    if (response.ok) {
      return { modelId: candidate.id, outcome: 'supported', statusCode: response.status };
    }

    const body = await response.text().catch(() => '');
    if (isUnsupportedModelResponse(response.status, body)) {
      return { modelId: candidate.id, outcome: 'blocked', statusCode: response.status, reason: sanitizeReason(body) };
    }

    return { modelId: candidate.id, outcome: 'transient', statusCode: response.status, reason: sanitizeReason(body) || `HTTP ${response.status}` };
  } catch (error) {
    if (isProviderTimeoutError(error) || timeoutController.signal.aborted) {
      return { modelId: candidate.id, outcome: 'transient', statusCode: null, reason: 'Verification probe timed out' };
    }
    return { modelId: candidate.id, outcome: 'transient', statusCode: null, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(VERIFICATION_CONCURRENCY, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function verifyCodexCatalog(provider: BaseProvider, options: { candidates?: ProviderModel[] | null } = {}): Promise<CodexVerifiedCatalogState> {
  if (provider.name !== CODEX_PROVIDER_NAME) {
    throw new Error(`Codex verified catalog cannot validate provider: ${provider.name}`);
  }

  if (inFlightValidation) {
    return inFlightValidation;
  }

  inFlightValidation = (async () => {
    const previous = await loadCodexVerifiedCatalogState();
    const candidates = mergeCandidates(options.candidates, provider.originalModels);
    validationStatus = {
      state: 'validating',
      startedAt: Date.now(),
      finishedAt: null,
      candidateCount: candidates.length,
      verifiedCount: Object.keys(previous.supported).length,
      blockedCount: Object.keys(previous.blockedReasons).length,
      unknownCount: Math.max(0, candidates.length - Object.keys(previous.supported).length - Object.keys(previous.blockedReasons).length),
      lastError: null,
      blockedReasons: previous.blockedReasons,
    };

    applyCodexVerifiedCatalog(provider, previous);

    try {
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const nextState: CodexVerifiedCatalogState = {
        version: 1,
        savedAt: Date.now(),
        supported: { ...previous.supported },
        blockedReasons: { ...previous.blockedReasons },
        transientFailures: {},
      };

      const outcomes = await runWithConcurrency(candidates, (candidate) => probeCandidate(provider, candidate));
      const now = Date.now();

      for (const outcome of outcomes) {
        const candidate = byId.get(outcome.modelId);
        if (!candidate) continue;

        if (outcome.outcome === 'supported') {
          nextState.supported[outcome.modelId] = {
            model: candidate,
            verifiedAt: now,
            source: 'probe',
            statusCode: outcome.statusCode ?? 200,
          };
          delete nextState.blockedReasons[outcome.modelId];
          provider.blockedModelIds.delete(outcome.modelId);
          provider.timeoutModelStreaks.delete(outcome.modelId);
          continue;
        }

        if (outcome.outcome === 'blocked') {
          delete nextState.supported[outcome.modelId];
          nextState.blockedReasons[outcome.modelId] = {
            statusCode: outcome.statusCode ?? null,
            reason: outcome.reason,
            checkedAt: now,
          };
          provider.blockedModelIds.add(outcome.modelId);
          provider.timeoutModelStreaks.delete(outcome.modelId);
          continue;
        }

        nextState.transientFailures[outcome.modelId] = {
          checkedAt: now,
          statusCode: outcome.statusCode ?? null,
          reason: outcome.reason ?? 'Transient verification failure',
        };
      }

      await saveCodexVerifiedCatalogState(nextState);
      await saveBlockedModelState(provider.name, {
        ids: Array.from(provider.blockedModelIds),
        timeoutStreaks: Object.fromEntries(provider.timeoutModelStreaks),
        reasons: nextState.blockedReasons,
      } satisfies BlockedModelsState);
      applyCodexVerifiedCatalog(provider, nextState);
      validationStatus = {
        ...validationStatus,
        state: 'completed',
        finishedAt: Date.now(),
        verifiedCount: Object.keys(nextState.supported).length,
        blockedCount: Object.keys(nextState.blockedReasons).length,
        unknownCount: Math.max(0, candidates.length - Object.keys(nextState.supported).length - Object.keys(nextState.blockedReasons).length),
        lastError: null,
        blockedReasons: nextState.blockedReasons,
      };
      return nextState;
    } catch (error) {
      validationStatus = {
        ...validationStatus,
        state: 'failed',
        finishedAt: Date.now(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      applyCodexVerifiedCatalog(provider, previous);
      return previous;
    }
  })();

  try {
    return await inFlightValidation;
  } finally {
    inFlightValidation = null;
  }
}
