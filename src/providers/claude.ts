import { BaseProvider } from './base.js';
import type { ChatCompletionRequest, ProviderModel } from '../types.js';
import { fetchWithProviderTimeout } from './timeout.js';
import { getValidOAuthToken } from '../oauth-store.js';
import { toAnthropicRequest, parseAnthropicResponseBody, parseAnthropicSSELine, createClaudeToOpenAIStreamTransformer, fromAnthropicResponseToChat } from './claude-format.js';

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'message-batches-2tc%2Ccomputer-use-2025-01-24%2Ctoken-count-2025-01-21';
const CLAUDE_CLI_USER_AGENT = 'claude-cli/2.1.187 (external, cli)';
const CLAUDE_STAINLESS_PACKAGE_VERSION = '0.42.0';
const CLAUDE_STAINLESS_RUNTIME_VERSION = '91';

function mapOs(): string {
  switch (process.platform) {
    case 'darwin': return 'MacOS';
    case 'win32': return 'Windows';
    case 'linux': return 'Linux';
    default: return 'Other';
  }
}

function mapArch(): string {
  switch (process.arch) {
    case 'x64': return 'x64';
    case 'arm64': return 'arm64';
    case 'ia32': return 'x86';
    default: return 'other';
  }
}

export class ClaudeProvider extends BaseProvider {
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

  private async getAuthValue(): Promise<string | undefined> {
    return (await getValidOAuthToken('claude')) || this.apiKey;
  }

  override async getModelSyncAuthHeaders(): Promise<Record<string, string> | undefined> {
    const authValue = await this.getAuthValue();
    return authValue
      ? {
          'x-api-key': authValue,
          'Anthropic-Version': ANTHROPIC_VERSION,
        }
      : undefined;
  }

  override getModelSyncUrl(): string {
    return `${this.baseURL}/v1/models`;
  }

  override async chatCompletion(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<Response> {
    const oauthToken = await getValidOAuthToken('claude');
    const apiKey = this.getRequestApiKey();
    const authValue = oauthToken || apiKey;
    this.rememberRequestKeyContext(authValue, oauthToken ? 'oauth' : 'managed_or_env');

    if (!authValue) {
      return new Response(JSON.stringify({
        error: { message: 'Claude not configured. Add ANTHROPIC_API_KEY or connect via OAuth.', type: 'auth_error' },
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const anthropicReq = toAnthropicRequest({
      ...request,
      model: this.resolveModelId(request.model),
    });

    const headers: Record<string, string> = {
      'x-api-key': authValue,
      'Content-Type': 'application/json',
      'Anthropic-Version': ANTHROPIC_VERSION,
      'Anthropic-Beta': ANTHROPIC_BETA,
      'Anthropic-Dangerous-Direct-Browser-Access': 'true',
      'User-Agent': CLAUDE_CLI_USER_AGENT,
      'X-App': 'cli',
      'X-Stainless-Helper-Method': 'stream',
      'X-Stainless-Retry-Count': '0',
      'X-Stainless-Runtime-Version': CLAUDE_STAINLESS_RUNTIME_VERSION,
      'X-Stainless-Package-Version': CLAUDE_STAINLESS_PACKAGE_VERSION,
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Lang': 'js',
      'X-Stainless-Arch': mapArch(),
      'X-Stainless-Os': mapOs(),
      'X-Stainless-Timeout': '600',
    };

    const url = `${this.baseURL}/messages?beta=true`;

    const response = await fetchWithProviderTimeout(
      { providerName: this.name, operation: 'chat completion' },
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(anthropicReq),
        signal: options?.signal,
      },
    );

    if (!request.stream) {
      const body = await response.text();
      const parsed = parseAnthropicResponseBody(body);
      if (!parsed) {
        return new Response(body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const openAIResp = fromAnthropicResponseToChat(parsed);
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

    const transformer = createClaudeToOpenAIStreamTransformer();
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
              if (line.startsWith('event: ')) continue;
              const chunk = parseAnthropicSSELine(line);
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
