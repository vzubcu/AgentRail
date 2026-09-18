import type { BaseProvider } from './providers/base.js';
import type { ChatCompletionRequest, ProviderModel } from './types.js';
import { findProvidersForModel, getAvailableProviders } from './providers/index.js';
import { getProviderHealth, isProviderHealthy } from './health.js';
import { usageTracker } from './usage-tracker.js';
import { recordVirtualModelRouteTrace, type VirtualModelTraceAttempt, type VirtualModelTraceExcludedCandidate } from './virtual-model-traces.js';
import { inferCapabilities, type ModelCapability } from './models/capabilities.js';
import {
  MODEL_TIMEOUT_THRESHOLD,
  getConcreteRouteModel,
  isProviderTimeoutError,
  isUnsupportedModelResponse,
} from './providers/model-failures.js';
import {
  FALLBACK_AUTO_MODEL_ID,
  FALLBACK_FILES_MODEL_ID,
  isVirtualModelId,
  resolveAlias,
  getVirtualModelRoutingConfig,
  hasVirtualModelsInDb,
  getVirtualModels,
  updateVirtualModelMemberRuntimeState,
  type VirtualModelSelection,
  type VirtualModelStickyMode,
  type VirtualModelAutoProtection,
} from './virtual-models.js';
import { hasTextualToolCallSignals } from './anthropic-bridge.js';
import { applyCompression } from './compression/compress.js';
import { getCompressionConfigSync } from './compression/config.js';

export interface RouterOptions {
  strategy?: 'round-robin' | 'random' | 'priority';
  maxRetries?: number;
}

interface RouteCandidate {
  provider: BaseProvider;
  modelId: string;
  selection?: VirtualModelSelection;
}

interface VirtualModelRequestMeta {
  stickyKey?: string;
}

export interface RouteChatCompletionResult {
  response: Response;
  provider: BaseProvider;
  routeModel: string;
  virtualModelId?: string;
  virtualModelTraceId?: string;
}

export const AUTO_MODEL_ID = FALLBACK_AUTO_MODEL_ID;
export const FILES_MODEL_ID = FALLBACK_FILES_MODEL_ID;
export const AUTO_MODEL_ALIASES = new Set<string>();

function refreshAutoModelAliases(): void {
  AUTO_MODEL_ALIASES.clear();
  if (!hasVirtualModelsInDb()) {
    for (const alias of [
      'gpt-4o',
      'gpt-5.4',
      'gpt-5.5',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4.5-preview',
      'o3-mini',
      'o4-mini',
    ]) {
      AUTO_MODEL_ALIASES.add(alias);
    }
  } else {
    for (const vm of getVirtualModels()) {
      for (const alias of vm.autoAliases) {
        AUTO_MODEL_ALIASES.add(alias);
      }
    }
  }
}

refreshAutoModelAliases();

let roundRobinIndex = 0;

function modelHasCapability(model: ProviderModel, capability: ModelCapability): boolean {
  return inferCapabilities(model).includes(capability);
}

function providerHasVisionModels(provider: BaseProvider): boolean {
  return provider.models.some((model) => modelHasCapability(model, 'vision'));
}

function requestHasImageInputs(request: ChatCompletionRequest): boolean {
  return request.messages.some((message) => {
    if (typeof message.content === 'string') return false;
    return Array.isArray(message.content)
      && message.content.some((part) => part.type === 'image_url' || part.type === 'input_image');
  });
}

function selectProvider(providers: BaseProvider[], strategy: string): BaseProvider {
  if (providers.length === 1) return providers[0];

  switch (strategy) {
    case 'random':
      return providers[Math.floor(Math.random() * providers.length)];
    case 'round-robin':
      roundRobinIndex = (roundRobinIndex + 1) % providers.length;
      return providers[roundRobinIndex];
    case 'priority':
    default:
      return providers[0];
  }
}

// Memoization cache for hot path functions
// TTL: 10 seconds - balances freshness with performance
const HEALTH_CACHE_TTL_MS = 10000;

interface CachedValue<T> {
  value: T;
  expires: number;
}

