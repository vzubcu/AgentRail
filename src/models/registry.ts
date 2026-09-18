import { providers } from '../providers/index.js';
import { inferCapabilities, mergeCapabilities, type ModelCapability } from './capabilities.js';
import type { ProviderModel } from '../types.js';
import { getVirtualModelCanonicalModels, hasVirtualModelsInDb, FALLBACK_FILES_MODEL_ID } from '../virtual-models.js';
import { isProviderHealthy } from '../health.js';

export interface CanonicalModelInfo {
  id: string;
  modality?: string;
  context?: number;
  maxOutput?: number;
  capabilities?: string[];
  isVirtual?: boolean;
  providers: { name: string; providerModelId: string; capabilities?: string[] }[];
}

function looksEmbeddingOnly(model: Pick<ProviderModel, 'id' | 'providerModelId' | 'modality'>): boolean {
  const text = `${model.id} ${model.providerModelId} ${model.modality ?? ''}`.toLowerCase();
  return /(^|[^a-z])(embedding(s)?|embed(qa|code)?|rerank)([^a-z]|$)/.test(text);
}

function explicitChatHint(model: Pick<ProviderModel, 'id' | 'providerModelId' | 'modality'>): boolean {
  const text = `${model.id} ${model.providerModelId} ${model.modality ?? ''}`.toLowerCase();
  return /(instruct|assistant|chat|completion|reasoning|->\s*text|text\s*\+\s*(vision|image)|vision\s*\+\s*text|codegemma|codellama|codestral|starcoder|command[-\s]?[ar])/.test(text);
}

function resolveCanonicalCapabilities(model: ProviderModel): ModelCapability[] {
  const stored = model.capabilities;
  const inferred = inferCapabilities({ ...model, capabilities: undefined });
  let resolved = mergeCapabilities(stored, inferred) ?? inferred;

  if (looksEmbeddingOnly(model) && !explicitChatHint(model)) {
    resolved = resolved.filter((capability): capability is ModelCapability => capability !== 'chat');
    if (!resolved.includes('embeddings')) {
      resolved = [...resolved, 'embeddings'];
    }
  }

  return resolved;
}

/** Fallback virtual models used when the DB is unavailable or empty. */
function buildFallbackVirtualModels(): CanonicalModelInfo[] {
  const fileProviders = providers.flatMap((provider) =>
    provider.models
      .filter((model) => !provider.isModelBlocked(model.id))
      .filter((model) => resolveCanonicalCapabilities(model).includes('file_input'))
      .map((model) => ({
        name: provider.name,
        providerModelId: model.providerModelId,
        capabilities: resolveCanonicalCapabilities(model),
      })),
  );

  if (fileProviders.length === 0) {
    return [];
  }

  return [
    {
      id: FALLBACK_FILES_MODEL_ID,
      modality: 'Virtual',
      capabilities: ['chat', 'file_input'],
      isVirtual: true,
      providers: fileProviders,
    },
  ];
}

export function filterCanonicalModelsByCapability(
  models: CanonicalModelInfo[],
  capability: ModelCapability,
): CanonicalModelInfo[] {
  return models.filter((model) => (model.capabilities ?? []).includes(capability));
}

export function listCanonicalModels(): CanonicalModelInfo[] {
  const map = new Map<string, CanonicalModelInfo>();

  for (const provider of providers) {
    for (const model of provider.models) {
      if (provider.isModelBlocked(model.id)) {
        continue;
      }

      const capabilities = resolveCanonicalCapabilities(model);
      const existing = map.get(model.id);
      if (existing) {
        existing.providers.push({
          name: provider.name,
          providerModelId: model.providerModelId,
          capabilities,
        });
        if (model.context !== undefined) {
          existing.context = Math.max(existing.context ?? 0, model.context) || undefined;
        }
        if (model.maxOutput !== undefined) {
          existing.maxOutput = Math.max(existing.maxOutput ?? 0, model.maxOutput) || undefined;
        }
        existing.capabilities = mergeCapabilities(existing.capabilities, capabilities);
      } else {
        map.set(model.id, {
          id: model.id,
          modality: model.modality,
          context: model.context,
          maxOutput: model.maxOutput,
          capabilities,
          providers: [{ name: provider.name, providerModelId: model.providerModelId, capabilities }],
        });
      }
    }
  }

  const canonicalModels = Array.from(map.values());

  // Add virtual models — either from DB cache or fallback defaults
  const virtualModels = hasVirtualModelsInDb()
    ? getVirtualModelCanonicalModels()
    : buildFallbackVirtualModels();

  return [...canonicalModels, ...virtualModels].sort((a, b) => a.id.localeCompare(b.id));
}

export function getCanonicalModelById(id: string): CanonicalModelInfo | undefined {
  return listCanonicalModels().find((model) => model.id === id);
}
