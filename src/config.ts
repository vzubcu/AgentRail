import { createHash } from 'node:crypto';
import { getPersistedConfigPath, loadLegacyPersistedConfig } from './config-store.js';
import {
  getSecretStoreMeta,
  hasManagedGatewayApiKey,
  initializeSecretStore,
  isSecretStoreConfigured,
  loadManagedProviderKeys,
  saveManagedProviderKeys,
  setManagedGatewayApiKey,
  validateManagedGatewayApiKey,
} from './secrets-store.js';

export type ApiKeyValue = string | string[];
export type ApiKeySource = 'managed' | 'environment';

export interface ApiKeySummaryEntry {
  fingerprint: string;
  preview: string;
  secondaryLabel?: string;
  secondaryPreview?: string;
  source: ApiKeySource;
}

export interface ApiKeySummary {
  configured: boolean;
  managedCount: number;
  environmentCount: number;
  effectiveCount: number;
  keys: ApiKeySummaryEntry[];
}

const runtimeApiKeys = new Map<string, string[]>();
const persistedApiKeys = new Map<string, string[]>();
const clearedManagedApiKeys = new Set<string>();
const apiKeyRoundRobinIndexes = new Map<string, number>();
const CLOUDFLARE_CREDENTIAL_SEPARATOR = '::cf-account::';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_TIMEOUT_MS = 2_147_483_647;

let configMeta: { persistedPath: string | null; persistedUpdatedAt: number | null } = {
  persistedPath: null,
  persistedUpdatedAt: null,
};

export function resolveProviderTimeoutMs(value: string | number | undefined): number {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === undefined || raw === '') return DEFAULT_PROVIDER_TIMEOUT_MS;

  const timeoutMs = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_PROVIDER_TIMEOUT_MS) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  return timeoutMs;
}

export function getProviderTimeoutMs(): number {
  return resolveProviderTimeoutMs(process.env.AGENTRAIL_PROVIDER_TIMEOUT_MS);
}

function normalizeApiKeyValue(value: unknown): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(/\r?\n|,/))
    .map((item) => item.trim())
    .filter(Boolean))];
}

function envApiKeys(envVar: string): string[] {
  return normalizeApiKeyValue(process.env[envVar]);
}

function getManagedApiKeys(envVar: string): string[] {
  if (clearedManagedApiKeys.has(envVar)) {
    return [];
  }

  const runtime = runtimeApiKeys.get(envVar);
  if (runtime?.length) return [...runtime];

  const persisted = persistedApiKeys.get(envVar);
  return persisted ? [...persisted] : [];
}

function getApiKeyFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function fingerprintApiKey(value: string): string {
  return getApiKeyFingerprint(value);
}

