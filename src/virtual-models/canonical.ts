import type { CanonicalModelInfo } from '../models/registry.js';
import { getVirtualModels } from './repository.js';
import type { VirtualModelRecord } from './types.js';

export function virtualModelToCanonicalModel(vm: VirtualModelRecord): CanonicalModelInfo {
  if (vm.selectedModels.length > 0) {
    return {
      id: vm.id,
      modality: 'Virtual',
      context: undefined,
      maxOutput: undefined,
      capabilities: vm.capabilities,
      isVirtual: true,
      providers: vm.selectedModels.map((sm) => ({
        name: sm.provider,
        providerModelId: sm.modelId,
        capabilities: vm.capabilities,
      })),
    };
  }

  return {
    id: vm.id,
    modality: 'Virtual',
    context: undefined,
    maxOutput: undefined,
    capabilities: vm.capabilities,
    isVirtual: true,
    providers: [],
  };
}

export function getVirtualModelCanonicalModels(): CanonicalModelInfo[] {
  return getVirtualModels().map(virtualModelToCanonicalModel);
}