let healthyProvidersCache: CachedValue<BaseProvider[]> | null = null;
let autoRouteCandidatesCache: CachedValue<RouteCandidate[]> | null = null;
let autoRouteToolCandidatesCache: CachedValue<RouteCandidate[]> | null = null;

function invalidateHealthCache(): void {
  healthyProvidersCache = null;
  autoRouteCandidatesCache = null;
  autoRouteToolCandidatesCache = null;
}

// Listen for health changes to invalidate cache
// This is called from health.ts when health state changes
export function onHealthChange(): void {
  invalidateHealthCache();
}

function getHealthyProviders(): BaseProvider[] {
  const now = Date.now();
  if (healthyProvidersCache && healthyProvidersCache.expires > now) {
    return healthyProvidersCache.value;
  }
  const providers = getAvailableProviders().filter((provider) => isProviderHealthy(provider.name));
  healthyProvidersCache = { value: providers, expires: now + HEALTH_CACHE_TTL_MS };
  return providers;
}

function getProviderLatencyRank(provider: BaseProvider): number {
  const latencyMs = getProviderHealth(provider.name, provider.isAvailable).latencyMs;
  return typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? latencyMs : Number.POSITIVE_INFINITY;
}

function providerSupportsToolCalls(provider: BaseProvider): boolean {
  // If the provider's first model has capabilities defined, check for 'tool_calls'
  const model = provider.models[0];
  if (model && model.capabilities) {
    return model.capabilities.includes('tool_calls');
  }
  // Fallback to hardcoded list
  const toolCapableProviders = new Set(['openai', 'azure', 'anthropic', 'groq', 'cohere', 'replicate']);
  return toolCapableProviders.has(provider.name.toLowerCase());
}

function sortRouteCandidatesByLatency(candidates: RouteCandidate[]): RouteCandidate[] {
  return [...candidates].sort((left, right) => getProviderLatencyRank(left.provider) - getProviderLatencyRank(right.provider));
}

function getAutoRouteCandidates(): RouteCandidate[] {
  const now = Date.now();
  if (autoRouteCandidatesCache && autoRouteCandidatesCache.expires > now) {
    return autoRouteCandidatesCache.value;
  }
  const candidates = sortRouteCandidatesByLatency(
    getHealthyProviders()
      .filter((provider) => provider.models.length > 0)
      .map((provider) => ({
        provider,
        modelId: `${provider.name}/${provider.models[0].id}`,
      })),
  );
  autoRouteCandidatesCache = { value: candidates, expires: now + HEALTH_CACHE_TTL_MS };
  return candidates;
}

function getAutoRouteCandidatesWithToolCalls(): RouteCandidate[] {
  const now = Date.now();
  if (autoRouteToolCandidatesCache && autoRouteToolCandidatesCache.expires > now) {
    return autoRouteToolCandidatesCache.value;
  }
  const candidates = sortRouteCandidatesByLatency(
    getHealthyProviders()
      .filter((provider) => provider.models.length > 0 && providerSupportsToolCalls(provider))
      .map((provider) => ({
        provider,
        modelId: `${provider.name}/${provider.models[0].id}`,
      })),
  );
  autoRouteToolCandidatesCache = { value: candidates, expires: now + HEALTH_CACHE_TTL_MS };
  return candidates;
}

function getCapabilityRouteCandidates(capability: ModelCapability): RouteCandidate[] {
  return getHealthyProviders().flatMap((provider) => provider.models
    .filter((model) => modelHasCapability(model, capability))
    .map((model) => ({
      provider,
      modelId: `${provider.name}/${model.id}`,
    })));
}

function recordNonSuccessResponse(provider: BaseProvider, routeModel: string, response: Response, body: string): void {
  if (response.status === 404 || isUnsupportedModelResponse(response.status, body)) {
    provider.markModelUnavailable(routeModel);
  }
}

function recordProviderError(provider: BaseProvider, routeModel: string, error: unknown): void {
  if (isProviderTimeoutError(error)) {
    provider.recordTimeoutFailure(routeModel, MODEL_TIMEOUT_THRESHOLD);
  }
}

