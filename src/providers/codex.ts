import { BaseProvider } from './base.js';
import type { ChatCompletionRequest, ProviderModel } from '../types.js';
import { fetchWithProviderTimeout } from './timeout.js';
import { getValidOAuthToken } from '../oauth-store.js';
import { toCodexRequest, parseCodexResponseBody, parseCodexSSEBuffer, createCodexToOpenAIStreamTransformer, fromCodexResponse } from './codex-format.js';

const CODEX_USER_AGENT = 'codex-cli/0.142.0 (Windows 10.0.26200; x64)';
const CODEX_CLIENT_VERSION = '0.142.0';

export class CodexProvider extends BaseProvider {
  constructor(config: {
    name: string;
    baseURL: string;
    apiKeyEnvVar: string;
    models: ProviderModel[];
    website?: string;
    envVars?: string[];
    apiKeyInstructions?: string[];
  }) {
    super(config);
  }

  override get isAvailable(): boolean {
    return true;
  }

  override get canRecoverEmptyCatalogFromOriginalModels(): boolean {
    return false;
  }

  override get usesVerifiedModelCatalog(): boolean {
    return true;
  }

  private async getAuthValue(): Promise<string | undefined> {
    return (await getValidOAuthToken('codex')) || this.apiKey;
  }

  override async getModelSyncAuthHeaders(): Promise<Record<string, string> | undefined> {
    const authValue = await this.getAuthValue();
    return authValue ? { Authorization: `Bearer ${authValue}` } : undefined;
  }

  override async chatCompletion(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<Response> {
    const oauthToken = await getValidOAuthToken('codex');
    const apiKey = this.getRequestApiKey();
    const authValue = oauthToken || apiKey;
    const signal = options?.signal ?? (request.signal instanceof AbortSignal ? request.signal : undefined);

    if (!authValue) {
      return new Response(JSON.stringify({
        error: { message: 'Codex not configured. Add CODEX_API_KEY or connect via OAuth.', type: 'auth_error' },
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const codexReq = toCodexRequest({
      ...request,
      model: this.resolveModelId(request.model),
    });

    const url = `${this.baseURL}/responses`;

    const response = await fetchWithProviderTimeout(
      { providerName: this.name, operation: 'chat completion' },
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authValue}`,
          'Content-Type': 'application/json',
          'User-Agent': CODEX_USER_AGENT,
          'codex-client-version': CODEX_CLIENT_VERSION,
        },
        signal,
        body: JSON.stringify(codexReq),
      },
    );

    if (!request.stream) {
      const body = await response.text();
      const parsed = parseCodexResponseBody(body);
      if (!parsed) {
        return new Response(body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const openAIResp = fromCodexResponse(parsed);
      return new Response(JSON.stringify(openAIResp), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const transformer = createCodexToOpenAIStreamTransformer();
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
            const events = parseCodexSSEBuffer(buffer);
            buffer = '';

            for (const event of events) {
              if (event.type === 'response.created') {
                const resp = event.response as Record<string, unknown> | undefined;
                if (resp?.id) transformer.setId(String(resp.id));
                if (resp?.model) transformer.setModel(String(resp.model));
              }

              const openAIChunk = transformer.transform(event);
              if (openAIChunk) {
                controller.enqueue(new TextEncoder().encode(openAIChunk));
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

