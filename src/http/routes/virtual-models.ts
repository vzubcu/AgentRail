import type { RequestContext } from '../types.js';
import { sendJSON, sendNoContent } from '../responses.js';
import { readBody, parseJsonBody } from '../request-context.js';
import {
  getAllVirtualModels,
  createVirtualModel,
  updateVirtualModel,
  deleteVirtualModel,
  buildVirtualModelCloneInput,
  findConflictingAlias,
  findDuplicateAlias,
  findDuplicateSelectedModelKey,
  type VirtualModelRecord,
  type VirtualModelSelection,
  type VirtualModelStickyMode,
  type VirtualModelAutoProtection,
} from '../../virtual-models.js';
import { providers } from '../../providers/index.js';
import { isProviderHealthy } from '../../health.js';
import { inferCapabilities, type ModelCapability } from '../../models/capabilities.js';
import { classifyProviderRouteForModel } from '../../models/commercial-tiers.js';
import { usageTracker } from '../../usage-tracker.js';
import { getVirtualModelRouteTrace, listVirtualModelRouteTraces } from '../../virtual-model-traces.js';

const VALID_CAPABILITIES = new Set(['chat', 'vision', 'file_input']);
const VALID_STRATEGIES = new Set(['priority', 'round-robin', 'random']);
const MODEL_ID_REGEX = /^[a-zA-Z0-9\/\-_]+$/;

interface SelectedModel extends VirtualModelSelection {}

interface VirtualModelInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
  routingStrategy?: unknown;
  capabilities?: unknown;
  selectedModels?: unknown;
  autoAliases?: unknown;
  stickyMode?: unknown;
  autoProtection?: unknown;
  isBuiltin?: unknown;
}

interface VirtualModelCloneInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  autoAliases?: unknown;
}

interface VirtualModelPreviewInput {
  id?: string;
  routingStrategy: 'priority' | 'round-robin' | 'random';
  capabilities: ModelCapability[];
  selectedModels: SelectedModel[];
}

interface VirtualModelPreviewRequestBody {
  id?: unknown;
  routingStrategy?: unknown;
  capabilities?: unknown;
  selectedModels?: unknown;
  input?: unknown;
  dryRun?: unknown;
}

interface VirtualModelPreviewResult {
  strategy: 'priority' | 'round-robin' | 'random';
  requestedCapabilities: ModelCapability[];
  eligibleModels: Array<{
    provider: string;
    modelId: string;
    priority: number;
    healthy: boolean;
    reason?: string;
  }>;
  explanation: string[];
  suggestedRoute?: { provider: string; modelId: string };
}

interface VirtualModelStatsResponse {
  id: string;
  totalRequests: number;
  lastUsedAt: number | null;
  activeMembers: number;
  cooldownMembers: number;
  manuallyDisabledMembers: number;
  routeHits: Array<{ provider: string; modelId: string; count: number }>;
  routeFailures: Array<{ provider: string; modelId: string; count: number }>;
  currentlyExcluded: Array<{ provider: string; modelId: string; reason: string }>;
}

interface VirtualModelPruneRequestBody {
  apply?: unknown;
}

interface VirtualModelPruneResponse {
  id: string;
  removed: Array<{ provider: string; modelId: string; reason: 'provider_unhealthy' | 'model_unhealthy' }>;
  kept: Array<{ provider: string; modelId: string }>;
  updatedModel?: VirtualModelRecord;
  applied: boolean;
}

interface VirtualModelTemplateRecord {
  id: string;
  name: string;
  description: string;
  routingStrategy: 'priority' | 'round-robin' | 'random';
  capabilities: ModelCapability[];
  selectedModels: SelectedModel[];
  stickyMode: VirtualModelStickyMode;
}

interface VirtualModelTraceListResponse {
  traces: ReturnType<typeof listVirtualModelRouteTraces>;
}

function normalizeSelectedModelInput(sm: any): SelectedModel {
  return {
    provider: String(sm?.provider ?? ''),
    modelId: String(sm?.modelId ?? ''),
    priority: Number(sm?.priority ?? 1),
    enabled: sm?.enabled !== false,
    weight: Number.isFinite(Number(sm?.weight)) && Number(sm?.weight) > 0 ? Number(sm.weight) : 1,
    fallbackOnly: sm?.fallbackOnly === true,
    capabilities: Array.isArray(sm?.capabilities)
      ? sm.capabilities.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : [],
  };
}

function normalizeAliases(autoAliases: unknown): string[] {
  if (!Array.isArray(autoAliases)) return [];
  return autoAliases.filter((alias): alias is string => typeof alias === 'string').map((alias) => alias.trim()).filter(Boolean);
}

