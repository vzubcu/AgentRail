import {
  anthropicStreamStart,
  createAnthropicStreamTransformer,
  fromAnthropicRequest,
  toAnthropicResponse,
  type AnthropicRequest,
} from '../../anthropic-bridge.js';
import { routeChatCompletion as defaultRouteChatCompletion } from '../../router.js';
import { estimateAnthropicCountTokens, estimateUsage } from '../../usage.js';
import { usageTracker } from '../../usage-tracker.js';
import { recordUsage as recordSaasUsage } from '../../saas/db.js';
import { hasTextualToolCallSignals } from '../../anthropic-bridge.js';
import type { RequestContext } from '../types.js';
import { readBody, parseJsonBody } from '../request-context.js';
import { sendJSON, sendNoContent } from '../responses.js';
import { checkGatewayAuth } from '../access.js';

const TOOL_CALL_PATTERN = /```tool_call\s*\{[\s\S]*?\}\s*```/g;
const TOOL_CALLS_PATTERN = /```tool_calls\s*\[[\s\S]*?\]\s*```/g;

function stripTextualToolCalls(text: string): string {
  if (!text) return text;
  return text
    .replace(TOOL_CALL_PATTERN, '')
    .replace(TOOL_CALLS_PATTERN, '')
    .trim();
}

function shouldRejectTextualToolCallText(text: string, hasTools: boolean, hasStructuredToolUse: boolean): boolean {
  return hasTools && !hasStructuredToolUse && hasTextualToolCallSignals(text);
}

function getSaasUser(ctx: RequestContext): { id: string } | undefined {
  return (ctx.req as unknown as Record<string, unknown>).saasUser as { id: string } | undefined;
}

