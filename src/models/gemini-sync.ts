import type { OpenAIModelEntry } from './sync.js';

interface GeminiModelEntry {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsResponse {
  models?: GeminiModelEntry[];
  nextPageToken?: string;
}

const INCOMPATIBLE_GENERATE_CONTENT_MODEL = /(embedding|imagen|veo|lyria|live|native[-_]?audio|image|robotics|computer[-_]?use|antigravity|deep[-_]?research|nano[-_]?banana|omni|aqa|text[-_]?to[-_]?speech|tts)/i;

export function isGeminiChatModelId(rawName: string): boolean {
  const name = rawName.replace(/^models\//, '').trim();
  return name.length > 0 && !INCOMPATIBLE_GENERATE_CONTENT_MODEL.test(name);
}

export function isGeminiChatModel(model: GeminiModelEntry): boolean {
  const supportedMethods = model.supportedGenerationMethods ?? [];
  return supportedMethods.includes('generateContent')
    && isGeminiChatModelId(String(model.name ?? ''));
}

export async function fetchGeminiChatModels(
  modelsUrl: string,
  headers: Record<string, string>,
): Promise<OpenAIModelEntry[]> {
  const fetched: OpenAIModelEntry[] = [];
  let pageToken = '';

  do {
    const url = new URL(modelsUrl);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Models fetch failed: ${response.status}`);
    }

    const payload = await response.json() as GeminiModelsResponse;
    fetched.push(...(payload.models ?? [])
      .filter(isGeminiChatModel)
      .map((model) => ({
        id: String(model.name).replace(/^models\//, ''),
        object: 'model',
      })));
    pageToken = String(payload.nextPageToken ?? '').trim();
  } while (pageToken);

  return fetched;
}