function normalizeStickyMode(value: unknown): VirtualModelStickyMode {
  return value === 'request-key' ? 'request-key' : 'none';
}

function normalizeAutoProtectionInput(value: unknown): VirtualModelAutoProtection {
  const entry = value && typeof value === 'object' ? value as Partial<VirtualModelAutoProtection> : {};
  return {
    enabled: entry.enabled !== false,
    failureThreshold: Number.isFinite(entry.failureThreshold) && Number(entry.failureThreshold) > 0 ? Math.trunc(Number(entry.failureThreshold)) : 3,
    cooldownMs: Number.isFinite(entry.cooldownMs) && Number(entry.cooldownMs) >= 0 ? Math.trunc(Number(entry.cooldownMs)) : 600000,
  };
}

function validateSelectedModels(selectedModels: unknown, requireNonEmpty = false): { ok: true; value: SelectedModel[] } | { ok: false; message: string } {
  if (selectedModels === undefined || selectedModels === null) {
    return requireNonEmpty
      ? { ok: false, message: 'selectedModels must be a non-empty array when provided' }
      : { ok: true, value: [] };
  }

  if (!Array.isArray(selectedModels) || (requireNonEmpty && selectedModels.length === 0)) {
    return {
      ok: false,
      message: requireNonEmpty ? 'selectedModels must be a non-empty array when provided' : 'selectedModels must be an array',
    };
  }

  const normalized = selectedModels.map((entry) => normalizeSelectedModelInput(entry));
  for (const sm of normalized) {
    if (!sm.provider || !sm.modelId || !Number.isFinite(sm.priority)) {
      return {
        ok: false,
        message: 'each selectedModels entry must have provider (string), modelId (string), priority (number)',
      };
    }
    if (!Number.isFinite(Number(sm.weight)) || Number(sm.weight) < 1) {
      return { ok: false, message: 'each selectedModels entry weight must be a positive number when provided' };
    }
  }

  return { ok: true, value: normalized };
}

async function validateVirtualModelSemantics(
  input: { id?: string; autoAliases: string[]; selectedModels: SelectedModel[] },
  options: { excludeId?: string; allowEmptySelectedModels?: boolean } = {},
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  if (!options.allowEmptySelectedModels && input.selectedModels.length === 0) {
    return { ok: false, message: 'At least one selected model is required' };
  }

  const duplicateAlias = findDuplicateAlias(input.autoAliases);
  if (duplicateAlias) {
    return { ok: false, message: `Duplicate alias "${duplicateAlias}" already exists` };
  }

  const duplicateSelectedModel = findDuplicateSelectedModelKey(input.selectedModels);
  if (duplicateSelectedModel) {
    return { ok: false, message: `Duplicate selected model "${duplicateSelectedModel}" in virtual model` };
  }

  const models = await getAllVirtualModels();
  const conflictingAlias = findConflictingAlias(models, input.autoAliases, options.excludeId);
  if (conflictingAlias) {
    return { ok: false, message: `Duplicate alias "${conflictingAlias}" already exists` };
  }

  if (input.id) {
    const idConflict = models.find((model) => model.id === input.id && model.id !== options.excludeId);
    if (idConflict) {
      return { ok: false, status: 409, message: `Virtual model "${input.id}" already exists` };
    }
  }

  return { ok: true };
}

function validateVirtualModelInput(
  body: VirtualModelInput,
  checkId: boolean,
): { ok: true; value: VirtualModelInput & { id?: string; autoAliases: string[]; selectedModels: SelectedModel[] } } | { ok: false; message: string } {
  if (checkId) {
    if (typeof body.id !== 'string' || !MODEL_ID_REGEX.test(body.id)) {
      return { ok: false, message: 'id must be a non-empty string matching /^[a-zA-Z0-9\\/\\-_]+$/' };
    }
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return { ok: false, message: 'name is required and must be a non-empty string' };
  }

  if (body.systemPrompt !== undefined && body.systemPrompt !== null && typeof body.systemPrompt !== 'string') {
    return { ok: false, message: 'systemPrompt must be a string or null when provided' };
  }

  if (body.routingStrategy !== undefined && body.routingStrategy !== null && !VALID_STRATEGIES.has(body.routingStrategy as string)) {
    return { ok: false, message: 'routingStrategy must be one of: priority, round-robin, random' };
  }

  if (body.capabilities !== undefined && body.capabilities !== null) {
    if (!Array.isArray(body.capabilities)) {
      return { ok: false, message: 'capabilities must be an array of strings' };
    }
    for (const cap of body.capabilities) {
      if (!VALID_CAPABILITIES.has(cap as string)) {
        return { ok: false, message: `capabilities must be from: chat, vision, file_input. Got: ${cap}` };
      }
    }
  }

  const selectedModelsValidation = validateSelectedModels(body.selectedModels, false);
  if (!selectedModelsValidation.ok) {
    return selectedModelsValidation;
  }

  const autoAliases = normalizeAliases(body.autoAliases);
  if (body.autoAliases !== undefined && body.autoAliases !== null && !Array.isArray(body.autoAliases)) {
    return { ok: false, message: 'autoAliases must be an array of strings' };
  }

  return {
    ok: true,
    value: {
      ...body,
      id: typeof body.id === 'string' ? body.id : undefined,
      autoAliases,
      stickyMode: normalizeStickyMode(body.stickyMode),
      autoProtection: normalizeAutoProtectionInput(body.autoProtection),
      selectedModels: selectedModelsValidation.value,
    },
  };
}

