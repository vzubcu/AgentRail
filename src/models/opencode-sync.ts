import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ProviderModel } from '../types.js';

const CACHE_PATH = path.resolve(process.cwd(), '.agentrail', 'opencode-models.json');

interface OpenCodeModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface OpenCodeModelsResponse {
  data: OpenCodeModel[];
  object: string;
}

interface CacheEntry {
  updatedAt: number;
  models: ProviderModel[];
}

export async function fetchOpenCodeModels(): Promise<ProviderModel[]> {
  const response = await fetch('https://opencode.ai/zen/v1/models');

  if (!response.ok) {
    throw new Error(`OpenCode models fetch failed: ${response.status}`);
  }

  const payload = (await response.json()) as OpenCodeModelsResponse;

  const freeModels = payload.data.filter((m) => m.id.endsWith('-free'));

  const models: ProviderModel[] = freeModels.map((m) => ({
    id: m.id,
    providerModelId: m.id,
    modality: 'Text',
  }));

  return models;
}

export async function saveOpenCodeCache(models: ProviderModel[]): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const entry: CacheEntry = { updatedAt: Date.now(), models };
  await writeFile(CACHE_PATH, JSON.stringify(entry, null, 2));
}

export async function loadOpenCodeCache(): Promise<{ models: ProviderModel[]; updatedAt: number } | null> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CacheEntry;
    return { models: parsed.models, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}
