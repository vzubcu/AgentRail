import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { VIRTUAL_MODELS_JSON_PATH } from './constants.js';
import { normalizeRecord } from './normalization.js';
import type { VirtualModelRecord } from './types.js';

let virtualModelsJsonLoaded = false;
let cachedVirtualModels: VirtualModelRecord[] | null = null;

export function getCachedVirtualModels(): VirtualModelRecord[] | null {
  return cachedVirtualModels;
}

export function setCachedVirtualModels(models: VirtualModelRecord[] | null): void {
  cachedVirtualModels = models;
}

export async function loadVirtualModelsFromJson(): Promise<void> {
  if (virtualModelsJsonLoaded) return;
  virtualModelsJsonLoaded = true;
  try {
    const raw = await readFile(VIRTUAL_MODELS_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as VirtualModelRecord[];
    cachedVirtualModels = Array.isArray(parsed)
      ? parsed.map((record) => normalizeRecord(record))
      : null;
    console.log(`[VirtualModels] Loaded ${cachedVirtualModels?.length ?? 0} virtual models from JSON`);
  } catch {
    cachedVirtualModels = null;
  }
}

export async function saveVirtualModelsToJson(): Promise<void> {
  const entries = cachedVirtualModels ?? [];
  await mkdir(path.dirname(VIRTUAL_MODELS_JSON_PATH), { recursive: true });
  await writeFile(VIRTUAL_MODELS_JSON_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}