function validateCloneInput(
  body: VirtualModelCloneInput,
): { ok: true; value: { id: string; name: string; description?: string | null; autoAliases: string[] } } | { ok: false; message: string } {
  if (typeof body.id !== 'string' || !MODEL_ID_REGEX.test(body.id)) {
    return { ok: false, message: 'id must be a non-empty string matching /^[a-zA-Z0-9\\/\\-_]+$/' };
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return { ok: false, message: 'name is required and must be a non-empty string' };
  }
  if (body.autoAliases !== undefined && body.autoAliases !== null && !Array.isArray(body.autoAliases)) {
    return { ok: false, message: 'autoAliases must be an array of strings' };
  }
  return {
    ok: true,
    value: {
      id: body.id,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      autoAliases: normalizeAliases(body.autoAliases),
    },
  };
}

function validatePreviewRequest(
  body: VirtualModelPreviewRequestBody,
): { ok: true; value: VirtualModelPreviewRequestBody & { selectedModels?: SelectedModel[] } } | { ok: false; message: string } {
  if (body.id !== undefined && body.id !== null && typeof body.id !== 'string') {
    return { ok: false, message: 'id must be a string when provided' };
  }

  if (body.routingStrategy !== undefined && body.routingStrategy !== null && !VALID_STRATEGIES.has(body.routingStrategy as string)) {
    return { ok: false, message: 'routingStrategy must be one of: priority, round-robin, random' };
  }

  if (body.capabilities !== undefined && body.capabilities !== null) {
    if (!Array.isArray(body.capabilities)) {
      return { ok: false, message: 'capabilities must be an array of strings' };
    }
    for (const cap of body.capabilities) {
      if (!VALID_CAPABILITIES.has(cap as string)) {
        return { ok: false, message: `capabilities must be from: chat, vision, file_input. Got: ${cap}` };
      }
    }
  }

  const selectedModelsValidation = body.selectedModels === undefined || body.selectedModels === null
    ? { ok: true as const, value: undefined }
    : validateSelectedModels(body.selectedModels, true);
  if (!selectedModelsValidation.ok) {
    return selectedModelsValidation;
  }

  if ((body.id === undefined || body.id === null || body.id === '')
    && (!selectedModelsValidation.value || selectedModelsValidation.value.length === 0)) {
    return { ok: false, message: 'Provide either a virtual model id or selectedModels for preview/testing' };
  }

  return { ok: true, value: { ...body, selectedModels: selectedModelsValidation.value } };
}

async function resolvePreviewInput(
  body: VirtualModelPreviewRequestBody & { selectedModels?: SelectedModel[] },
): Promise<VirtualModelPreviewInput | null> {
  if (Array.isArray(body.selectedModels) && body.selectedModels.length > 0) {
    return {
      id: typeof body.id === 'string' ? body.id : undefined,
      routingStrategy: (body.routingStrategy as VirtualModelPreviewInput['routingStrategy']) ?? 'priority',
      capabilities: Array.isArray(body.capabilities) ? body.capabilities as ModelCapability[] : [],
      selectedModels: body.selectedModels,
    };
  }

  if (typeof body.id !== 'string' || !body.id) {
    return null;
  }

  const models = await getAllVirtualModels();
  const record = models.find((item) => item.id === body.id);
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    routingStrategy: (body.routingStrategy as VirtualModelPreviewInput['routingStrategy']) ?? record.routingStrategy,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities as ModelCapability[] : record.capabilities as ModelCapability[],
    selectedModels: record.selectedModels,
  };
}

