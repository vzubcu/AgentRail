import { providers, refreshProviderModels } from '../providers/index.js';

export async function refreshProvidersForEnvVars(envVars: string[]): Promise<{ refreshed: string[]; failed: string[]; skipped: string[] }> {
  const providerNames = [...new Set(
    envVars.flatMap((envVar) => providers
      .filter((provider) => provider.envVars.includes(envVar))
      .map((provider) => provider.name)),
  )];

  const refreshed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const providerName of providerNames) {
    try {
      const status = await refreshProviderModels(providerName);
      if (status === 'skipped') {
        skipped.push(providerName);
      } else {
        refreshed.push(providerName);
      }
    } catch {
      failed.push(providerName);
    }
  }

  return { refreshed, failed, skipped };
}