function previewApiKey(value: string): string {
  if (value.length <= 8) return `...${value.slice(-4)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export interface CloudflareCredential {
  raw: string;
  apiKey: string;
  accountId: string;
}

export function buildCloudflareCredentialValue(apiKey: string, accountId: string): string {
  return `${apiKey.trim()}${CLOUDFLARE_CREDENTIAL_SEPARATOR}${accountId.trim()}`;
}

export function parseCloudflareCredentialValue(value: string): CloudflareCredential | null {
  const separatorIndex = value.indexOf(CLOUDFLARE_CREDENTIAL_SEPARATOR);
  if (separatorIndex === -1) return null;

  const apiKey = value.slice(0, separatorIndex).trim();
  const accountId = value.slice(separatorIndex + CLOUDFLARE_CREDENTIAL_SEPARATOR.length).trim();
  if (!apiKey || !accountId) return null;

  return { raw: value, apiKey, accountId };
}

function resolveCloudflareCredential(value: string | undefined): CloudflareCredential | undefined {
  if (!value) return undefined;

  const paired = parseCloudflareCredentialValue(value);
  if (paired) return paired;

  const accountId = getEffectiveApiKey('CLOUDFLARE_ACCOUNT_ID')?.trim();
  if (!accountId) return undefined;

  return {
    raw: value,
    apiKey: value.trim(),
    accountId,
  };
}

export function getEffectiveCloudflareCredential(): CloudflareCredential | undefined {
  return resolveCloudflareCredential(getEffectiveApiKey('CLOUDFLARE_API_KEY'));
}

export function getNextCloudflareCredential(): CloudflareCredential | undefined {
  return resolveCloudflareCredential(getNextApiKey('CLOUDFLARE_API_KEY'));
}

export function setRuntimeApiKey(envVar: string, value: unknown) {
  const keys = normalizeApiKeyValue(value);
  apiKeyRoundRobinIndexes.delete(envVar);
  if (keys.length > 0) {
    runtimeApiKeys.set(envVar, keys);
    clearedManagedApiKeys.delete(envVar);
  } else {
    runtimeApiKeys.delete(envVar);
    clearedManagedApiKeys.add(envVar);
  }
}

export function getRuntimeApiKey(envVar: string): string | undefined {
  return runtimeApiKeys.get(envVar)?.[0];
}

export function getEffectiveApiKeys(envVar: string): string[] {
  if (clearedManagedApiKeys.has(envVar)) {
    const environment = envApiKeys(envVar);
    return environment.length ? environment : [];
  }

  const runtime = runtimeApiKeys.get(envVar);
  if (runtime?.length) return [...runtime];

  const environment = envApiKeys(envVar);
  if (environment.length) return environment;

  const persisted = persistedApiKeys.get(envVar);
  return persisted ? [...persisted] : [];
}

export function getEffectiveApiKeyFingerprints(envVar: string): string[] {
  return getEffectiveApiKeys(envVar).map((key) => getApiKeyFingerprint(key));
}

export function getEffectiveApiKey(envVar: string): string | undefined {
  return getEffectiveApiKeys(envVar)[0];
}

export function getNextApiKey(envVar: string): string | undefined {
  const keys = getEffectiveApiKeys(envVar);
  if (keys.length === 0) return undefined;

  const currentIndex = apiKeyRoundRobinIndexes.get(envVar) ?? 0;
  const key = keys[currentIndex % keys.length];
  apiKeyRoundRobinIndexes.set(envVar, (currentIndex + 1) % keys.length);
  return key;
}

export function addRuntimeApiKey(envVar: string, value: unknown): string[] {
  const nextKeys = [...getManagedApiKeys(envVar), ...normalizeApiKeyValue(value)];
  setRuntimeApiKey(envVar, nextKeys);
  return getManagedApiKeys(envVar);
}

export function removeRuntimeApiKeyByFingerprint(envVar: string, fingerprint: string): boolean {
  const currentKeys = getManagedApiKeys(envVar);
  const nextKeys = currentKeys.filter((key) => getApiKeyFingerprint(key) !== fingerprint);
  if (nextKeys.length === currentKeys.length) return false;

  setRuntimeApiKey(envVar, nextKeys);
  return true;
}

export function buildApiKeySummary(envVar: string): ApiKeySummary {
  const managedKeys = getManagedApiKeys(envVar);
  const environmentKeys = envApiKeys(envVar);
  const effectiveKeys = getEffectiveApiKeys(envVar);
  const summarizeKey = (key: string, source: ApiKeySource): ApiKeySummaryEntry => {
    const cloudflareCredential = envVar === 'CLOUDFLARE_API_KEY' ? parseCloudflareCredentialValue(key) : null;
    return {
      fingerprint: getApiKeyFingerprint(key),
      preview: previewApiKey(cloudflareCredential?.apiKey ?? key),
      secondaryLabel: cloudflareCredential ? 'Account ID' : undefined,
      secondaryPreview: cloudflareCredential ? previewApiKey(cloudflareCredential.accountId) : undefined,
      source,
    };
  };

  return {
    configured: effectiveKeys.length > 0,
    managedCount: managedKeys.length,
    environmentCount: environmentKeys.length,
    effectiveCount: effectiveKeys.length,
    keys: [
      ...managedKeys.map((key) => summarizeKey(key, 'managed')),
      ...environmentKeys.map((key) => summarizeKey(key, 'environment')),
    ],
  };
}

export function hasConfiguredApiKey(envVar: string): boolean {
  return !!getEffectiveApiKey(envVar);
}

export function exportConfigurableApiKeys(allowedEnvVars: Set<string>): Record<string, ApiKeyValue> {
  const keys: Record<string, ApiKeyValue> = {};

  for (const envVar of allowedEnvVars) {
    if (clearedManagedApiKeys.has(envVar)) {
      continue;
    }

    const persisted = persistedApiKeys.get(envVar);
    if (persisted?.length) keys[envVar] = persisted.length === 1 ? persisted[0] : persisted;
  }

  for (const envVar of allowedEnvVars) {
    if (clearedManagedApiKeys.has(envVar)) {
      delete keys[envVar];
      continue;
    }

    const runtime = runtimeApiKeys.get(envVar);
    if (runtime?.length) {
      keys[envVar] = runtime.length === 1 ? runtime[0] : runtime;
    }
  }

  return keys;
}

export async function initializePersistedApiKeys(allowedEnvVars: Set<string>): Promise<void> {
  persistedApiKeys.clear();
  clearedManagedApiKeys.clear();

  if (isSecretStoreConfigured()) {
    await initializeSecretStore(allowedEnvVars);
    const persisted = await loadManagedProviderKeys(allowedEnvVars);
    for (const [envVar, values] of Object.entries(persisted)) {
      const keys = normalizeApiKeyValue(values);
      if (keys.length > 0) persistedApiKeys.set(envVar, keys);
    }

    const secretMeta = getSecretStoreMeta();
    configMeta = {
      persistedPath: secretMeta.persistedPath,
      persistedUpdatedAt: secretMeta.persistedUpdatedAt,
    };
    return;
  }

  const legacy = await loadLegacyPersistedConfig(allowedEnvVars);
  if (!legacy) {
    configMeta = { persistedPath: getPersistedConfigPath(), persistedUpdatedAt: null };
    return;
  }

  for (const [envVar, value] of Object.entries(legacy.keys)) {
    const keys = normalizeApiKeyValue(value);
    if (keys.length > 0) persistedApiKeys.set(envVar, keys);
  }

  configMeta = {
    persistedPath: getPersistedConfigPath(),
    persistedUpdatedAt: legacy.updatedAt,
  };
}

export async function persistRuntimeApiKeys(allowedEnvVars: Set<string>): Promise<void> {
  const keys = exportConfigurableApiKeys(allowedEnvVars);
  const result = await saveManagedProviderKeys(allowedEnvVars, keys);

  persistedApiKeys.clear();
  for (const [envVar, value] of Object.entries(keys)) {
    const normalized = normalizeApiKeyValue(value);
    if (normalized.length > 0) persistedApiKeys.set(envVar, normalized);
  }

  clearedManagedApiKeys.clear();
  configMeta = {
    persistedPath: result.persistedPath,
    persistedUpdatedAt: result.persistedUpdatedAt,
  };
}

export function getConfigMeta(): { persistedPath: string | null; persistedUpdatedAt: number | null } {
  return configMeta;
}

const envAgentRailApiKey = process.env.AGENTRAIL_API_KEY?.trim() || undefined;
let runtimeAgentRailApiKey: string | undefined = envAgentRailApiKey;

export async function hasAgentRailApiKey(): Promise<boolean> {
  return !!runtimeAgentRailApiKey || await hasManagedGatewayApiKey();
}

export async function isAgentRailApiKey(candidate: string): Promise<boolean> {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (runtimeAgentRailApiKey) {
    return trimmed === runtimeAgentRailApiKey;
  }
  return validateManagedGatewayApiKey(trimmed);
}

export async function setAgentRailApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  runtimeAgentRailApiKey = trimmed || undefined;
  if (!isSecretStoreConfigured()) {
    return;
  }
  await setManagedGatewayApiKey(trimmed);
}
