import type { VirtualModelAutoProtection, VirtualModelRecord, VirtualModelSelection, VirtualModelStickyMode } from './types.js';
import { normalizeAutoProtection, normalizeMemberState, normalizeSelection, normalizeStickyMode } from './normalization.js';

function cloneSelectionWithoutRuntimeState(selection: VirtualModelSelection): VirtualModelSelection {
  const normalized = normalizeSelection(selection);
  return {
    ...normalized,
    memberState: normalizeMemberState(undefined),
  };
}

export function buildVirtualModelCloneInput(
  source: VirtualModelRecord,
  overrides: {
    id: string;
    name: string;
    description?: string | null;
    autoAliases?: string[];
  },
): {
  id: string;
  name: string;
  description?: string | null;
  routingStrategy: 'priority' | 'round-robin' | 'random';
  capabilities: string[];
  selectedModels: VirtualModelSelection[];
  autoAliases: string[];
  stickyMode: VirtualModelStickyMode;
  autoProtection: VirtualModelAutoProtection;
  isBuiltin: false;
  systemPrompt: string | null;
} {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description !== undefined ? overrides.description : source.description,
    routingStrategy: source.routingStrategy,
    capabilities: [...source.capabilities],
    selectedModels: source.selectedModels.map(cloneSelectionWithoutRuntimeState),
    autoAliases: Array.isArray(overrides.autoAliases) ? overrides.autoAliases : [],
    stickyMode: normalizeStickyMode(source.stickyMode),
    autoProtection: normalizeAutoProtection(source.autoProtection),
    isBuiltin: false,
    systemPrompt: source.systemPrompt,
  };
}
