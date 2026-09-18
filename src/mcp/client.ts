/**
 * HTTP client for the AgentRail MCP bridge.
 *
 * Translates MCP tool calls (snake_case) into AgentRail gateway HTTP
 * requests (camelCase bodies) and returns normalized text results.
 */
import type { McpEnvConfig, ChatCompletionsArgs } from './types.js';

export class AgentRailClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: McpEnvConfig) {
    this.baseUrl = config.agentrailUrl.replace(/\/+$/, '');
    this.apiKey = config.agentrailApiKey;
    this.timeoutMs = config.timeoutMs;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = '';
        try {
          const parsed = (await res.json()) as {
            error?: { message?: string };
          };
          detail = parsed.error?.message ?? '';
        } catch {
          detail = await res.text().catch(() => '');
        }
        throw new Error(
          `AgentRail gateway ${method} ${path} failed (${res.status}): ${detail}`
        );
      }

      if (res.status === 204) {
        return undefined as T;
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `AgentRail gateway request timed out after ${this.timeoutMs}ms`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** GET /health — gateway liveness. */
  async health(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/health');
  }

  /** GET /v1/models — list active models exposed by the gateway. */
  async listModels(): Promise<{ data: { id: string }[] }> {
    return this.request<{ data: { id: string }[] }>('GET', '/v1/models');
  }

  /**
   * POST /v1/chat/completions — route a chat request through AgentRail.
   * snake_case args are mapped to camelCase gateway fields.
   */
  async chatCompletions(args: ChatCompletionsArgs): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      model: args.model,
      messages: args.messages,
      stream: args.stream ?? false,
    };
    if (args.temperature !== undefined) body.temperature = args.temperature;
    if (args.max_tokens !== undefined) body.max_tokens = args.max_tokens;
    if (args.top_p !== undefined) body.top_p = args.top_p;
    if (args.provider !== undefined) body.provider = args.provider;

    return this.request<Record<string, unknown>>(
      'POST',
      '/v1/chat/completions',
      body
    );
  }

  /** POST /api/health/check/:provider — trigger a health check for one provider. */
  async checkProvider(provider: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'POST',
      `/api/health/check/${encodeURIComponent(provider)}`
    );
  }
}