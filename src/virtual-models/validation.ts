import type { VirtualModelRecord, VirtualModelSelection } from './types.js';
import { normalizeSelectedModels } from './normalization.js';

export function findDuplicateSelectedModelKey(selectedModels: VirtualModelSelection[]): string | null {
  const seen = new Set();
  for (const selection of normalizeSelectedModels(selectedModels)) {
    const key = `${selection.provider}/${selection.modelId}`;
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return null;
}

export function findDuplicateAlias(aliases: string[]): string | null {
  const seen = new Set();
  for (const alias of aliases) {
    if (seen.has(alias)) {
      return alias;
    }
    seen.add(alias);
  }
  return null;
}

export function findConflictingAlias(models: VirtualModelRecord[], aliases: string[], excludeId?: string): string | null {
  const candidates = models.filter((model) => model.id !== excludeId);
  for (const alias of aliases) {
    const conflict = candidates.find((model) => model.id === alias || model.autoAliases.includes(alias));
    if (conflict) {
      return alias;
    }
  }
  return null;
}
