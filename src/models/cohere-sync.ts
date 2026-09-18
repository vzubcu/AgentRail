import type { ProviderModel } from '../types.js';

interface CohereModel {
  name: string;
  endpoints: string[];
  default_endpoints: string[];
  context_length: number;
  features: string[] | null;
}

interface CohereModelsResponse {
  models: CohereModel[];
}

export async function fetchCohereModels(apiKey: string): Promise<ProviderModel[]> {
  const response = await fetch('https://api.cohere.com/v2/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Cohere models fetch failed: ${response.status}`);
  }

  const payload = (await response.json()) as CohereModelsResponse;

  const chatModels = payload.models.filter((m) => {
    const eps = [...(m.endpoints ?? []), ...(m.default_endpoints ?? [])];
    return eps.includes('chat');
  });

  return chatModels.map((m) => ({
    id: normalizeCohereId(m.name),
    providerModelId: m.name,
    context: m.context_length || undefined,
    modality: m.features?.includes('vision') ? 'Text + Vision' : 'Text',
  }));
}

function normalizeCohereId(raw: string): string {
  return raw.replace(/-\d{2}-\d{4}$/, '');
}

export function mergeCohereWithAllowlist(
  fetched: ProviderModel[],
  allowlist: ProviderModel[]
): ProviderModel[] {
  const result: ProviderModel[] = [];

  for (const allowed of allowlist) {
    // Try exact match first, then prefix match
    const found =
      fetched.find((m) => m.providerModelId === allowed.providerModelId) ??
      fetched.find((m) => m.providerModelId.startsWith(allowed.providerModelId + '-'));

    if (found) {
      result.push({
        ...allowed,
        providerModelId: found.providerModelId,
        context: found.context ?? allowed.context,
        modality: found.modality ?? allowed.modality,
      });
    }
  }

  return result;
}