function getProviderModel(entry: SelectedModel) {
  const provider = providers.find((item) => item.name === entry.provider);
  const providerModel = provider?.models.find((model) => model.id === entry.modelId || model.providerModelId === entry.modelId);
  return { provider, providerModel };
}

function getExcludedSelectionReason(entry: SelectedModel): string | undefined {
  if (entry.enabled === false) {
    return 'disabled';
  }
  if (entry.memberState?.autoDisabledUntil && entry.memberState.autoDisabledUntil > Date.now()) {
    return 'auto_disabled_cooldown';
  }
  if (entry.fallbackOnly === true) {
    return 'fallback_only';
  }

  const { provider, providerModel } = getProviderModel(entry);
  if (!provider) {
    return 'model_unhealthy';
  }
  if (!isProviderHealthy(entry.provider)) {
    return 'provider_unhealthy';
  }
  if (!providerModel || provider.isModelBlocked(providerModel.id)) {
    return 'model_unhealthy';
  }

  return undefined;
}

function buildVirtualModelStatsResponse(record: VirtualModelRecord): VirtualModelStatsResponse {
  const stats = usageTracker.getVirtualModelStats(record.id);
  const currentlyExcluded = record.selectedModels
      .map((selection) => {
        const reason = getExcludedSelectionReason(selection);
        return reason ? { provider: selection.provider, modelId: selection.modelId, reason } : null;
      })
      .filter((entry): entry is { provider: string; modelId: string; reason: string } => entry !== null);

  return {
    id: record.id,
    totalRequests: stats.totalRequests,
    lastUsedAt: stats.lastUsedAt,
    activeMembers: Math.max(0, record.selectedModels.length - currentlyExcluded.length),
    cooldownMembers: currentlyExcluded.filter((entry) => entry.reason === 'auto_disabled_cooldown').length,
    manuallyDisabledMembers: currentlyExcluded.filter((entry) => entry.reason === 'disabled').length,
    routeHits: stats.routeHits,
    routeFailures: stats.routeFailures,
    currentlyExcluded,
  };
}

function getPruneReason(entry: SelectedModel): 'provider_unhealthy' | 'model_unhealthy' | undefined {
  const { provider, providerModel } = getProviderModel(entry);
  if (!provider || !providerModel || provider.isModelBlocked(providerModel.id)) {
    return 'model_unhealthy';
  }
  if (!isProviderHealthy(entry.provider)) {
    return 'provider_unhealthy';
  }
  return undefined;
}

function buildPrunePreview(record: VirtualModelRecord): VirtualModelPruneResponse {
  const removed: VirtualModelPruneResponse['removed'] = [];
  const kept: VirtualModelPruneResponse['kept'] = [];

  for (const selection of record.selectedModels) {
    const reason = getPruneReason(selection);
    if (reason) {
      removed.push({ provider: selection.provider, modelId: selection.modelId, reason });
    } else {
      kept.push({ provider: selection.provider, modelId: selection.modelId });
    }
  }

  return {
    id: record.id,
    removed,
    kept,
    applied: false,
  };
}
function getReasonMessage(reason: string, provider: string, modelId: string, missingCapabilities: string[] = []): string {
  switch (reason) {
    case 'disabled':
      return `${provider}/${modelId} is excluded because this selection is disabled.`;
    case 'fallback_only':
      return `${provider}/${modelId} is marked as fallback-only and is excluded from the primary route preview.`;
    case 'auto_disabled_cooldown':
      return `${provider}/${modelId} is temporarily excluded because auto-protection placed it in cooldown.`;
    case 'provider_missing':
      return `${provider}/${modelId} is unavailable because the provider is not registered.`;
    case 'provider_unhealthy':
      return `${provider}/${modelId} is excluded because the provider is not live healthy.`;
    case 'model_missing':
      return `${provider}/${modelId} is unavailable because that model is not in the current provider catalog.`;
    case 'model_blocked':
      return `${provider}/${modelId} is excluded because the provider marked it unavailable.`;
    case 'missing_capability':
      return `${provider}/${modelId} is excluded because it is missing required capabilities: ${missingCapabilities.join(', ')}.`;
    default:
      return `${provider}/${modelId} is excluded.`;
  }
}

function selectSuggestedRoute(
  strategy: VirtualModelPreviewInput['routingStrategy'],
  healthyCandidates: Array<{ provider: string; modelId: string; priority: number }>,
): { provider: string; modelId: string } | undefined {
  if (healthyCandidates.length === 0) return undefined;
  const sorted = [...healthyCandidates].sort((left, right) => left.priority - right.priority);
  switch (strategy) {
    case 'random':
    case 'round-robin':
    case 'priority':
    default:
      return { provider: sorted[0].provider, modelId: sorted[0].modelId };
  }
}

