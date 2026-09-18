import { getAllSyncMetas, providers } from './providers/index.js';
import { getHealthSummary, getProviderHealth, type HealthSummary, type ProviderHealth } from './health.js';
import { filterCanonicalModelsByCapability, listCanonicalModels } from './models/registry.js';
import { getEffectiveApiKey, getEffectiveCloudflareCredential } from './config.js';
import { mergeCapabilities, type ModelCapability } from './models/capabilities.js';
import { classifyCommercialTier, type CommercialTier } from './models/commercial-tiers.js';

export interface ProviderSummary {
  name: string;
  baseURL: string;
  apiKeyEnvVar: string;
  envVars: string[];
  envVarsConfigured: Record<string, boolean>;
  available: boolean;
  modelCount: number;
  health: ProviderHealth;
  website?: string;
  apiKeyInstructions: string[];
}

export interface ModelSummary {
  id: string;
  providers: { name: string; providerModelId: string }[];
  context?: number;
  maxOutput?: number;
  modality?: string;
  capabilities?: string[];
  isVirtual?: boolean;
  commercialTier: CommercialTier;
  commercialNote?: string;
}

export interface CatalogSummary {
  providers: ProviderSummary[];
  models: ModelSummary[];
  healthSummary: HealthSummary;
  syncMetas: Record<string, { updatedAt: number; source: string; validation?: unknown }>;
}

export function listProviderSummaries(): ProviderSummary[] {
  return providers.map(provider => {
    const envVarsConfigured: Record<string, boolean> = {};
    for (const envVar of provider.envVars) {
      envVarsConfigured[envVar] = provider.name === 'cloudflare' && envVar === 'CLOUDFLARE_ACCOUNT_ID'
        ? !!getEffectiveCloudflareCredential()?.accountId
        : !!getEffectiveApiKey(envVar);
    }
    return {
      name: provider.name,
      baseURL: provider.baseURL,
      apiKeyEnvVar: provider.apiKeyEnvVar,
      envVars: provider.envVars,
      envVarsConfigured,
      available: provider.isAvailable,
      modelCount: provider.models.length,
      health: getProviderHealth(provider.name, provider.isAvailable),
      website: provider.website,
      apiKeyInstructions: provider.apiKeyInstructions,
    };
  });
}

export function listProviderEnvVars(): string[] {
  return [...new Set(providers.flatMap(provider => provider.envVars))];
}

export function listModelSummaries(requiredCapability: ModelCapability = 'chat'): ModelSummary[] {
  return filterCanonicalModelsByCapability(listCanonicalModels(), requiredCapability)
    .map((model) => ({
      ...model,
      ...classifyCommercialTier(model),
    }));
}

export function isProviderActive(providerName: string): boolean {
  const provider = providers.find((item) => item.name === providerName);
  if (!provider || !provider.isAvailable) {
    return false;
  }
  const health = getProviderHealth(provider.name, provider.isAvailable);
  return health.state === 'healthy' && health.isStale !== true;
}

export function getAllActiveCanonicalModelsForApi(): ModelSummary[] {
  return listCanonicalModels()
    .map((model) => {
      const activeProviders = model.providers.filter((provider) => isProviderActive(provider.name));
      return {
        ...model,
        providers: activeProviders,
        capabilities: mergeCapabilities(...activeProviders.map((provider) => provider.capabilities)),
      };
    })
    .filter((model) => model.providers.length > 0)
    .map((model) => ({
      ...model,
      ...classifyCommercialTier(model),
    }));
}

export function getActiveCanonicalModelsForApi(requiredCapability: ModelCapability = 'chat'): ModelSummary[] {
  return getAllActiveCanonicalModelsForApi()
    .filter((model) => (model.capabilities ?? []).includes(requiredCapability));
}

export function buildCatalogSummary(): CatalogSummary {
  const syncMetas = getAllSyncMetas();
  return {
    providers: listProviderSummaries(),
    models: getActiveCanonicalModelsForApi('chat'),
    healthSummary: getHealthSummary(),
    syncMetas: Object.fromEntries(syncMetas),
  };
}
