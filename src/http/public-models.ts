import type { ModelSummary } from '../catalog.js';

export interface PublicModel {
  id: string;
  object: 'model';
  owned_by: string;
  capabilities?: string[];
  commercial_tier?: ModelSummary['commercialTier'];
  type?: 'embedding' | 'image' | 'audio' | 'video' | 'music' | 'search' | 'rerank' | 'moderation';
  subtype?: 'translation' | 'transcription' | 'speech';
}

function getSpecializedType(capabilities: string[]): Pick<PublicModel, 'type' | 'subtype'> {
  if (capabilities.includes('embeddings')) return { type: 'embedding' };
  if (capabilities.includes('image_generation') || capabilities.includes('image_edit')) return { type: 'image' };
  if (capabilities.includes('audio_translation')) return { type: 'audio', subtype: 'translation' };
  if (capabilities.includes('audio_transcription')) return { type: 'audio', subtype: 'transcription' };
  if (capabilities.includes('audio_generation')) return { type: 'audio', subtype: 'speech' };
  if (capabilities.includes('video_generation')) return { type: 'video' };
  if (capabilities.includes('music_generation')) return { type: 'music' };
  if (capabilities.includes('search')) return { type: 'search' };
  if (capabilities.includes('rerank')) return { type: 'rerank' };
  if (capabilities.includes('moderation')) return { type: 'moderation' };
  return {};
}

export function toPublicModel(model: ModelSummary): PublicModel {
  const capabilities = model.capabilities ?? [];
  return {
    id: model.id,
    object: 'model',
    owned_by: model.providers.map((provider) => provider.name).join(', '),
    capabilities,
    commercial_tier: model.commercialTier,
    ...getSpecializedType(capabilities),
  };
}

export function toAgentRailPublicModel(id: string, capabilities: string[] = ['chat']): PublicModel {
  return { id, object: 'model', owned_by: 'agentrail', capabilities, ...getSpecializedType(capabilities) };
}