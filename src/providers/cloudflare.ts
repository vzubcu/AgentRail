import { BaseProvider } from './base.js';
import type { ProviderConfig } from './base.js';
import type { ChatCompletionRequest } from '../types.js';
import { getEffectiveCloudflareCredential, getNextCloudflareCredential } from '../config.js';
import { fetchWithProviderTimeout } from './timeout.js';

export class CloudflareProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  private get credential() {
    return getEffectiveCloudflareCredential();
  }

  private get accountId(): string {
    return this.credential?.accountId ?? '';
  }

  get isAvailable(): boolean {
    return !!this.credential?.apiKey && !!this.accountId;
  }

  override async getRequestHeaders(contentType?: string): Promise<Record<string, string> | undefined> {
    const credential = getNextCloudflareCredential();
    this.rememberRequestKeyContext(credential?.apiKey);
    if (!credential?.apiKey || !credential.accountId) {
      return undefined;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.apiKey}`,
      ...this.customHeaders,
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  override getEndpointUrl(pathname: string): string | null {
    if (!this.accountId) {
      return null;
    }
    return `${this.baseURL}/${this.accountId}/ai${pathname}`;
  }

  async chatCompletion(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<Response> {
    const credential = getNextCloudflareCredential();
    this.rememberRequestKeyContext(credential?.apiKey);
    const id = credential?.accountId ?? '';
    if (!credential?.apiKey || !id) {
      return new Response(JSON.stringify({
        error: { message: 'Cloudflare credentials are incomplete', type: 'config_error' }
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const url = `${this.baseURL}/${id}/ai/v1/chat/completions`;
    const body = this.transformRequest(request);

    return fetchWithProviderTimeout(
      { providerName: this.name, operation: 'chat completion' },
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.apiKey}`,
          ...this.customHeaders,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      },
    );
  }
}
