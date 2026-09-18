import { BaseProvider } from './base.js';
import type { ChatCompletionRequest } from '../types.js';
import { fetchWithProviderTimeout } from './timeout.js';
import { getValidOAuthToken } from '../oauth-store.js';
import { toGeminiRequest, parseGeminiResponseBody, parseGeminiSSELine, createGeminiToOpenAIStreamTransformer, fromGeminiResponse } from './gemini-format.js';
import type { OpenAIModelEntry } from '../models/sync.js';
import { fetchGeminiChatModels } from '../models/gemini-sync.js';

export class GeminiProvider extends BaseProvider {
  override get isAvailable(): boolean {
    return true;
  }

  private async buildGeminiAuthHeaders(includeContentType = false): Promise<Record<string, string> | undefined> {
    const oauthToken = await getValidOAuthToken('gemini');
    const apiKey = includeContentType ? this.getRequestApiKey() : this.apiKey;

    if (!oauthToken && !apiKey) {
      return undefined;
    }

    const headers: Record<string, string> = includeContentType ? { 'Content-Type': 'application/json' } : {};
    if (oauthToken) {
      headers.Authorization = `Bearer ${oauthToken}`;
    } else if (apiKey) {
      headers['x-goog-api-key'] = apiKey;
    }

    return headers;
  }

  override async getRequestHeaders(contentType?: string): Promise<Record<string, string> | undefined> {
    return this.buildGeminiAuthHeaders(Boolean(contentType));
  }

  override async getModelSyncAuthHeaders(): Promise<Record<string, string> | undefined> {
    return this.buildGeminiAuthHeaders(false);
  }

  override getModelSyncUrl(): string {
    return this.baseURL;
  }

  protected override async fetchModelSyncEntries(headers: Record<string, string>): Promise<OpenAIModelEntry[]> {
    return fetchGeminiChatModels(this.getModelSyncUrl(), headers);
  }

  override async chatCompletion(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<Response> {
    const modelId = this.resolveModelId(request.model);
    const headers = await this.buildGeminiAuthHeaders(true);

    if (!headers) {
      return new Response(JSON.stringify({
        error: { message: 'Gemini not configured. Add GEMINI_API_KEY or connect via OAuth.', type: 'auth_error' },
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const geminiReq = toGeminiRequest(request);

    if (!request.stream) {
      const url = `${this.baseURL}/${modelId}:generateContent`;
      const response = await fetchWithProviderTimeout(
        { providerName: this.name, operation: 'chat completion' },
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(geminiReq),
          signal: options?.signal,
        },
      );

      const body = await response.text();
      const parsed = parseGeminiResponseBody(body);
      if (!parsed) {
        return new Response(body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const openAIResp = fromGeminiResponse(parsed, modelId);
      return new Response(JSON.stringify(openAIResp), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = `${this.baseURL}/${modelId}:streamGenerateContent?alt=sse`;
    const response = await fetchWithProviderTimeout(
      { providerName: this.name, operation: 'chat completion' },
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(geminiReq),
        signal: options?.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return new Response(JSON.stringify({
        error: { message: 'Stream not available', type: 'stream_error' },
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const transformer = createGeminiToOpenAIStreamTransformer();
    const decoder = new TextDecoder();
    let buffer = '';

    const readableStream = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              const endData = transformer.end();
              if (endData) controller.enqueue(new TextEncoder().encode(endData));
              controller.close();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const chunk = parseGeminiSSELine(line);
              if (chunk) {
                const openAIChunk = transformer.transform(chunk);
                if (openAIChunk) {
                  controller.enqueue(new TextEncoder().encode(openAIChunk));
                }
              }
            }
          }
        } catch (err) {
          const endData = transformer.end();
          if (endData) controller.enqueue(new TextEncoder().encode(endData));
          controller.error(err);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(readableStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }
}