function getHealthyTemplateSelections(capabilities: ModelCapability[]): SelectedModel[] {
  const matches = providers
    .filter((provider) => isProviderHealthy(provider.name))
    .flatMap((provider) => provider.models
      .filter((model) => !provider.isModelBlocked(model.id))
      .filter((model) => capabilities.every((capability) => inferCapabilities(model).includes(capability)))
      .map((model) => ({
        provider: provider.name,
        modelId: model.id,
        priority: 0,
        enabled: true,
        weight: 1,
        fallbackOnly: false,
        capabilities: inferCapabilities(model),
      })));

  return matches.slice(0, 3).map((selection, index) => ({
    ...selection,
    priority: index + 1,
  }));
}

function buildVirtualModelTemplates(): VirtualModelTemplateRecord[] {
  const chatSelections = getHealthyTemplateSelections(['chat']);
  const visionSelections = getHealthyTemplateSelections(['chat', 'vision']);
  const weightedSelections = chatSelections.map((selection, index) => ({
    ...selection,
    weight: index === 0 ? 70 : 30,
    fallbackOnly: false,
  }));
  const failoverSelections = chatSelections.map((selection, index) => ({
    ...selection,
    weight: 1,
    fallbackOnly: index > 0,
  }));

  return [
    {
      id: 'chat-failover',
      name: 'Chat Failover',
      description: 'Priority routing with fallback-only secondaries for chat traffic.',
      routingStrategy: 'priority',
      capabilities: ['chat'],
      selectedModels: failoverSelections,
      stickyMode: 'none',
    },
    {
      id: 'weighted-cheap-pool',
      name: 'Weighted Cheap Pool',
      description: 'Random weighted pool for low-cost chat traffic.',
      routingStrategy: 'random',
      capabilities: ['chat'],
      selectedModels: weightedSelections,
      stickyMode: 'request-key',
    },
    {
      id: 'vision-router',
      name: 'Vision Router',
      description: 'Vision-capable virtual model starter built from currently healthy candidates.',
      routingStrategy: 'round-robin',
      capabilities: ['chat', 'vision'],
      selectedModels: visionSelections,
      stickyMode: 'none',
    },
  ];
}

function buildVirtualModelPreview(input: VirtualModelPreviewInput): VirtualModelPreviewResult {
  const explanation: string[] = [];
  const requestedCapabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const selected = [...input.selectedModels].sort((left, right) => left.priority - right.priority);

  const eligibleModels = selected.map((entry) => {
    const provider = providers.find((item) => item.name === entry.provider);
    let reason: string | undefined;
    let missingCapabilities: string[] = [];

    if (entry.enabled === false) {
      reason = 'disabled';
    }
    if (!reason && entry.memberState?.autoDisabledUntil && entry.memberState.autoDisabledUntil > Date.now()) {
      reason = 'auto_disabled_cooldown';
    }
    if (!reason && entry.fallbackOnly === true) {
      reason = 'fallback_only';
    }
    if (!reason && !provider) {
      reason = 'provider_missing';
    }

    const providerModel = provider?.models.find((model) => model.id === entry.modelId || model.providerModelId === entry.modelId);
    if (!reason && !isProviderHealthy(entry.provider)) {
      reason = 'provider_unhealthy';
    }
    if (!reason && !providerModel) {
      reason = 'model_missing';
    }
    if (!reason && provider?.isModelBlocked(providerModel?.id ?? entry.modelId)) {
      reason = 'model_blocked';
    }
    if (!reason && providerModel && requestedCapabilities.length > 0) {
      const capabilities = inferCapabilities(providerModel);
      missingCapabilities = requestedCapabilities.filter((cap) => !capabilities.includes(cap));
      if (missingCapabilities.length > 0) {
        reason = 'missing_capability';
      }
    }

    if (reason) {
      explanation.push(getReasonMessage(reason, entry.provider, entry.modelId, missingCapabilities));
    }

    return {
      provider: entry.provider,
      modelId: entry.modelId,
      priority: entry.priority,
      healthy: !reason,
      ...(reason ? { reason } : {}),
    };
  });

  const suggestedRoute = selectSuggestedRoute(
    input.routingStrategy,
    eligibleModels.filter((item) => item.healthy),
  );

  if (suggestedRoute) {
    explanation.unshift(`Suggested route: ${suggestedRoute.provider}/${suggestedRoute.modelId} (${input.routingStrategy}).`);
  } else {
    explanation.unshift('No eligible healthy route is currently available for this virtual model.');
  }

  return {
    strategy: input.routingStrategy,
    requestedCapabilities,
    eligibleModels,
    explanation,
    ...(suggestedRoute ? { suggestedRoute } : {}),
  };
}

