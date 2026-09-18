import { BaseProvider, type ProviderConfig } from './base.js';

export class RekaProvider extends BaseProvider {
  override buildAuthHeaders(apiKey = this.apiKey): Record<string, string> {
    return apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
          'X-Api-Key': apiKey,
          ...this.customHeaders,
        }
      : {
          ...this.customHeaders,
        };
  }
}
