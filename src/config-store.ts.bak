import path from 'path';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';

export interface PersistedConfigV1 {
  version: 1;
  updatedAt: number;
  keys: Record<string, string | string[]>;
}

const CONFIG_DIR = path.resolve(process.cwd(), '.agentrail');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function normalizeKeyValue(value: unknown): string | string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = rawValues
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(/\r?\n|,/))
    .map((item) => item.trim())
    .filter(Boolean);

  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) return undefined;
  return uniqueValues.length === 1 ? uniqueValues[0] : uniqueValues;
}

function normalizeKeys(keys: Record<string, unknown>, allowedEnvVars: Set<string>): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  for (const [envVar, value] of Object.entries(keys)) {
    if (!allowedEnvVars.has(envVar)) continue;
    const normalizedValue = normalizeKeyValue(value);
    if (!normalizedValue) continue;
    normalized[envVar] = normalizedValue;
  }
  return normalized;
}

export async function loadLegacyPersistedConfig(allowedEnvVars: Set<string>): Promise<PersistedConfigV1 | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const data = JSON.parse(raw) as Partial<PersistedConfigV1>;
    if (data.version !== 1 || typeof data.updatedAt !== 'number' || typeof data.keys !== 'object' || !data.keys) {
      return null;
    }

    const keys = normalizeKeys(data.keys as Record<string, unknown>, allowedEnvVars);
    return {
      version: 1,
      updatedAt: data.updatedAt,
      keys,
    };
  } catch {
    return null;
  }
}

export async function clearLegacyPersistedConfig(): Promise<void> {
  const payload: PersistedConfigV1 = {
    version: 1,
    updatedAt: Date.now(),
    keys: {},
  };

  await mkdir(CONFIG_DIR, { recursive: true });
  const tempPath = `${CONFIG_PATH}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
  await rename(tempPath, CONFIG_PATH);
}

export function getPersistedConfigPath(): string {
  return CONFIG_PATH;
}