export async function handleVirtualModelsRoute(ctx: RequestContext): Promise<boolean> {
  if (ctx.pathname === '/api/virtual-models/candidates' && ctx.req.method === 'GET') {
    return handleGetCandidates(ctx);
  }
  if (ctx.pathname === '/api/virtual-models/templates' && ctx.req.method === 'GET') {
    return handleGetTemplates(ctx);
  }
  if (ctx.pathname === '/api/virtual-models/preview' && ctx.req.method === 'POST') {
    return handlePreview(ctx);
  }
  if (ctx.pathname === '/api/virtual-models/test' && ctx.req.method === 'POST') {
    return handleTest(ctx);
  }
  if (ctx.pathname === '/api/virtual-models' && ctx.req.method === 'GET') {
    return handleGetAll(ctx);
  }
  if (ctx.pathname === '/api/virtual-models' && ctx.req.method === 'POST') {
    return handleCreate(ctx);
  }

  const traceDetailMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)\/trace\/([^/]+)$/);
  if (traceDetailMatch && ctx.req.method === 'GET') {
    ctx.trace('virtual-models.trace.detail', { id: traceDetailMatch[1], traceId: traceDetailMatch[2] });
    return handleGetTraceDetail(ctx, decodeURIComponent(traceDetailMatch[1]), decodeURIComponent(traceDetailMatch[2]));
  }

  const traceListMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)\/trace$/);
  if (traceListMatch && ctx.req.method === 'GET') {
    ctx.trace('virtual-models.trace.list', { id: traceListMatch[1] });
    return handleGetTraceList(ctx, decodeURIComponent(traceListMatch[1]));
  }

  const statsMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)\/stats$/);
  if (statsMatch && ctx.req.method === 'GET') {
    ctx.trace('virtual-models.stats', { id: statsMatch[1] });
    return handleGetStats(ctx, decodeURIComponent(statsMatch[1]));
  }

  const pruneMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)\/prune-unhealthy$/);
  if (pruneMatch && ctx.req.method === 'POST') {
    ctx.trace('virtual-models.prune', { id: pruneMatch[1] });
    return handlePruneUnhealthy(ctx, decodeURIComponent(pruneMatch[1]));
  }

  const cloneMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)\/clone$/);
  if (cloneMatch && ctx.req.method === 'POST') {
    ctx.trace('virtual-models.clone', { id: cloneMatch[1] });
    return handleClone(ctx, decodeURIComponent(cloneMatch[1]));
  }

  const putMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)$/);
  if (putMatch && ctx.req.method === 'PUT') {
    ctx.trace('virtual-models.put', { id: putMatch[1] });
    return handleUpdate(ctx, decodeURIComponent(putMatch[1]));
  }

  const deleteMatch = ctx.pathname.match(/^\/api\/virtual-models\/(.+)$/);
  if (deleteMatch && ctx.req.method === 'DELETE') {
    ctx.trace('virtual-models.delete', { id: deleteMatch[1] });
    return handleDelete(ctx, decodeURIComponent(deleteMatch[1]));
  }

  return false;
}

async function handleGetAll(ctx: RequestContext): Promise<boolean> {
  try {
    const models = await getAllVirtualModels();
    sendJSON(ctx.res, 200, models);
  } catch {
    sendJSON(ctx.res, 200, []);
  }
  return true;
}

async function handleGetTemplates(ctx: RequestContext): Promise<boolean> {
  sendJSON(ctx.res, 200, buildVirtualModelTemplates());
  return true;
}

async function handleGetStats(ctx: RequestContext, id: string): Promise<boolean> {
  const models = await getAllVirtualModels();
  const record = models.find((item) => item.id === id);
  if (!record) {
    sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
    return true;
  }

  sendJSON(ctx.res, 200, buildVirtualModelStatsResponse(record));
  return true;
}

async function handleGetTraceList(ctx: RequestContext, id: string): Promise<boolean> {
  const models = await getAllVirtualModels();
  const record = models.find((item) => item.id === id);
  if (!record) {
    sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
    return true;
  }

  const limitParam = new URL(ctx.req.url ?? '/', 'http://localhost').searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;
  const response: VirtualModelTraceListResponse = {
    traces: listVirtualModelRouteTraces(record.id, limit),
  };
  sendJSON(ctx.res, 200, response);
  return true;
}

