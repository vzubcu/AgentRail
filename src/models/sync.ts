import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ProviderModel } from '../types.js';
import { inferCapabilities, mergeCapabilities } from './capabilities.js';

const CACHE_DIR = path.resolve(process.cwd(), '.agentrail', 'models');

export interface OpenAIModelEntry {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface OpenAIModelsResponse {
  data: OpenAIModelEntry[];
  object: string;
}

interface ProviderModelCache {
  updatedAt: number;
  models: ProviderModel[];
}

function normalizeFetchedModelId(rawId: string): string {
  return rawId
    .replace(/^providers?\//, '')
    .replace(/^[^/]+\//, '')
    .replace(/:(free|latest)$/i, '')
    .replace(/-(instruct|it|chat)$/i, '')
    .replace(/-\d{6,}$/i, '')
    .replace(/-v\d+(?:\.\d+)*$/i, '')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

export async function fetchOpenAIModels(
  baseURL: string,
  apiKeyOrHeaders: string | Record<string, string>,
  headers?: Record<string, string>,
): Promise<OpenAIModelEntry[]> {
  const resolvedHeaders = typeof apiKeyOrHeaders === 'string'
    ? (headers ?? { Authorization: `Bearer ${apiKeyOrHeaders}` })
    : apiKeyOrHeaders;

  const response = await fetch(baseURL, {
    headers: resolvedHeaders,
  });

  if (!response.ok) {
    throw new Error(`Models fetch failed: ${response.status}`);
  }

  const payload = (await response.json()) as OpenAIModelsResponse;
  return payload.data ?? [];
}

export function mergeWithAllowlist(
  fetched: OpenAIModelEntry[],
  allowlist: ProviderModel[]
): ProviderModel[] {
  const fetchedMap = new Map(fetched.map((m) => [m.id, m]));
  const result: ProviderModel[] = [];

  for (const allowed of allowlist) {
    const found = fetchedMap.get(allowed.providerModelId);
    result.push({
      ...allowed,
      providerModelId: found?.id ?? allowed.providerModelId,
    });
  }

  return result;
}

export function keepFetchedAllowlistModels(
  fetched: OpenAIModelEntry[],
  allowlist: ProviderModel[],
): ProviderModel[] {
  const fetchedIds = new Set(fetched.map((model) => model.id));

  return allowlist
    .filter((allowed) => fetchedIds.has(allowed.providerModelId))
    .map((allowed) => ({
      ...allowed,
      capabilities: mergeCapabilities(allowed.capabilities, inferCapabilities(allowed)),
    }))
    .filter((model) => model.capabilities?.includes('chat') ?? false);
}

export function mergeFetchedModels(
  fetched: OpenAIModelEntry[],
  allowlist: ProviderModel[],
): ProviderModel[] {
  const allowlistByProviderId = new Map(allowlist.map((model) => [model.providerModelId, model]));
  const merged = new Map<string, ProviderModel>();

  for (const fetchedModel of fetched) {
    const matched = allowlistByProviderId.get(fetchedModel.id);
    const nextModel: ProviderModel = matched
      ? {
          ...matched,
          providerModelId: fetchedModel.id,
          capabilities: mergeCapabilities(matched.capabilities, inferCapabilities(matched)),
        }
      : {
          id: normalizeFetchedModelId(fetchedModel.id),
          providerModelId: fetchedModel.id,
          modality: 'Text',
          capabilities: inferCapabilities({
            id: normalizeFetchedModelId(fetchedModel.id),
            providerModelId: fetchedModel.id,
            modality: 'Text',
          }),
        };
    merged.set(nextModel.providerModelId, nextModel);
  }

  return Array.from(merged.values()).filter((model) => model.capabilities?.includes('chat') ?? false);
}

export async function saveProviderModelCache(providerName: string, models: ProviderModel[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry: ProviderModelCache = { updatedAt: Date.now(), models };
  await writeFile(path.join(CACHE_DIR, `${providerName}.json`), JSON.stringify(entry, null, 2));
}

export async function loadProviderModelCache(providerName: string): Promise<{ models: ProviderModel[]; updatedAt: number } | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${providerName}.json`), 'utf-8');
    const parsed = JSON.parse(raw) as ProviderModelCache;
    return { models: parsed.models, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}