function hasUsableAssistantContent(payload: unknown): boolean {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  return choices.some((choice) => {
    const message = (choice as { message?: unknown })?.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return true;
    }

    if (Array.isArray(message.content) && message.content.length > 0) {
      return true;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return true;
    }

    return typeof message.function_call === 'object' && message.function_call !== null;
  });
}

function describeUnusableChatResponse(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return 'empty assistant content: response has no choices';
  }

  if (hasUsableAssistantContent(payload)) {
    return null;
  }

  const firstChoice = choices[0] as { finish_reason?: unknown; message?: unknown };
  const message = firstChoice.message as Record<string, unknown> | undefined;
  const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : 'unknown';
  const hasReasoning = typeof message?.reasoning === 'string' && message.reasoning.length > 0;
  return `empty assistant content: finish_reason=${finishReason}${hasReasoning ? ', reasoning present' : ''}`;
}

function describeInvalidToolCallResponse(payload: unknown, request: ChatCompletionRequest): string | null {
  if (!Array.isArray(request.tools) || request.tools.length === 0) {
    return null;
  }

  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0] as { finish_reason?: unknown; message?: unknown };
  const message = firstChoice.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') {
    return null;
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return null;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  if (!hasTextualToolCallSignals(content)) {
    return null;
  }

  const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : 'unknown';
  return `textual tool-call content without structured tool_calls: finish_reason=${finishReason}`;
}

async function getUnusableChatResponseReason(response: Response, request: ChatCompletionRequest): Promise<string | null> {
  if (request.stream === true) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  try {
    const payload = await response.clone().json() as unknown;
    return describeInvalidToolCallResponse(payload, request) ?? describeUnusableChatResponse(payload);
  } catch {
    return null;
  }
}
function normalizeTrackedModelId(providerName: string, modelId: string): string {
  let normalized = modelId;
  const prefix = `${providerName}/`;
  while (normalized.startsWith(prefix)) {
    normalized = normalized.slice(prefix.length);
  }
  return normalized;
}

function toProviderChatRequest(request: ChatCompletionRequest, model: string): ChatCompletionRequest {
  const { __agentrail: _internalMeta, ...providerRequest } = request as ChatCompletionRequest & { __agentrail?: unknown };
  const compressed = applyCompression(providerRequest, getCompressionConfigSync());
  return {
    ...providerRequest,
    messages: compressed.messages,
    model,
  };
}

function applyVirtualModelSystemPrompt(request: ChatCompletionRequest, systemPrompt: string | null | undefined): ChatCompletionRequest {
  if (typeof systemPrompt !== 'string' || systemPrompt.length === 0) {
    return request;
  }

  return {
    ...request,
    messages: [
      { role: 'system', content: systemPrompt },
      ...request.messages,
    ],
  };
}
function getVirtualModelMeta(request: ChatCompletionRequest): VirtualModelRequestMeta {
  const raw = request.__agentrail;
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const meta = raw as Record<string, unknown>;
  const stickyKey = typeof meta.stickyKey === 'string' && meta.stickyKey.trim()
    ? meta.stickyKey.trim()
    : undefined;
  return { stickyKey };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sortCandidatesByPriority(candidates: RouteCandidate[]): RouteCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftPriority = left.selection?.priority ?? Number.POSITIVE_INFINITY;
    const rightPriority = right.selection?.priority ?? Number.POSITIVE_INFINITY;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.modelId.localeCompare(right.modelId);
  });
}