async function handleGetTraceDetail(ctx: RequestContext, id: string, traceId: string): Promise<boolean> {
  const models = await getAllVirtualModels();
  const record = models.find((item) => item.id === id);
  if (!record) {
    sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
    return true;
  }

  const trace = getVirtualModelRouteTrace(record.id, traceId);
  if (!trace) {
    sendJSON(ctx.res, 404, { error: { message: `Trace "${traceId}" not found for virtual model "${id}"`, type: 'invalid_request_error' } });
    return true;
  }

  sendJSON(ctx.res, 200, trace);
  return true;
}

async function handlePruneUnhealthy(ctx: RequestContext, id: string): Promise<boolean> {
  const models = await getAllVirtualModels();
  const record = models.find((item) => item.id === id);
  if (!record) {
    sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
    return true;
  }

  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<VirtualModelPruneRequestBody>(raw, ctx.res);
  if (!parsed.ok) return true;

  const preview = buildPrunePreview(record);
  const apply = parsed.value.apply === true;
  if (!apply) {
    sendJSON(ctx.res, 200, preview);
    return true;
  }

  if (record.isBuiltin) {
    sendJSON(ctx.res, 403, { error: { message: 'Cannot prune built-in virtual model', type: 'forbidden' } });
    return true;
  }

  const keptSelections = record.selectedModels
    .filter((selection) => !preview.removed.some((removed) => removed.provider === selection.provider && removed.modelId === selection.modelId))
    .sort((left, right) => left.priority - right.priority)
    .map((selection, index) => ({ ...selection, priority: index + 1 }));

  const updatedRecord = await updateVirtualModel(id, {
    selectedModels: keptSelections,
  });

  if (!updatedRecord) {
    sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
    return true;
  }

  sendJSON(ctx.res, 200, {
    ...preview,
    applied: true,
    updatedModel: updatedRecord,
  });
  return true;
}

async function handlePreview(ctx: RequestContext): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<VirtualModelPreviewRequestBody>(raw, ctx.res);
  if (!parsed.ok) return true;

  const validation = validatePreviewRequest(parsed.value);
  if (!validation.ok) {
    sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
    return true;
  }

  const resolved = await resolvePreviewInput(validation.value);
  if (!resolved) {
    sendJSON(ctx.res, 404, { error: { message: 'Virtual model not found for preview', type: 'invalid_request_error' } });
    return true;
  }

  sendJSON(ctx.res, 200, buildVirtualModelPreview(resolved));
  return true;
}

async function handleTest(ctx: RequestContext): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<VirtualModelPreviewRequestBody>(raw, ctx.res);
  if (!parsed.ok) return true;

  const validation = validatePreviewRequest(parsed.value);
  if (!validation.ok) {
    sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
    return true;
  }

  const resolved = await resolvePreviewInput(validation.value);
  if (!resolved) {
    sendJSON(ctx.res, 404, { error: { message: 'Virtual model not found for test', type: 'invalid_request_error' } });
    return true;
  }

  const preview = buildVirtualModelPreview(resolved);
  const input = validation.value.input as { messages?: unknown[] } | undefined;
  sendJSON(ctx.res, 200, {
    id: resolved.id ?? null,
    dryRun: validation.value.dryRun !== false,
    selectedRoute: preview.suggestedRoute ?? null,
    preview,
    inputSummary: {
      messageCount: Array.isArray(input?.messages) ? input.messages.length : 0,
    },
  });
  return true;
}

