import { normalizeMemberState, normalizeSelection } from './normalization.js';
import { getAllVirtualModels, updateVirtualModel } from './repository.js';
import type { VirtualModelRecord, VirtualModelSelection } from './types.js';

export async function updateVirtualModelMemberRuntimeState(
  id: string,
  provider: string,
  modelId: string,
  updater: (selection: VirtualModelSelection) => VirtualModelSelection,
): Promise<VirtualModelRecord | null> {
  const existing = await getAllVirtualModels();
  const record = existing.find((entry) => entry.id === id);
  if (!record) return null;

  const nextSelectedModels = record.selectedModels.map((selection) => {
    if (selection.provider !== provider || selection.modelId !== modelId) {
      return normalizeSelection(selection);
    }
    return normalizeSelection(updater(normalizeSelection(selection)));
  });

  return updateVirtualModel(id, { selectedModels: nextSelectedModels });
}

export async function reconcileVirtualModelOperationalState(now = Date.now()): Promise<boolean> {
  const models = await getAllVirtualModels();
  let changedAny = false;

  for (const model of models) {
    let changedModel = false;
    const nextSelectedModels = model.selectedModels.map((selection) => {
      const normalized = normalizeSelection(selection);
      const memberState = normalizeMemberState(normalized.memberState);
      if (memberState.autoDisabledUntil && memberState.autoDisabledUntil <= now) {
        changedModel = true;
        changedAny = true;
        return {
          ...normalized,
          memberState: {
            ...memberState,
            consecutiveFailures: 0,
            autoDisabledUntil: null,
            lastRecoveredAt: now,
          },
        };
      }
      return normalized;
    });

    if (changedModel) {
      await updateVirtualModel(model.id, { selectedModels: nextSelectedModels });
    }
  }

  return changedAny;
}
