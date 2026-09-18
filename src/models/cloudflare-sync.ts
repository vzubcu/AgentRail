import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ProviderModel } from '../types.js';

const CACHE_PATH = path.resolve(process.cwd(), '.agentrail', 'cloudflare-models.json');

interface CloudflareModel {
  name: string;
  description?: string;
  task?: {
    name?: string;
  };
}

interface CloudflareModelsResponse {
  result: CloudflareModel[];
  success: boolean;
}

interface CacheEntry {
  updatedAt: number;
  models: ProviderModel[];
}

export async function fetchCloudflareModels(apiKey: string, accountId: string): Promise<ProviderModel[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Cloudflare Models fetch failed: ${response.status}`);
  }

  const payload = (await response.json()) as CloudflareModelsResponse;

  if (!payload.success || !payload.result) {
    throw new Error('Cloudflare API returned unsuccessful response');
  }

  const textModels = payload.result.filter(
    (m) => m.task?.name === 'Text Generation' || m.name.startsWith('@cf/')
  );

  const models: ProviderModel[] = textModels.map((m) => ({
    id: m.name.replace('@cf/', '').replace(/\//g, '-'),
    providerModelId: m.name,
    modality: 'Text',
  }));

  return models;
}

export async function saveCloudflareCache(models: ProviderModel[]): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const entry: CacheEntry = { updatedAt: Date.now(), models };
  await writeFile(CACHE_PATH, JSON.stringify(entry, null, 2));
}

export async function loadCloudflareCache(): Promise<{ models: ProviderModel[]; updatedAt: number } | null> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CacheEntry;
    return { models: parsed.models, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

export function mergeCloudflareWithAllowlist(
  fetched: ProviderModel[],
  allowlist: ProviderModel[]
): ProviderModel[] {
  const fetchedMap = new Map(fetched.map((m) => [m.providerModelId, m]));
  const result: ProviderModel[] = [];

  for (const allowed of allowlist) {
    const found = fetchedMap.get(allowed.providerModelId);
    if (found) {
      result.push({
        ...allowed,
        providerModelId: found.providerModelId,
      });
    }
  }

  return result;
}
