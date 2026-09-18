import type { ProviderModel } from '../types.js';

export const MODEL_CAPABILITIES = [
  'chat',
  'vision',
  'file_input',
  'image_generation',
  'image_edit',
  'audio_transcription',
  'audio_translation',
  'audio_generation',
  'video_generation',
  'music_generation',
  'embeddings',
  'search',
  'rerank',
  'moderation',
] as const;

export type ModelCapability = typeof MODEL_CAPABILITIES[number];

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

export function normalizeCapabilities(capabilities?: string[]): ModelCapability[] | undefined {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return undefined;
  }

  const normalized = dedupe(capabilities).filter((value): value is ModelCapability => {
    return MODEL_CAPABILITIES.includes(value as ModelCapability);
  });

  return normalized.length > 0 ? normalized : undefined;
}

function addCapability(target: Set<string>, capability: ModelCapability) {
  target.add(capability);
}

export function inferCapabilities(model: Pick<ProviderModel, 'id' | 'providerModelId' | 'modality' | 'capabilities'>): ModelCapability[] {
  const existing = normalizeCapabilities(model.capabilities);
  if (existing) {
    return existing;
  }

  const text = `${model.id} ${model.providerModelId} ${model.modality ?? ''}`.toLowerCase();
  const inferred = new Set<string>();

  if (/(^|[^a-z])embedding(s)?([^a-z]|$)/.test(text)) {
    addCapability(inferred, 'embeddings');
  }

  if (/(whisper|transcri|speech[-_\s]?to[-_\s]?text|audio\s*[→-]\s*text|asr|parakeet|canary)/.test(text)) {
    addCapability(inferred, 'audio_transcription');
  }

  if (/(whisper|audio[-_\s]?translat(?:e|ion)|speech[-_\s]?translat(?:e|ion)|translat(?:e|ion)[-_\s]?(?:audio|speech))/.test(text)) {
    addCapability(inferred, 'audio_translation');
  }

  if (/(tts|text[-_\s]?to[-_\s]?speech|audio generation|audio synthesis)/.test(text)) {
    addCapability(inferred, 'audio_generation');
  }

  if (/(music|suno|udio)/.test(text)) {
    addCapability(inferred, 'music_generation');
  }

  if (/(video|cosmos|veo|wan[-_\s]?2|ltx[-_\s]?video)/.test(text)) {
    addCapability(inferred, 'video_generation');
  }

  if (/(image[-_\s]?generation|text\s*[→-]\s*image|text[-_\s]?to[-_\s]?image|stable[-_\s]?diffusion|flux|imagen|sana|image model)/.test(text)) {
    addCapability(inferred, 'image_generation');
  }

  if (/(image[-_\s]?edit|image[-_\s]?editing|edit[-_\s]?image|inpaint)/.test(text)) {
    addCapability(inferred, 'image_edit');
  }

  if (/(search|serp|web[-_\s]?search)/.test(text)) {
    addCapability(inferred, 'search');
  }

  if (/(rerank|reranker|ranking)/.test(text)) {
    addCapability(inferred, 'rerank');
  }

  if (/(moderat|safety[-_\s]?check|content[-_\s]?filter)/.test(text)) {
    addCapability(inferred, 'moderation');
  }

  if (/(vision|ocr|multimodal|text\s*\+\s*vision|vision\s*\+\s*text|text\s*\+\s*image|image\s*\+\s*text)/.test(text)) {
    addCapability(inferred, 'vision');
  }

  const NON_CHAT_CAPS: ModelCapability[] = [
    'image_generation', 'image_edit', 'video_generation',
    'music_generation', 'audio_generation', 'audio_transcription', 'audio_translation', 'embeddings',
    'search', 'rerank', 'moderation',
  ];
  const hasNonChatCap = NON_CHAT_CAPS.some((cap) => inferred.has(cap));
  if (inferred.size === 0 || !hasNonChatCap || /(instruct|assistant|chat|llm|reasoning|code)/i.test(text)) {
    addCapability(inferred, 'chat');
  }

  return normalizeCapabilities(Array.from(inferred)) ?? ['chat'];
}

export function mergeCapabilities(...sources: Array<string[] | undefined>): ModelCapability[] | undefined {
  const merged = normalizeCapabilities(sources.flatMap((source) => source ?? []));
  return merged;
}