export async function handleAnthropicRoute(ctx: RequestContext): Promise<boolean> {
  const routeChatCompletion = ctx.options.routeChatCompletion ?? defaultRouteChatCompletion;

  if (ctx.pathname === '/v1/messages' && (ctx.req.method === 'HEAD' || ctx.req.method === 'OPTIONS')) {
    if (!(await checkGatewayAuth(ctx))) return true;
    sendNoContent(ctx.res, 'POST, HEAD, OPTIONS');
    return true;
  }

  if (ctx.pathname === '/v1/messages/count_tokens' && (ctx.req.method === 'HEAD' || ctx.req.method === 'OPTIONS')) {
    if (!(await checkGatewayAuth(ctx))) return true;
    sendNoContent(ctx.res, 'POST, HEAD, OPTIONS');
    return true;
  }

  if (ctx.pathname === '/v1/messages/count_tokens' && ctx.req.method === 'POST') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<Record<string, unknown>>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    const payload = parsedBody.value;
    const result = estimateAnthropicCountTokens({
      messages: payload.messages,
      system: payload.system,
      tools: payload.tools,
    });
    sendJSON(ctx.res, 200, result);
    return true;
  }

  if (ctx.pathname === '/v1/messages' && ctx.req.method === 'POST') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<AnthropicRequest>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    const anthropicReq = parsedBody.value;

    ctx.trace('anthropic.request', {
      requestId: ctx.requestId,
      model: anthropicReq.model ?? null,
      stream: !!anthropicReq.stream,
      hasTools: Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0,
    });

    if (!anthropicReq.model) {
      sendJSON(ctx.res, 400, { error: { message: 'Missing "model" field', type: 'invalid_request_error' } });
      return true;
    }

    const openAIReq = fromAnthropicRequest(anthropicReq);
    ctx.trace('anthropic.bridge', {
      requestId: ctx.requestId,
      inputModel: anthropicReq.model,
      bridgedModel: openAIReq.model,
    });

    try {
      const { response, provider, routeModel, virtualModelId, virtualModelTraceId } = await routeChatCompletion(openAIReq);
      ctx.trace('anthropic.route', {
        requestId: ctx.requestId,
        model: openAIReq.model,
        provider: provider.name,
        status: response.status,
      });

      if (anthropicReq.stream) {
        ctx.res.setHeader('Content-Type', 'text/event-stream');
        ctx.res.setHeader('Cache-Control', 'no-cache');
        ctx.res.setHeader('Connection', 'keep-alive');
        ctx.res.setHeader('X-AgentRail-Provider', provider.name);
        if (routeModel) {
          ctx.res.setHeader('X-AgentRail-Route-Model', routeModel);
        }
        if (virtualModelId) {
          ctx.res.setHeader('X-AgentRail-Virtual-Model', virtualModelId);
        }
        if (virtualModelTraceId) {
          ctx.res.setHeader('X-AgentRail-Virtual-Model-Trace-Id', virtualModelTraceId);
        }
        ctx.res.writeHead(200);

        ctx.res.write(anthropicStreamStart(anthropicReq.model));
        const streamTransformer = createAnthropicStreamTransformer();
        let completionBuffer = '';

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const segments = buffer.split('\n\n');
              buffer = segments.pop() ?? '';

              for (const segment of segments) {
                const line = segment
                  .split('\n')
                  .map((l) => l.trim())
                  .find((l) => l.startsWith('data: '));
                if (!line) continue;

                const json = line.slice(6);
                if (json === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(json) as Record<string, unknown>;
                  const delta = ((parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta as Record<string, unknown> | undefined)?.content;
                  if (typeof delta === 'string') completionBuffer += stripTextualToolCalls(delta);
                  const transformed = streamTransformer.transform(parsed);
                  if (transformed) ctx.res.write(transformed);
                } catch {
                  // skip malformed
                }
              }
            }

            if (buffer.trim().startsWith('data: ')) {
              const json = buffer.trim().slice(6);
              if (json && json !== '[DONE]') {
                try {
                  const parsed = JSON.parse(json) as Record<string, unknown>;
                  const delta = ((parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta as Record<string, unknown> | undefined)?.content;
                  if (typeof delta === 'string') completionBuffer += stripTextualToolCalls(delta);
                  const transformed = streamTransformer.transform(parsed);
                  if (transformed) ctx.res.write(transformed);
                } catch {
                  // skip malformed
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        }

        if (shouldRejectTextualToolCallText(completionBuffer, Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0, false)) {
          throw new Error('Provider returned textual tool-call content without structured tool_use blocks');
        }
        ctx.res.write(streamTransformer.end());
        if (completionBuffer) {
          const promptText = JSON.stringify(openAIReq.messages ?? []);
          const est = estimateUsage({ promptText, completionText: completionBuffer });
          usageTracker.record(openAIReq.model, provider.name, est.prompt_tokens, est.completion_tokens);
          const saasUser = getSaasUser(ctx);
          if (saasUser) {
            recordSaasUsage(saasUser.id, est.prompt_tokens, est.completion_tokens).catch(() => {});
          }
        }
        ctx.res.end();
      } else {
        const openAIBody = (await response.json()) as Record<string, unknown>;
        const anthropicRes = toAnthropicResponse(openAIBody, anthropicReq.model);
        const hasStructuredToolUse = anthropicRes.content.some((block) => block.type === 'tool_use');
        const textContent = anthropicRes.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map((block) => block.text)
          .join('');
        if (shouldRejectTextualToolCallText(textContent, Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0, hasStructuredToolUse)) {
          throw new Error('Provider returned textual tool-call content without structured tool_use blocks');
        }
        const u = (anthropicRes.usage as Record<string, number> | undefined);
        if (u) {
          usageTracker.record(openAIReq.model, provider.name, u.input_tokens ?? 0, u.output_tokens ?? 0);
          const saasUser = getSaasUser(ctx);
          if (saasUser) {
            recordSaasUsage(saasUser.id, u.input_tokens ?? 0, u.output_tokens ?? 0).catch(() => {});
          }
        }
        const body = JSON.stringify(anthropicRes);
        ctx.res.setHeader('Content-Type', 'application/json');
        ctx.res.setHeader('X-AgentRail-Provider', provider.name);
        if (routeModel) {
          ctx.res.setHeader('X-AgentRail-Route-Model', routeModel);
        }
        if (virtualModelId) {
          ctx.res.setHeader('X-AgentRail-Virtual-Model', virtualModelId);
        }
        if (virtualModelTraceId) {
          ctx.res.setHeader('X-AgentRail-Virtual-Model-Trace-Id', virtualModelTraceId);
        }
        ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
        ctx.res.writeHead(response.status);
        ctx.res.end(body);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      ctx.trace('anthropic.error', {
        requestId: ctx.requestId,
        model: anthropicReq.model ?? null,
        bridgedModel: openAIReq.model,
        durationMs: Date.now() - ctx.startedAt,
        errorName: err instanceof Error ? err.name : typeof err,
        message,
      });
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
    return true;
  }

  return false;
}
