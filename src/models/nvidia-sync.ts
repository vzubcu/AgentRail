import type { ProviderModel } from '../types.js';
import { keepFetchedAllowlistModels, fetchOpenAIModels } from './sync.js';

export async function fetchNvidiaFreeChatModels(apiKey: string, allowlist: ProviderModel[]): Promise<ProviderModel[]> {
  const rawModels = await fetchOpenAIModels('https://integrate.api.nvidia.com/v1', apiKey);
  return keepFetchedAllowlistModels(rawModels, allowlist);
}
