import type { VirtualModelAutoProtection, VirtualModelMemberState, VirtualModelRecord, VirtualModelSelection, VirtualModelStickyMode } from './types.js';

export function normalizeStickyMode(value: unknown): VirtualModelStickyMode {
  return value === 'request-key' ? 'request-key' : 'none';
}

export function normalizeMemberState(state: Partial<VirtualModelMemberState> | null | undefined): VirtualModelMemberState {
  return {
    consecutiveFailures: Number.isFinite(state?.consecutiveFailures) ? Math.max(0, Math.trunc(Number(state?.consecutiveFailures))) : 0,
    lastFailureAt: Number.isFinite(state?.lastFailureAt) ? Number(state?.lastFailureAt) : null,
    autoDisabledUntil: Number.isFinite(state?.autoDisabledUntil) ? Number(state?.autoDisabledUntil) : null,
    lastAutoDisabledAt: Number.isFinite(state?.lastAutoDisabledAt) ? Number(state?.lastAutoDisabledAt) : null,
    lastRecoveredAt: Number.isFinite(state?.lastRecoveredAt) ? Number(state?.lastRecoveredAt) : null,
    lastSuccessAt: Number.isFinite(state?.lastSuccessAt) ? Number(state?.lastSuccessAt) : null,
  };
}

export function normalizeAutoProtection(value: Partial<VirtualModelAutoProtection> | null | undefined): VirtualModelAutoProtection {
  return {
    enabled: value?.enabled !== false,
    failureThreshold: Number.isFinite(value?.failureThreshold) && Number(value?.failureThreshold) > 0 ? Math.trunc(Number(value?.failureThreshold)) : 3,
    cooldownMs: Number.isFinite(value?.cooldownMs) && Number(value?.cooldownMs) >= 0 ? Math.trunc(Number(value?.cooldownMs)) : 600000,
  };
}

export function normalizeSystemPrompt(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

export function normalizeSelection(selection: Partial<VirtualModelSelection> | null | undefined): VirtualModelSelection {
  return {
    provider: typeof selection?.provider === 'string' ? selection.provider : '',
    modelId: typeof selection?.modelId === 'string' ? selection.modelId : '',
    priority: Number.isFinite(selection?.priority) ? Number(selection?.priority) : 1,
    enabled: selection?.enabled !== false,
    weight: Number.isFinite(selection?.weight) && Number(selection?.weight) > 0 ? Number(selection?.weight) : 1,
    fallbackOnly: selection?.fallbackOnly === true,
    capabilities: Array.isArray(selection?.capabilities)
      ? selection.capabilities.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
    memberState: normalizeMemberState(selection?.memberState),
  };
}

export function normalizeSelectedModels(selectedModels: unknown): VirtualModelSelection[] {
  if (!Array.isArray(selectedModels)) {
    return [];
  }

  return selectedModels
    .map((selection) => normalizeSelection(selection as Partial<VirtualModelSelection>))
    .filter((selection) => selection.provider && selection.modelId);
}

export function normalizeRecord(record: {
  id: string;
  name: string;
  description?: string | null;
  routingStrategy?: VirtualModelRecord['routingStrategy'];
  capabilities?: unknown;
  selectedModels?: unknown;
  autoAliases?: unknown;
  stickyMode?: unknown;
  autoProtection?: unknown;
  isBuiltin?: boolean;
  createdAt?: number;
  updatedAt?: number;
  systemPrompt?: unknown;
}): VirtualModelRecord {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    routingStrategy: record.routingStrategy ?? 'round-robin',
    capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((value): value is string => typeof value === 'string') : ['chat'],
    selectedModels: normalizeSelectedModels(record.selectedModels),
    systemPrompt: normalizeSystemPrompt(record.systemPrompt),
    autoAliases: Array.isArray(record.autoAliases) ? record.autoAliases.filter((value): value is string => typeof value === 'string') : [],
    stickyMode: normalizeStickyMode(record.stickyMode),
    autoProtection: normalizeAutoProtection(record.autoProtection as Partial<VirtualModelAutoProtection> | undefined),
    isBuiltin: record.isBuiltin === true,
    createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : 0,
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0,
  };
}