function chooseWeightedCandidate(candidates: RouteCandidate[], randomValue: number): RouteCandidate {
  const totalWeight = candidates.reduce((sum, candidate) => sum + Math.max(1, candidate.selection?.weight ?? 1), 0);
  let target = randomValue * totalWeight;
  for (const candidate of candidates) {
    target -= Math.max(1, candidate.selection?.weight ?? 1);
    if (target < 0) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

function chooseCandidateFromPool(
  candidates: RouteCandidate[],
  strategy: RouterOptions['strategy'],
  stickyMode: VirtualModelStickyMode,
  stickyKey?: string,
): RouteCandidate {
  const sorted = sortCandidatesByPriority(candidates);
  if (sorted.length === 1) {
    return sorted[0];
  }

  if (stickyMode === 'request-key' && stickyKey) {
    const hashed = hashString(stickyKey);
    if (strategy === 'random') {
      return chooseWeightedCandidate(sorted, hashed / 0xffffffff);
    }
    return sorted[hashed % sorted.length];
  }

  switch (strategy) {
    case 'random':
      return chooseWeightedCandidate(sorted, Math.random());
    case 'round-robin': {
      roundRobinIndex = (roundRobinIndex + 1) % sorted.length;
      return sorted[roundRobinIndex];
    }
    case 'priority':
    default:
      return sorted[0];
  }
}

function isSelectionAutoDisabled(selection: VirtualModelSelection, now = Date.now()): boolean {
  return Boolean(selection.memberState?.autoDisabledUntil && selection.memberState.autoDisabledUntil > now);
}

async function recordVirtualModelMemberSuccess(virtualModelId: string, selection: VirtualModelSelection): Promise<void> {
  await updateVirtualModelMemberRuntimeState(virtualModelId, selection.provider, selection.modelId, (current) => ({
    ...current,
    memberState: {
      consecutiveFailures: 0,
      lastFailureAt: current.memberState?.lastFailureAt ?? null,
      autoDisabledUntil: null,
      lastAutoDisabledAt: current.memberState?.lastAutoDisabledAt ?? null,
      lastRecoveredAt: current.memberState?.lastRecoveredAt ?? null,
      lastSuccessAt: Date.now(),
    },
  }));
}

async function recordVirtualModelMemberFailure(
  virtualModelId: string,
  selection: VirtualModelSelection,
  autoProtection: VirtualModelAutoProtection,
): Promise<void> {
  await updateVirtualModelMemberRuntimeState(virtualModelId, selection.provider, selection.modelId, (current) => {
    const nextFailures = Math.max(0, current.memberState?.consecutiveFailures ?? 0) + 1;
    const now = Date.now();
    const shouldCooldown = autoProtection.enabled && nextFailures >= autoProtection.failureThreshold;
    return {
      ...current,
      memberState: {
        consecutiveFailures: nextFailures,
        lastFailureAt: now,
        autoDisabledUntil: shouldCooldown ? now + autoProtection.cooldownMs : current.memberState?.autoDisabledUntil ?? null,
        lastAutoDisabledAt: shouldCooldown ? now : current.memberState?.lastAutoDisabledAt ?? null,
        lastRecoveredAt: current.memberState?.lastRecoveredAt ?? null,
        lastSuccessAt: current.memberState?.lastSuccessAt ?? null,
      },
    };
  });
}

function buildVirtualModelCandidates(selectedModels: VirtualModelSelection[]): {
  primary: RouteCandidate[];
  fallback: RouteCandidate[];
  excluded: VirtualModelTraceExcludedCandidate[];
} {
  const primary: RouteCandidate[] = [];
  const fallback: RouteCandidate[] = [];
  const excluded: VirtualModelTraceExcludedCandidate[] = [];

  for (const selection of selectedModels) {
    const excludedCandidate = {
      provider: selection.provider,
      modelId: selection.modelId,
    };
    if (selection.enabled === false) {
      excluded.push({ ...excludedCandidate, reason: 'disabled' });
      continue;
    }
    if (isSelectionAutoDisabled(selection)) {
      excluded.push({ ...excludedCandidate, reason: 'auto_disabled_cooldown' });
      continue;
    }

    const provider = getAvailableProviders().find((candidate) => candidate.name === selection.provider);
    if (!provider) {
      excluded.push({ ...excludedCandidate, reason: 'provider_missing' });
      continue;
    }
    if (!isProviderHealthy(selection.provider)) {
      excluded.push({ ...excludedCandidate, reason: 'provider_unhealthy' });
      continue;
    }
    const providerModel = provider.models.find((model) => model.id === selection.modelId || model.providerModelId === selection.modelId);
    if (!providerModel) {
      excluded.push({ ...excludedCandidate, reason: 'model_missing' });
      continue;
    }
    if (provider.isModelBlocked(providerModel.id)) {
      excluded.push({ ...excludedCandidate, reason: 'model_blocked' });
      continue;
    }

    const candidate: RouteCandidate = {
      provider,
      modelId: `${selection.provider}/${selection.modelId}`,
      selection,
    };
    if (selection.fallbackOnly === true) {
      fallback.push(candidate);
      excluded.push({ ...excludedCandidate, reason: 'fallback_only' });
    } else {
      primary.push(candidate);
    }
  }

  return { primary, fallback, excluded };
}

async function routeCandidatePool(
  request: ChatCompletionRequest,
  candidates: RouteCandidate[],
  strategy: RouterOptions['strategy'],
  maxRetries: number,
  errors: string[],
  tried: Set<string>,
  attempts: VirtualModelTraceAttempt[],
  virtualModelId?: string,
  autoProtection: VirtualModelAutoProtection = { enabled: true, failureThreshold: 3, cooldownMs: 600000 },
  stickyMode: VirtualModelStickyMode = 'none',
  stickyKey?: string,
): Promise<RouteChatCompletionResult | null> {
  // Parallel provider probing: instead of trying candidates strictly sequentially
  // (waiting for each slow/failing provider before moving on), pick the race
  // sequence up-front using the routing strategy, then race them with hedged
  // requests so the first healthy provider to respond wins.
  const maxAttempts = Math.min(maxRetries, candidates.length);

  const raceSequence: RouteCandidate[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const remaining = candidates.filter((candidate) => !tried.has(candidate.modelId));
    if (remaining.length === 0) break;
    const selectedCandidate = chooseCandidateFromPool(remaining, strategy, stickyMode, stickyKey);
    tried.add(selectedCandidate.modelId);
    raceSequence.push(selectedCandidate);
  }

  if (raceSequence.length === 0) {
    return null;
  }

  return raceProviders(request, raceSequence, virtualModelId, autoProtection, attempts, errors);
}

/**
 * Races multiple provider candidates concurrently using hedged requests:
 * the first candidate fires immediately, and backups are fired after
 * AGENTRAIL_HEDGE_DELAY_MS (or immediately when a probe fails fast) if no
 * winner has responded yet. The first usable response wins; all other
 * in-flight probes are aborted so speculative requests don't burn provider
 * tokens.
 *
 * Each probe gets its own AbortController so aborting the losers never
 * cancels the winning response body.
 */
async function raceProviders(
  request: ChatCompletionRequest,
  candidates: RouteCandidate[],
  virtualModelId: string | undefined,
  autoProtection: VirtualModelAutoProtection,
  attempts: VirtualModelTraceAttempt[],
  errors: string[],
): Promise<RouteChatCompletionResult | null> {
  const hedgeDelayMs = Number(process.env.AGENTRAIL_HEDGE_DELAY_MS) || 350;
  const probes = candidates.map((candidate) => ({
    candidate,
    controller: new AbortController(),
  }));

  let winnerDeclared = false;

  const abortAllExcept = (keep?: AbortController): void => {
    for (const probe of probes) {
      if (probe.controller !== keep) {
        probe.controller.abort();
      }
    }
  };

  return new Promise<RouteChatCompletionResult | null>((resolve) => {
    const probe = async (target: (typeof probes)[number]): Promise<void> => {
      const { candidate, controller } = target;
      const routeModel = candidate.modelId;

      try {
        const response = await candidate.provider.chatCompletion(
          toProviderChatRequest(request, routeModel),
          { signal: controller.signal },
        );

        // A different probe already won while this one was in flight — discard quietly.
        if (winnerDeclared) {
          return;
        }

        if (response.ok) {
          const unusableReason = await getUnusableChatResponseReason(response, request);
          if (!unusableReason) {
            winnerDeclared = true;
            candidate.provider.clearModelFailureState(routeModel);
            if (virtualModelId) {
              usageTracker.recordVirtualModelRouteHit(
                virtualModelId,
                candidate.provider.name,
                normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
              );
              if (candidate.selection) {
                await recordVirtualModelMemberSuccess(virtualModelId, candidate.selection);
              }
            }
            attempts.push({
              order: attempts.length + 1,
              provider: candidate.provider.name,
              modelId: normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
              outcome: 'success',
            });
            abortAllExcept(controller);
            resolve({ response, provider: candidate.provider, routeModel });
            return;
          }

          if (virtualModelId) {
            usageTracker.recordVirtualModelRouteFailure(
              virtualModelId,
              candidate.provider.name,
              normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
            );
            if (candidate.selection) {
              await recordVirtualModelMemberFailure(virtualModelId, candidate.selection, autoProtection);
            }
          }
          attempts.push({
            order: attempts.length + 1,
            provider: candidate.provider.name,
            modelId: normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
            outcome: 'invalid_response',
            status: response.status,
            message: unusableReason,
          });
          errors.push(`${candidate.provider.name}: invalid response ${unusableReason}`);
          return;
        }

        const body = await response.text().catch(() => '');
        recordNonSuccessResponse(candidate.provider, routeModel, response, body);
        if (virtualModelId) {
          usageTracker.recordVirtualModelRouteFailure(
            virtualModelId,
            candidate.provider.name,
            normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
          );
          if (candidate.selection) {
            await recordVirtualModelMemberFailure(virtualModelId, candidate.selection, autoProtection);
          }
        }
        attempts.push({
          order: attempts.length + 1,
          provider: candidate.provider.name,
          modelId: normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
          outcome: 'http_error',
          status: response.status,
          message: body.slice(0, 200),
        });
        errors.push(`${candidate.provider.name}: HTTP ${response.status} ${body.slice(0, 200)}`);
      } catch (error) {
        // Speculative probes aborted because another provider won — not an error.
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return;
        }
        recordProviderError(candidate.provider, routeModel, error);
        if (virtualModelId) {
          usageTracker.recordVirtualModelRouteFailure(
            virtualModelId,
            candidate.provider.name,
            normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
          );
          if (candidate.selection) {
            await recordVirtualModelMemberFailure(virtualModelId, candidate.selection, autoProtection);
          }
        }
        attempts.push({
          order: attempts.length + 1,
          provider: candidate.provider.name,
          modelId: normalizeTrackedModelId(candidate.provider.name, candidate.modelId),
          outcome: 'exception',
          message: error instanceof Error ? error.message : String(error),
        });
        errors.push(`${candidate.provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    let nextIndex = 0;
    let firedCount = 0;
    let settledCount = 0;

    const fireNext = (): void => {
      if (winnerDeclared || nextIndex >= probes.length) {
        return;
      }
      const target = probes[nextIndex];
      nextIndex += 1;
      firedCount += 1;
      void probe(target).finally(() => {
        settledCount += 1;
        // A probe failed fast — try the next candidate without waiting for the hedge delay.
        if (!winnerDeclared) {
          fireNext();
        }
        // Every fired probe settled and nothing left to fire — no winner.
        if (!winnerDeclared && settledCount >= firedCount && nextIndex >= probes.length) {
          abortAllExcept();
          resolve(null);
        }
      });
    };

    fireNext();
    const hedgeTimer = setTimeout(() => {
      if (!winnerDeclared) {
        fireNext();
      }
    }, hedgeDelayMs);
    hedgeTimer.unref?.();
  });
}

async function routeVirtualModel(
  request: ChatCompletionRequest,
  candidates: RouteCandidate[],
  strategy: RouterOptions['strategy'],
  maxRetries: number,
  failureMessage: string,
  virtualModelId?: string,
  excludedCandidates: VirtualModelTraceExcludedCandidate[] = [],
): Promise<RouteChatCompletionResult> {
  const errors: string[] = [];
  const tried = new Set<string>();
  const attempts: VirtualModelTraceAttempt[] = [];
  const result = await routeCandidatePool(request, candidates, strategy, maxRetries, errors, tried, attempts, virtualModelId);
  if (result) {
    if (virtualModelId) {
      const trace = recordVirtualModelRouteTrace({
        virtualModelId,
        strategy: strategy ?? 'priority',
        outcome: 'success',
        finalRoute: {
          provider: result.provider.name,
          modelId: normalizeTrackedModelId(result.provider.name, result.routeModel),
        },
        excludedCandidates,
        attempts,
      });
      return { ...result, virtualModelId, virtualModelTraceId: trace.id };
    }
    return result;
  }
  if (virtualModelId) {
    recordVirtualModelRouteTrace({
      virtualModelId,
      strategy: strategy ?? 'priority',
      outcome: 'failed',
      excludedCandidates,
      attempts,
    });
  }
  throw new Error(`${failureMessage}\n${errors.join('\n')}`);
}

async function routeVirtualModelWithFallback(
  request: ChatCompletionRequest,
  primary: RouteCandidate[],
  fallback: RouteCandidate[],
  strategy: RouterOptions['strategy'],
  maxRetries: number,
  failureMessage: string,
  virtualModelId?: string,
  autoProtection: VirtualModelAutoProtection = { enabled: true, failureThreshold: 3, cooldownMs: 600000 },
  stickyMode: VirtualModelStickyMode = 'none',
  stickyKey?: string,
  excludedCandidates: VirtualModelTraceExcludedCandidate[] = [],
): Promise<RouteChatCompletionResult> {
  const errors: string[] = [];
  const tried = new Set<string>();
  const attempts: VirtualModelTraceAttempt[] = [];

  const primaryResult = await routeCandidatePool(request, primary, strategy, maxRetries, errors, tried, attempts, virtualModelId, autoProtection, stickyMode, stickyKey);
  if (primaryResult) {
    if (virtualModelId) {
      const trace = recordVirtualModelRouteTrace({
        virtualModelId,
        strategy: strategy ?? 'priority',
        outcome: 'success',
        finalRoute: {
          provider: primaryResult.provider.name,
          modelId: normalizeTrackedModelId(primaryResult.provider.name, primaryResult.routeModel),
        },
        excludedCandidates,
        attempts,
        stickyMode,
        stickyKeyPresent: Boolean(stickyKey),
      });
      return { ...primaryResult, virtualModelId, virtualModelTraceId: trace.id };
    }
    return primaryResult;
  }

  const fallbackResult = await routeCandidatePool(request, fallback, strategy, maxRetries, errors, tried, attempts, virtualModelId, autoProtection, stickyMode, stickyKey);
  if (fallbackResult) {
    if (virtualModelId) {
      const trace = recordVirtualModelRouteTrace({
        virtualModelId,
        strategy: strategy ?? 'priority',
        outcome: 'success',
        finalRoute: {
          provider: fallbackResult.provider.name,
          modelId: normalizeTrackedModelId(fallbackResult.provider.name, fallbackResult.routeModel),
        },
        excludedCandidates,
        attempts,
        stickyMode,
        stickyKeyPresent: Boolean(stickyKey),
      });
      return { ...fallbackResult, virtualModelId, virtualModelTraceId: trace.id };
    }
    return fallbackResult;
  }

  if (virtualModelId) {
    recordVirtualModelRouteTrace({
      virtualModelId,
      strategy: strategy ?? 'priority',
      outcome: 'failed',
      excludedCandidates,
      attempts,
      stickyMode,
      stickyKeyPresent: Boolean(stickyKey),
    });
  }

  throw new Error(`${failureMessage}\n${errors.join('\n')}`);
}

export async function routeChatCompletion(
  request: ChatCompletionRequest,
  options: RouterOptions = {},
): Promise<RouteChatCompletionResult> {
  const { strategy = 'priority', maxRetries = 3 } = options;
  const modelId = request.model;

  const isVirtual = isVirtualModelId(modelId) || AUTO_MODEL_ALIASES.has(modelId);
  const resolvedAlias = resolveAlias(modelId);
  const effectiveId = resolvedAlias ?? modelId;

  if (isVirtual || resolvedAlias) {
    const routingConfig = getVirtualModelRoutingConfig(effectiveId);
    const requestWithVirtualPrompt = applyVirtualModelSystemPrompt(request, routingConfig?.systemPrompt);

    if (!routingConfig || routingConfig.selectedModels.length === 0) {
      const isFallbackAuto = !hasVirtualModelsInDb() && effectiveId === FALLBACK_AUTO_MODEL_ID;
      const isFallbackFiles = !hasVirtualModelsInDb() && effectiveId === FALLBACK_FILES_MODEL_ID;
      const isFallbackAlias = !hasVirtualModelsInDb() && AUTO_MODEL_ALIASES.has(modelId) && !resolvedAlias;

      let candidates: RouteCandidate[];

      if (isFallbackFiles) {
        candidates = getCapabilityRouteCandidates('file_input');
        if (candidates.length === 0) {
          throw new Error(`Model "${modelId}" is unavailable because no healthy providers with native file input support are currently available.`);
        }
      } else if (isFallbackAuto || isFallbackAlias || hasVirtualModelsInDb()) {
        // If the request contains tools, we need to use only tool-capable providers
        const requestHasTools = Array.isArray(request.tools) && request.tools.length > 0;
        if (requestHasTools) {
          candidates = getAutoRouteCandidatesWithToolCalls();
        } else {
          candidates = getAutoRouteCandidates();
        }
        if (candidates.length === 0) {
          throw new Error(
            requestHasTools
              ? `Model "${modelId}" is unavailable because no healthy providers with tool support are currently available.`
              : `Model "${modelId}" is unavailable because no healthy providers with tested models are currently available.`
          );
        }

        if (requestHasImageInputs(request)) {
          const visionCandidates = candidates.filter((candidate) => providerHasVisionModels(candidate.provider));
          if (visionCandidates.length === 0) {
            throw new Error(`Model "${modelId}" has image attachments but no healthy vision-capable providers are available.`);
          }
          candidates = visionCandidates;
        }
      } else {
        throw new Error(`Model "${modelId}" is unavailable because no healthy providers with tested models are currently available.`);
      }

      return routeVirtualModel(
        requestWithVirtualPrompt,
        candidates,
        (routingConfig?.strategy ?? strategy) as RouterOptions['strategy'],
        maxRetries,
        `All healthy routes for "${modelId}" failed:`,
        effectiveId,
      );
    }

    const { stickyKey } = getVirtualModelMeta(request);
    const { primary, fallback, excluded } = buildVirtualModelCandidates(routingConfig.selectedModels);
    const candidateCount = primary.length + fallback.length;
    if (candidateCount === 0) {
      throw new Error(`Model "${modelId}" has no healthy selected providers available.`);
    }

    return routeVirtualModelWithFallback(
      requestWithVirtualPrompt,
      primary,
      fallback,
      routingConfig.strategy as RouterOptions['strategy'],
      maxRetries,
      `All healthy providers for "${modelId}" failed:`,
      effectiveId,
      routingConfig.autoProtection,
      routingConfig.stickyMode,
      stickyKey,
      excluded,
    );
  }

  const candidates = findProvidersForModel(modelId);
  if (candidates.length === 0) {
    throw new Error(`Model "${modelId}" not found or no available provider. Check that the corresponding API key is set.`);
  }

  const errors: string[] = [];
  const tried = new Set<string>();

  for (let attempt = 0; attempt < Math.min(maxRetries, candidates.length); attempt += 1) {
    const remaining = candidates.filter((provider) => !tried.has(provider.name));
    if (remaining.length === 0) break;

    const provider = selectProvider(remaining, strategy);
    const routeModel = getConcreteRouteModel(provider, request.model);
    tried.add(provider.name);

    try {
      const response = await provider.chatCompletion(toProviderChatRequest(request, request.model));

      if (response.ok) {
        const unusableReason = await getUnusableChatResponseReason(response, request);
        if (!unusableReason) {
          provider.clearModelFailureState(routeModel);
          return { response, provider, routeModel };
        }

        errors.push(`${provider.name}: invalid response ${unusableReason}`);
        continue;
      }

      const body = await response.text().catch(() => '');
      recordNonSuccessResponse(provider, routeModel, response, body);
      errors.push(`${provider.name}: HTTP ${response.status} ${body.slice(0, 200)}`);
    } catch (error) {
      recordProviderError(provider, routeModel, error);
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All providers failed for model \"${modelId}\":\n${errors.join('\n')}`);
}
