import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  DEFAULT_COMPRESSION_CONFIG,
  type CompressionConfig,
  type CompressionMode,
} from './compress.js';

const CONFIG_DIR = path.resolve(process.cwd(), '.agentrail');
const CONFIG_PATH = path.join(CONFIG_DIR, 'compression.json');

let cachedConfig: CompressionConfig | null = null;

function isValidMode(value: unknown): value is CompressionMode {
  return value === 'none' || value === 'drop_oldest' || value === 'truncate';
}

function coerceConfig(raw: unknown): CompressionConfig {
  const base = DEFAULT_COMPRESSION_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...base };

  const data = raw as Record<string, unknown>;
  const mode = isValidMode(data.mode) ? data.mode : base.mode;
  const keepLastN = typeof data.keepLastN === 'number' && data.keepLastN >= 0
    ? Math.floor(data.keepLastN)
    : base.keepLastN;
  const maxCharsPerPart = typeof data.maxCharsPerPart === 'number' && data.maxCharsPerPart >= 0
    ? Math.floor(data.maxCharsPerPart)
    : base.maxCharsPerPart;
  const preserveSystem = typeof data.preserveSystem === 'boolean'
    ? data.preserveSystem
    : base.preserveSystem;

  return { mode, keepLastN, maxCharsPerPart, preserveSystem };
}

export async function loadCompressionConfig(): Promise<CompressionConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    cachedConfig = coerceConfig(data.config ?? data);
    return cachedConfig;
  } catch {
    cachedConfig = { ...DEFAULT_COMPRESSION_CONFIG };
    return cachedConfig;
  }
}

export async function saveCompressionConfig(input: unknown): Promise<CompressionConfig> {
  const next = coerceConfig(input);
  cachedConfig = next;

  await mkdir(CONFIG_DIR, { recursive: true });
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    config: next,
  };
  const tempPath = `${CONFIG_PATH}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
  await rename(tempPath, CONFIG_PATH);
  return next;
}

export function getCompressionConfigSync(): CompressionConfig {
  return cachedConfig ?? { ...DEFAULT_COMPRESSION_CONFIG };
}

export function resetCompressionConfigCache(): void {
  cachedConfig = null;
}