async function handleCreate(ctx: RequestContext): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<VirtualModelInput>(raw, ctx.res);
  if (!parsed.ok) return true;

  const validation = validateVirtualModelInput(parsed.value, true);
  if (!validation.ok) {
    sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
    return true;
  }

  const body = validation.value;
  const semanticValidation = await validateVirtualModelSemantics({
    id: body.id,
    autoAliases: body.autoAliases,
    selectedModels: body.selectedModels,
  });
  if (!semanticValidation.ok) {
    sendJSON(ctx.res, semanticValidation.status ?? 400, { error: { message: semanticValidation.message, type: 'invalid_request_error' } });
    return true;
  }

  try {
    const record = await createVirtualModel({
      id: body.id as string,
      name: body.name as string,
      description: typeof body.description === 'string' ? body.description : null,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : null,
      routingStrategy: (body.routingStrategy as 'priority' | 'round-robin' | 'random' | undefined) ?? 'round-robin',
      capabilities: (body.capabilities as string[] | undefined) ?? ['chat'],
      selectedModels: body.selectedModels ?? [],
      autoAliases: body.autoAliases,
      stickyMode: body.stickyMode as VirtualModelStickyMode | undefined,
      autoProtection: body.autoProtection as VirtualModelAutoProtection | undefined,
      isBuiltin: body.isBuiltin === true,
    });
    sendJSON(ctx.res, 201, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create virtual model';
    if (message.includes('already exists')) {
      sendJSON(ctx.res, 409, { error: { message, type: 'invalid_request_error' } });
    } else {
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
  }
  return true;
}

async function handleClone(ctx: RequestContext, sourceId: string): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<VirtualModelCloneInput>(raw, ctx.res);
  if (!parsed.ok) return true;

  const validation = validateCloneInput(parsed.value);
  if (!validation.ok) {
    sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
    return true;
  }

  const models = await getAllVirtualModels();
  const source = models.find((model) => model.id === sourceId);
  if (!source) {
    sendJSON(ctx.res, 404, { error: { message: `Virtual model "${sourceId}" not found`, type: 'invalid_request_error' } });
    return true;
  }

  const cloneInput = buildVirtualModelCloneInput(source, validation.value);
  const semanticValidation = await validateVirtualModelSemantics({
    id: cloneInput.id,
    autoAliases: cloneInput.autoAliases,
    selectedModels: cloneInput.selectedModels,
  });
  if (!semanticValidation.ok) {
    sendJSON(ctx.res, semanticValidation.status ?? 400, { error: { message: semanticValidation.message, type: 'invalid_request_error' } });
    return true;
  }

  try {
    const record = await createVirtualModel(cloneInput);
    sendJSON(ctx.res, 201, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clone virtual model';
    if (message.includes('already exists')) {
      sendJSON(ctx.res, 409, { error: { message, type: 'invalid_request_error' } });
    } else {
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
  }
  return true;
}

async function handleUpdate(ctx: RequestContext, id: string): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<VirtualModelInput>(raw, ctx.res);
  if (!parsed.ok) return true;

  const validation = validateVirtualModelInput(parsed.value, false);
  if (!validation.ok) {
    sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
    return true;
  }

  const body = validation.value;
  const semanticValidation = await validateVirtualModelSemantics({
    id,
    autoAliases: body.autoAliases,
    selectedModels: body.selectedModels,
  }, { excludeId: id });
  if (!semanticValidation.ok) {
    sendJSON(ctx.res, semanticValidation.status ?? 400, { error: { message: semanticValidation.message, type: 'invalid_request_error' } });
    return true;
  }

  try {
    const record = await updateVirtualModel(id, {
      name: body.name as string,
      description: body.description !== undefined ? body.description as string | null : undefined,
      systemPrompt: body.systemPrompt !== undefined ? (typeof body.systemPrompt === 'string' ? body.systemPrompt : null) : undefined,
      routingStrategy: body.routingStrategy as 'priority' | 'round-robin' | 'random' | undefined,
      capabilities: body.capabilities as string[] | undefined,
      selectedModels: body.selectedModels,
      autoAliases: body.autoAliases,
      stickyMode: body.stickyMode as VirtualModelStickyMode | undefined,
      autoProtection: body.autoProtection as VirtualModelAutoProtection | undefined,
    });

    if (!record) {
      sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
      return true;
    }

    sendJSON(ctx.res, 200, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update virtual model';
    sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
  }
  return true;
}

async function handleDelete(ctx: RequestContext, id: string): Promise<boolean> {
  try {
    const deleted = await deleteVirtualModel(id);
    if (!deleted) {
      sendJSON(ctx.res, 404, { error: { message: `Virtual model "${id}" not found`, type: 'invalid_request_error' } });
      return true;
    }
    sendNoContent(ctx.res, 'DELETE');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete virtual model';
    if (message.includes('Cannot delete built-in')) {
      sendJSON(ctx.res, 403, { error: { message, type: 'forbidden' } });
    } else {
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
  }
  return true;
}

async function handleGetCandidates(ctx: RequestContext): Promise<boolean> {
  const candidates = providers
    .filter((p) => isProviderHealthy(p.name))
    .map((provider) => ({
      provider: provider.name,
      models: provider.models
        .filter((m) => !provider.isModelBlocked(m.id) && m.providerModelId)
        .map((m) => {
          const tierResult = classifyProviderRouteForModel(provider.name, m.id, m.providerModelId);
          return {
            id: m.id,
            providerModelId: m.providerModelId,
            capabilities: inferCapabilities(m),
            commercialTier: tierResult.commercialTier,
            commercialNote: tierResult.commercialNote,
          };
        }),
    }))
    .filter((c) => c.models.length > 0);

  sendJSON(ctx.res, 200, candidates);
  return true;
}
