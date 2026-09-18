import type { ChatCompletionRequest } from '../types.js';
import { BaseProvider } from './base.js';
import { fetchWithProviderTimeout } from './timeout.js';

const NVIDIA_EXTENDED_TIMEOUTS_MS: Record<string, number> = {
  'deepseek-v4-pro': 90_000,
};

export function getNvidiaChatTimeoutMs(modelId: string): number | undefined {
  const bareModelId = modelId.startsWith('nvidia/') ? modelId.slice('nvidia/'.length) : modelId;
  return NVIDIA_EXTENDED_TIMEOUTS_MS[bareModelId];
}

export class NvidiaProvider extends BaseProvider {
  async chatCompletion(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<Response> {
    const url = `${this.baseURL}/chat/completions`;
    const body = this.transformRequest(request);
    const apiKey = this.getRequestApiKey();
    const timeoutMs = getNvidiaChatTimeoutMs(request.model);

    return fetchWithProviderTimeout(
      { providerName: this.name, operation: 'chat completion', timeoutMs },
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...this.customHeaders,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      },
    );
  }
}
