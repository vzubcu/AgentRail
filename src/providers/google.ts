import { fetchGeminiChatModels } from '../models/gemini-sync.js';
import type { OpenAIModelEntry } from '../models/sync.js';
import { BaseProvider } from './base.js';

export class GoogleProvider extends BaseProvider {
  override async getRequestHeaders(contentType?: string): Promise<Record<string, string> | undefined> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      return undefined;
    }
    const headers: Record<string, string> = { 'x-goog-api-key': apiKey };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  override async getModelSyncAuthHeaders(): Promise<Record<string, string> | undefined> {
    const apiKey = this.apiKey;
    return apiKey ? { 'x-goog-api-key': apiKey } : undefined;
  }

  override getModelSyncUrl(): string {
    const url = new URL(this.baseURL);
    url.pathname = url.pathname.replace(/\/openai\/?$/, '/models');
    url.search = '';
    return url.toString();
  }

  protected override async fetchModelSyncEntries(headers: Record<string, string>): Promise<OpenAIModelEntry[]> {
    return fetchGeminiChatModels(this.getModelSyncUrl(), headers);
  }
}
