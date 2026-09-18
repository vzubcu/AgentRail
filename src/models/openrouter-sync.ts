import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ProviderModel } from '../types.js';
import { inferCapabilities } from './capabilities.js';

const CACHE_PATH = path.resolve(process.cwd(), '.agentrail', 'openrouter-models.json');

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  top_provider?: { max_completion_tokens?: number };
  architecture?: { modality?: string };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface CacheEntry {
  updatedAt: number;
  models: ProviderModel[];
}

function normalizeId(rawId: string): string {
  let id = rawId.replace(/:free$/, '');
  const slashIdx = id.indexOf('/');
  if (slashIdx > 0) {
    id = id.slice(slashIdx + 1);
  }
  id = id.replace(/-(instruct|it|chat)$/, '');
  id = id.replace(/-\d{6,}$/, '');
  id = id.replace(/-v\d+-\d+$/, '');
  return id;
}

export async function fetchOpenRouterModels(apiKey?: string): Promise<ProviderModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', { headers });
  if (!response.ok) {
    throw new Error(`OpenRouter models fetch failed: ${response.status}`);
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;

  const freeModels = payload.data.filter((m) => {
    return m.pricing?.prompt === '0' && m.pricing?.completion === '0';
  });

  const seen = new Set<string>();
  const models: ProviderModel[] = [];

  for (const m of freeModels) {
    const id = normalizeId(m.id);
    if (seen.has(id)) continue;
    seen.add(id);

    models.push({
      id,
      providerModelId: m.id,
      context: m.context_length || undefined,
      maxOutput: m.top_provider?.max_completion_tokens || undefined,
      modality: m.architecture?.modality || 'Text',
      capabilities: inferCapabilities({
        id,
        providerModelId: m.id,
        modality: m.architecture?.modality || 'Text',
      }),
    });
  }

  return models;
}

export async function saveOpenRouterCache(models: ProviderModel[]): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const entry: CacheEntry = { updatedAt: Date.now(), models };
  await writeFile(CACHE_PATH, JSON.stringify(entry, null, 2));
}

export async function loadOpenRouterCache(): Promise<{ models: ProviderModel[]; updatedAt: number } | null> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CacheEntry;
    return { models: parsed.models, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}
