import type { ChatCompletionRequest } from '../../types.js';
import { AUTO_MODEL_ID, routeChatCompletion as defaultRouteChatCompletion } from '../../router.js';
import { CompletionsCompatibilityError, fromCompletionsRequest, toCompletionsResponse, type CompletionsRequest } from '../../completions-bridge.js';
import {
  createResponsesStreamTransformer,
  fromResponsesRequest,
  ResponsesCompatibilityError,
  toResponsesResponse,
  type ResponsesRequest,
} from '../../responses-bridge.js';
import {
  assertRequestModelCapabilities,
  AttachmentProcessingError,
  formatAttachmentSummaryHeader,
  normalizeChatRequestAttachments,
} from '../../attachments.js';
import { estimateUsage, normalizeOpenAIResponseUsage } from '../../usage.js';
import { usageTracker } from '../../usage-tracker.js';
import { createStoredFile, deleteStoredFile, formatStoredFile, getStoredFile, getStoredFileContent, listStoredFiles } from '../../files-store.js';
import { recordUsage as recordSaasUsage } from '../../saas/db.js';
import type { RequestContext } from '../types.js';
import { readBody, readBodyBuffer, parseJsonBody } from '../request-context.js';
import { sendJSON, sendNoContent, sendStream } from '../responses.js';
import { checkGatewayAuth } from '../access.js';
import { getAllActiveCanonicalModelsForApi } from '../../catalog.js';
import { providers } from '../../providers/index.js';
import { fetchWithProviderTimeout } from '../../providers/timeout.js';
import { hasTextualToolCallSignals } from '../../anthropic-bridge.js';
import { getSettingsConfigSync } from '../../settings/config.js';

const DEBUG_TOOL_CALLS = process.env.AGENTRAIL_DEBUG_TOOL_CALLS === '1';

class ToolCallContractError extends Error {
  readonly status = 502;
  readonly type = 'bad_gateway';

  constructor(message: string) {
    super(message);
    this.name = 'ToolCallContractError';
  }
}

const TEXTUAL_TOOL_CALL_PATTERNS = [
  '<tool_call>',
  '</tool_call>',
  '<function=',
  '<parameter=',
  '<｜｜DSML｜｜tool_calls>',
  '<｜｜DSML｜｜invoke',
  '<｜｜DSML｜｜parameter',
];

const TEXTUAL_TOOL_CALL_SIGNAL_REGEX = /<tool_call>|<function=|<parameter=|<\/tool_call>|<｜｜DSML｜｜tool_calls>|<｜｜DSML｜｜invoke|<｜｜DSML｜｜parameter/;

function summarizeToolCallsForTrace(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const firstChoice = Array.isArray(parsed.choices)
    ? parsed.choices[0] as Record<string, unknown> | undefined
    : undefined;
  if (!firstChoice || typeof firstChoice !== 'object') {
    return null;
  }

  const delta = firstChoice.delta as Record<string, unknown> | undefined;
  const toolCalls = Array.isArray(delta?.tool_calls)
    ? delta.tool_calls as Array<Record<string, unknown>>
    : [];
  const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null;

  if (toolCalls.length === 0 && finishReason !== 'tool_calls') {
    return null;
  }

  return {
    finishReason,
    toolCalls: toolCalls.map((toolCall) => {
      const fn = toolCall.function as Record<string, unknown> | undefined;
      const rawArguments = typeof fn?.arguments === 'string' ? fn.arguments : '';
      return {
        index: typeof toolCall.index === 'number' ? toolCall.index : null,
        id: typeof toolCall.id === 'string' ? toolCall.id : null,
        type: typeof toolCall.type === 'string' ? toolCall.type : null,
        functionName: typeof fn?.name === 'string' ? fn.name : null,
        argumentsLength: rawArguments.length,
        argumentsPreview: rawArguments.slice(0, 160),
      };
    }),
  };
}

function summarizeTextualToolCallSignals(text: string): Record<string, unknown> | null {
  const matchedPatterns = TEXTUAL_TOOL_CALL_PATTERNS.filter((pattern) => text.includes(pattern));
  if (matchedPatterns.length === 0) {
    return null;
  }

  return {
    matchedPatterns,
    preview: text.slice(Math.max(0, text.search(TEXTUAL_TOOL_CALL_SIGNAL_REGEX)), Math.max(0, text.search(TEXTUAL_TOOL_CALL_SIGNAL_REGEX)) + 220),
  };
}

function shouldRejectTextualToolCallText(text: string, hasTools: boolean, hasStructuredToolCalls: boolean): boolean {
  return hasTools && !hasStructuredToolCalls && hasTextualToolCallSignals(text);
}

function getStreamDeltaContent(parsed: Record<string, unknown>): string | null {
  const delta = ((parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta as Record<string, unknown> | undefined)?.content;
  return typeof delta === 'string' ? delta : null;
}

function getStreamUsage(parsed: Record<string, unknown>): Record<string, number> | null {
  const usage = parsed.usage as Record<string, number> | undefined;
  return usage ?? null;
}

async function collectValidatedStreamWithoutTools(
  body: ReadableStream<Uint8Array> | null,
  trace: RequestContext['trace'],
  requestId: string,
  providerName: string,
  routeModel: string | undefined,
): Promise<{ chunks: Buffer[]; completionBuffer: string; streamUsage: Record<string, number> | null; malformedStreamChunks: number }> {
  if (!body) {
    return { chunks: [], completionBuffer: '', streamUsage: null, malformedStreamChunks: 0 };
  }

  const chunks: Buffer[] = [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let completionBuffer = '';
  let rawCompletionBuffer = '';
  let streamUsage: Record<string, number> | null = null;
  let malformedStreamChunks = 0;
  let loggedTextualToolSignal = false;

  const inspectJson = (json: string, trailingBuffer = false) => {
    if (!json || json === '[DONE]') return;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const delta = getStreamDeltaContent(parsed);
      if (delta !== null) {
        rawCompletionBuffer += delta;
        completionBuffer += stripTextualToolCalls(delta);
        const textualSignal = summarizeTextualToolCallSignals(rawCompletionBuffer);
        if (textualSignal && !loggedTextualToolSignal) {
          loggedTextualToolSignal = true;
          trace('openai.stream_textual_tool_contract_violation', {
            requestId,
            provider: providerName,
            routeModel: routeModel ?? null,
            trailingBuffer,
            ...textualSignal,
          });
        }
      }
      const usage = getStreamUsage(parsed);
      if (usage) streamUsage = usage;
    } catch {
      malformedStreamChunks += 1;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          inspectJson(line.slice(6));
        }
      }
    }

    if (sseBuffer.trim().startsWith('data: ')) {
      inspectJson(sseBuffer.trim().slice(6), true);
    }
  } finally {
    reader.releaseLock();
  }

  if (hasTextualToolCallSignals(rawCompletionBuffer)) {
    throw new ToolCallContractError('Provider returned textual tool-call content without structured tool_calls. The incoming request did not include OpenAI tools, so AgentRail blocked the raw pseudo-tool markup instead of streaming it to the client.');
  }

  return { chunks, completionBuffer, streamUsage, malformedStreamChunks };
}

interface PassthroughSink {
  write(chunk: Buffer | Uint8Array | string): boolean;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
}

interface PassthroughMetadata {
  completionBuffer: string;
  rawCompletionBuffer: string;
  streamUsage: Record<string, number> | null;
  malformedStreamChunks: number;
  sawTextualToolSignal: boolean;
}

/**
 * Passthrough streaming for requests without tools. Delivers each upstream
 * chunk to the client immediately (low TTFB) while still capturing usage /
 * completion metadata for accounting. Unlike collectValidatedStreamWithoutTools,
 * this does NOT buffer the full response before sending.
 */
async function streamPassthroughWithoutTools(
  body: ReadableStream<Uint8Array> | null,
  sink: PassthroughSink,
  trace: RequestContext['trace'],
  requestId: string,
  providerName: string,
  routeModel: string | undefined,
): Promise<PassthroughMetadata> {
  if (!body) {
    return { completionBuffer: '', rawCompletionBuffer: '', streamUsage: null, malformedStreamChunks: 0, sawTextualToolSignal: false };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let completionBuffer = '';
  let rawCompletionBuffer = '';
  let streamUsage: Record<string, number> | null = null;
  let malformedStreamChunks = 0;
  let sawTextualToolSignal = false;

  const inspectJson = (json: string, trailingBuffer = false) => {
    if (!json || json === '[DONE]') return;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const delta = getStreamDeltaContent(parsed);
      if (delta !== null) {
        rawCompletionBuffer += delta;
        completionBuffer += stripTextualToolCalls(delta);
        const textualSignal = summarizeTextualToolCallSignals(rawCompletionBuffer);
        if (textualSignal && !sawTextualToolSignal) {
          sawTextualToolSignal = true;
          trace('openai.stream_textual_tool_contract_violation', {
            requestId,
            provider: providerName,
            routeModel: routeModel ?? null,
            trailingBuffer,
            ...textualSignal,
          });
        }
      }
      const usage = getStreamUsage(parsed);
      if (usage) streamUsage = usage;
    } catch {
      malformedStreamChunks += 1;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (!sink.write(chunk)) {
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            sink.off('drain', onDrain);
            sink.off('close', onClose);
          };
          const onDrain = () => { cleanup(); resolve(); };
          const onClose = () => { cleanup(); resolve(); };
          sink.once('drain', onDrain);
          sink.once('close', onClose);
        });
      }
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          inspectJson(line.slice(6));
        }
      }
    }

    if (sseBuffer.trim().startsWith('data: ')) {
      inspectJson(sseBuffer.trim().slice(6), true);
    }
  } finally {
    reader.releaseLock();
  }

  return { completionBuffer, rawCompletionBuffer, streamUsage, malformedStreamChunks, sawTextualToolSignal };
}

const TOOL_CALL_PATTERN = /```tool_call\s*\{[\s\S]*?\}\s*```/g;
const TOOL_CALLS_PATTERN = /```tool_calls\s*\[[\s\S]*?\]\s*```/g;

interface ParsedPseudoToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ParsedPseudoToolPayload {
  content: string | null;
  tool_calls: ParsedPseudoToolCall[];
}

function escapeJsonString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function parsePseudoToolCallArguments(raw: string): string {
  const args = raw.trim();
  if (!args) return '{}';

  if (args.startsWith('{') || args.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(args));
    } catch {
      // fall through to XML-like parsing
    }
  }

  const paramMatches = Array.from(args.matchAll(/<(?:｜｜DSML｜｜parameter\s+name="([^"]+)"[^>]*|parameter=([^>]+))>([\s\S]*?)<\/(?:｜｜DSML｜｜parameter|[^>]+)>/g));
  if (paramMatches.length === 0) {
    return '{}';
  }

  const entries = paramMatches.map((match) => {
    const key = (match[1] ?? match[2] ?? '').trim();
    const value = (match[3] ?? '').trim();
    return `"${escapeJsonString(key)}":"${escapeJsonString(value)}"`;
  }).filter(Boolean);

  return `{${entries.join(',')}}`;
}

function stripPseudoToolCallMarkup(text: string): string {
  return text
    .replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, ' ')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, ' ')
    .replace(TOOL_CALL_PATTERN, ' ')
    .replace(TOOL_CALLS_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePseudoToolCalls(text: string): ParsedPseudoToolCall[] {
  const calls: ParsedPseudoToolCall[] = [];
  const seen = new Set<string>();

  const dsmlInvokes = Array.from(text.matchAll(/<｜｜DSML｜｜invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g));
  for (const [index, match] of dsmlInvokes.entries()) {
    const name = (match[1] ?? '').trim();
    if (!name) continue;
    const args = parsePseudoToolCallArguments(match[2] ?? '');
    const signature = `${name}\u0000${args}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    calls.push({
      id: `call_${index}`,
      type: 'function',
      function: { name, arguments: args },
    });
  }

  const xmlCalls = Array.from(text.matchAll(/<tool_call>[\s\S]*?<function=([^>\s]+)>([\s\S]*?)<\/function>[\s\S]*?<\/tool_call>/g));
  for (const match of xmlCalls) {
    const name = (match[1] ?? '').trim();
    if (!name) continue;
    const args = parsePseudoToolCallArguments(match[2] ?? '');
    const signature = `${name}\u0000${args}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    calls.push({
      id: `call_${calls.length}`,
      type: 'function',
      function: { name, arguments: args },
    });
  }

  return calls;
}

function normalizePseudoToolCallsFromContent(content: string): ParsedPseudoToolPayload | null {
  if (!hasTextualToolCallSignals(content)) {
    return null;
  }

  const toolCalls = parsePseudoToolCalls(content);
  if (toolCalls.length === 0) {
    return null;
  }

  const stripped = stripPseudoToolCallMarkup(content);
  return {
    content: stripped || null,
    tool_calls: toolCalls,
  };
}

function normalizePseudoToolCallsInChatResponse(payload: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const choices = Array.isArray(cloned.choices) ? cloned.choices as Array<Record<string, unknown>> : [];

  for (const choice of choices) {
    const message = choice.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== 'object') continue;
    const content = typeof message.content === 'string' ? message.content : '';
    const hasStructuredToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (hasStructuredToolCalls || !content) continue;

    const normalized = normalizePseudoToolCallsFromContent(content);
    if (!normalized) continue;

    message.content = normalized.content;
    message.tool_calls = normalized.tool_calls;
    if (choice.finish_reason == null || choice.finish_reason === 'stop') {
      choice.finish_reason = 'tool_calls';
    }
  }

  return cloned;
}

function buildSyntheticToolCallStream(toolCalls: ParsedPseudoToolCall[], usage: Record<string, number> | null, model: string, requestId: string): string {
  const created = Math.floor(Date.now() / 1000);
  const chunks: string[] = [];

  for (const [index, toolCall] of toolCalls.entries()) {
    chunks.push(`data: ${JSON.stringify({
      id: requestId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          }],
        },
        finish_reason: null,
      }],
    })}\n\n`);
  }

  chunks.push(`data: ${JSON.stringify({
    id: requestId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    ...(usage ? { usage } : {}),
  })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return chunks.join('');
}

function stripTextualToolCalls(text: string): string {
  if (!text) return text;
  return text
    .replace(TOOL_CALL_PATTERN, '')
    .replace(TOOL_CALLS_PATTERN, '')
    .replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

function summarizeMessageContentShapes(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.slice(0, 8).map((message, index) => {
    const record = message && typeof message === 'object' ? message as Record<string, unknown> : null;
    const content = record?.content;
    const role = typeof record?.role === 'string' ? record.role : null;
    const summary: Record<string, unknown> = {
      index,
      role,
      contentType: Array.isArray(content) ? 'array' : typeof content,
    };

    if (Array.isArray(content)) {
      summary.partCount = content.length;
      summary.partTypes = content.slice(0, 6).map((part) => (
        part && typeof part === 'object' && typeof (part as Record<string, unknown>).type === 'string'
          ? (part as Record<string, unknown>).type
          : typeof part
      ));
    } else if (typeof content === 'string') {
      summary.contentLength = content.length;
    } else if (content && typeof content === 'object') {
      summary.contentKeys = Object.keys(content as Record<string, unknown>).slice(0, 8);
    }

    return summary;
  });
}

function summarizeToolDefinitions(tools: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.slice(0, 12).map((tool, index) => {
    const record = tool && typeof tool === 'object' ? tool as Record<string, unknown> : null;
    const fn = record?.function && typeof record.function === 'object'
      ? record.function as Record<string, unknown>
      : null;
    const parameters = fn?.parameters && typeof fn.parameters === 'object'
      ? fn.parameters as Record<string, unknown>
      : null;
    const required = Array.isArray(parameters?.required)
      ? parameters.required.filter((value): value is string => typeof value === 'string').slice(0, 20)
      : [];

    return {
      index,
      type: typeof record?.type === 'string' ? record.type : null,
      name: typeof fn?.name === 'string' ? fn.name : null,
      required,
      propertyKeys: parameters?.properties && typeof parameters.properties === 'object'
        ? Object.keys(parameters.properties as Record<string, unknown>).slice(0, 20)
        : [],
    };
  });
}

function extractInvalidMessageIndex(message: string): number | null {
  const match = message.match(/messages\[(\d+)\]\.content/);
  if (!match) {
    return null;
  }
  const index = Number.parseInt(match[1] ?? '', 10);
  return Number.isInteger(index) ? index : null;
}

function summarizeSingleMessageContent(message: unknown, index: number): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') {
    return { index, messageType: typeof message };
  }

  const record = message as Record<string, unknown>;
  const content = record.content;
  const summary: Record<string, unknown> = {
    index,
    role: typeof record.role === 'string' ? record.role : null,
    contentType: Array.isArray(content) ? 'array' : typeof content,
  };

  if (Array.isArray(content)) {
    summary.partCount = content.length;
    summary.partTypes = content.slice(0, 10).map((part) => (
      part && typeof part === 'object' && typeof (part as Record<string, unknown>).type === 'string'
        ? (part as Record<string, unknown>).type
        : typeof part
    ));
    return summary;
  }

  if (typeof content === 'string') {
    summary.contentLength = content.length;
    return summary;
  }

  if (content && typeof content === 'object') {
    const contentRecord = content as Record<string, unknown>;
    summary.contentKeys = Object.keys(contentRecord).slice(0, 12);
    if (typeof contentRecord.type === 'string') {
      summary.contentDeclaredType = contentRecord.type;
    }
    if (typeof contentRecord.text === 'string') {
      summary.textLength = contentRecord.text.length;
    }
    for (const nestedKey of ['content', 'parts', 'blocks']) {
      const nested = contentRecord[nestedKey];
      if (nested !== undefined) {
        summary[`${nestedKey}Type`] = Array.isArray(nested) ? 'array' : typeof nested;
        if (Array.isArray(nested)) {
          summary[`${nestedKey}Length`] = nested.length;
          summary[`${nestedKey}PartTypes`] = nested.slice(0, 8).map((part) => (
            part && typeof part === 'object' && typeof (part as Record<string, unknown>).type === 'string'
              ? (part as Record<string, unknown>).type
              : typeof part
          ));
        }
      }
    }
    return summary;
  }

  return summary;
}

interface UpstreamErrorInfo {
  message: string;
  type?: string;
  code?: string;
}

function tryParseUpstreamError(rawBody: string): UpstreamErrorInfo | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    // OpenAI Chat Completions error format: { error: { message, type, code } }
    const errObj = parsed.error as Record<string, unknown> | undefined;
    if (errObj && typeof errObj.message === 'string') {
      return {
        message: errObj.message,
        type: typeof errObj.type === 'string' ? errObj.type : undefined,
        code: typeof errObj.code === 'string' ? errObj.code : undefined,
      };
    }
    // Fallback: use top-level message
    if (typeof parsed.message === 'string') {
      return { message: parsed.message };
    }
    return null;
  } catch {
    return null;
  }
}

function getSaasUser(ctx: RequestContext): { id: string } | undefined {
  return (ctx.req as unknown as Record<string, unknown>).saasUser as { id: string } | undefined;
}

function getVirtualModelStickyKey(ctx: RequestContext): string | undefined {
  const bearer = (ctx.req.headers.authorization ?? '').match(/^Bearer\s+(.+)$/)?.[1]?.trim();
  const apiKeyHeader = typeof ctx.req.headers['x-api-key'] === 'string' ? ctx.req.headers['x-api-key'].trim() : '';
  const stickyHeader = typeof ctx.req.headers['x-agentrail-sticky-key'] === 'string' ? ctx.req.headers['x-agentrail-sticky-key'].trim() : '';
  return stickyHeader || bearer || apiKeyHeader || undefined;
}

function attachVirtualModelMeta(request: ChatCompletionRequest, ctx: RequestContext): ChatCompletionRequest {
  const stickyKey = getVirtualModelStickyKey(ctx);
  if (!stickyKey) {
    return request;
  }
  return {
    ...request,
    __agentrail: {
      ...(typeof request.__agentrail === 'object' && request.__agentrail ? request.__agentrail as Record<string, unknown> : {}),
      stickyKey,
    },
  };
}

function normalizeResponsesSuffix(pathname: string): string | null {
  const rawSuffix = pathname.slice('/v1/responses/'.length);
  if (!rawSuffix) return null;
  const normalized: string[] = [];
  for (const rawSegment of rawSuffix.split('/')) {
    if (!rawSegment) return null;
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
      return null;
    }
    normalized.push(encodeURIComponent(segment));
  }
  return normalized.join('/');
}

async function proxyResponsesSubpath(ctx: RequestContext, rawPathname: string): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const suffix = normalizeResponsesSuffix(rawPathname);
  if (!suffix) {
    sendJSON(ctx.res, 400, { error: { message: 'Invalid Responses API path', type: 'invalid_request_error' } });
    return true;
  }

  const raw = await readBody(ctx.req);
  const parsedBody = parseJsonBody<Record<string, unknown>>(raw, ctx.res);
  if (!parsedBody.ok) return true;
  const modelId = typeof parsedBody.value.model === 'string' ? parsedBody.value.model.trim() : '';
  if (!modelId) {
    sendJSON(ctx.res, 400, { error: { message: 'Missing "model" field', type: 'invalid_request_error' } });
    return true;
  }

  const model = getAllActiveCanonicalModelsForApi().find((entry) => entry.id === modelId && entry.capabilities?.includes('chat'));
  const selectedProvider = model?.providers[0];
  const provider = selectedProvider ? providers.find((entry) => entry.name === selectedProvider.name) : undefined;
  if (!provider || !selectedProvider) {
    sendJSON(ctx.res, 400, { error: { message: `No healthy provider is available for model "${modelId}"`, type: 'invalid_request_error' } });
    return true;
  }

  const url = provider.getEndpointUrl(`/v1/responses/${suffix}`);
  const providerHeaders = await provider.getRequestHeaders(ctx.req.headers['content-type'] ?? 'application/json');
  if (!url || !providerHeaders) {
    sendJSON(ctx.res, url ? 401 : 501, { error: { message: `Provider "${provider.name}" cannot proxy this Responses API path`, type: 'unsupported_error' } });
    return true;
  }
  const upstreamHeaders = new Headers(providerHeaders);
  for (const name of ['accept', 'openai-beta'] as const) {
    const value = ctx.req.headers[name];
    if (typeof value === 'string' && value) upstreamHeaders.set(name, value);
  }

  const response = await fetchWithProviderTimeout(
    { providerName: provider.name, operation: `responses/${suffix}` },
    url,
    {
      method: 'POST',
      headers: Object.fromEntries(upstreamHeaders.entries()),
      body: JSON.stringify({ ...parsedBody.value, model: selectedProvider.providerModelId }),
    },
  );
  const responseHeaders: Record<string, string | number> = {};
  for (const name of ['content-type', 'cache-control', 'x-request-id', 'openai-request-id'] as const) {
    const value = response.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  ctx.res.setHeader('X-AgentRail-Provider', provider.name);
  ctx.res.setHeader('X-AgentRail-Route-Model', selectedProvider.providerModelId);
  if (response.body && (response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    ctx.res.writeHead(response.status, responseHeaders);
    const reader = response.body.getReader();
    let downstreamClosed = false;
    const handleClose = () => { downstreamClosed = true; void reader.cancel().catch(() => {}); };
    ctx.res.once('close', handleClose);
    try {
      while (!downstreamClosed) {
        const { done, value } = await reader.read();
        if (done || downstreamClosed) break;
        if (!ctx.res.write(Buffer.from(value))) {
          await Promise.race([
            new Promise<void>((resolve) => ctx.res.once('drain', resolve)),
            new Promise<void>((resolve) => ctx.res.once('close', resolve)),
          ]);
        }
      }
    } finally {
      ctx.res.off('close', handleClose);
    }
    if (!downstreamClosed) ctx.res.end();
    return true;
  }
  const body = Buffer.from(await response.arrayBuffer());
  responseHeaders['Content-Length'] = body.length;
  ctx.res.writeHead(response.status, responseHeaders);
  ctx.res.end(body);
  return true;
}
const MAX_FILE_BYTES = 512 * 1024 * 1024;

function getStorageScope(ctx: RequestContext): { ownerApiKeyId?: string; canAccessAll: boolean } {
  const apiKey = (ctx.req as unknown as Record<string, unknown>).saasApiKey as { id?: string } | undefined;
  const user = (ctx.req as unknown as Record<string, unknown>).saasUser as { isAdmin?: boolean } | undefined;
  return { ownerApiKeyId: apiKey?.id, canAccessAll: user?.isAdmin === true };
}

function canAccessStoredRecord(record: { owner_api_key_id?: string }, scope: { ownerApiKeyId?: string; canAccessAll: boolean }): boolean {
  if (scope.canAccessAll) return true;
  if (scope.ownerApiKeyId) return record.owner_api_key_id === scope.ownerApiKeyId;
  return !record.owner_api_key_id;
}
export async function handleOpenAIRoute(ctx: RequestContext): Promise<boolean> {
  const routeChatCompletion = ctx.options.routeChatCompletion ?? defaultRouteChatCompletion;

  const rawPathname = ctx.requestUrl.split(/[?#]/, 1)[0] ?? ctx.pathname;
  if (rawPathname.startsWith('/v1/responses/') && ctx.req.method === 'POST') {
    return proxyResponsesSubpath(ctx, rawPathname);
  }

  if (ctx.pathname === '/v1/responses' && (ctx.req.method === 'HEAD' || ctx.req.method === 'OPTIONS')) {
    if (!(await checkGatewayAuth(ctx))) return true;
    sendNoContent(ctx.res, 'POST, HEAD, OPTIONS');
    return true;
  }

  if (ctx.pathname === '/v1/responses' && ctx.req.method === 'POST') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<ResponsesRequest>(raw, ctx.res);
    if (!parsedBody.ok) return true;

    let bridge;
    let attachmentSummaryHeader = '';
    try {
      bridge = fromResponsesRequest(parsedBody.value);
      const normalized = await normalizeChatRequestAttachments(bridge.request);
      assertRequestModelCapabilities(normalized.request);
      attachmentSummaryHeader = formatAttachmentSummaryHeader(normalized.summaries);
      bridge = {
        ...bridge,
        request: normalized.request,
        promptText: JSON.stringify(normalized.request.messages),
      };
    } catch (err) {
      if (err instanceof ResponsesCompatibilityError || err instanceof AttachmentProcessingError) {
        sendJSON(ctx.res, err.status, { error: { message: err.message, type: err.type } });
        return true;
      }
      throw err;
    }

    ctx.trace('responses.request', {
      requestId: ctx.requestId,
      model: bridge.request.model ?? null,
      stream: !!bridge.request.stream,
      hasTools: Array.isArray(bridge.request.tools) && bridge.request.tools.length > 0,
    });

    try {
      const { response, provider, routeModel, virtualModelId, virtualModelTraceId } = await routeChatCompletion(attachVirtualModelMeta(bridge.request, ctx));
      ctx.trace('responses.route', {
        requestId: ctx.requestId,
        model: bridge.request.model,
        provider: provider.name,
        routeModel,
        status: response.status,
      });

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
      if (attachmentSummaryHeader) {
        ctx.res.setHeader('X-AgentRail-Attachments', attachmentSummaryHeader);
      }

      if (!response.ok) {
        const rawBody = await response.text();
        const upstreamError = tryParseUpstreamError(rawBody);
        const errorPayload: Record<string, unknown> = {
          id: `resp_error_${Date.now()}`,
          object: 'response',
          status: 'failed',
          model: bridge.request.model,
          created_at: Math.floor(Date.now() / 1000),
          error: {
            type: 'api_error',
            code: response.status === 429 ? 'rate_limited' : response.status === 400 ? 'invalid_request' : 'server_error',
            message: upstreamError?.message ?? `Provider returned status ${response.status}`,
          },
          output: [],
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        };
        const body = JSON.stringify(errorPayload);
        ctx.res.setHeader('Content-Type', 'application/json');
        ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
        ctx.res.writeHead(response.status);
        ctx.res.end(body);
        return true;
      }

      if (bridge.request.stream) {
        sendStream(ctx.res, response.status);
        const transformer = createResponsesStreamTransformer(bridge.request.model);
        ctx.res.write(transformer.start());

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split('\n');
              sseBuffer = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const json = line.slice(6);
                if (json === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(json) as Record<string, unknown>;
                  const transformed = transformer.transform(parsed);
                  if (transformed) ctx.res.write(transformed);
                } catch {
                  // skip malformed upstream stream chunks
                }
              }
            }

            if (sseBuffer.trim().startsWith('data: ')) {
              const json = sseBuffer.trim().slice(6);
              if (json && json !== '[DONE]') {
                try {
                  const parsed = JSON.parse(json) as Record<string, unknown>;
                  const transformed = transformer.transform(parsed);
                  if (transformed) ctx.res.write(transformed);
                } catch {
                  // skip malformed upstream stream chunks
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        }

        const final = transformer.end(bridge.promptText);
        ctx.res.write(final.body);
        usageTracker.record(bridge.request.model, provider.name, final.usage.prompt_tokens, final.usage.completion_tokens);
        const saasUser = getSaasUser(ctx);
        if (saasUser) {
          recordSaasUsage(saasUser.id, final.usage.prompt_tokens, final.usage.completion_tokens).catch(() => {});
        }
        ctx.res.end();
      } else {
        const rawBody = await response.text();
        const openAIBody = JSON.parse(rawBody) as Record<string, unknown>;
        const responsesBody = toResponsesResponse(openAIBody, bridge.request.model, bridge.promptText);
        const usage = (responsesBody.usage as Record<string, number> | undefined);
        if (usage) {
          usageTracker.record(bridge.request.model, provider.name, usage.input_tokens ?? 0, usage.output_tokens ?? 0);
          const saasUser = getSaasUser(ctx);
          if (saasUser) {
            recordSaasUsage(saasUser.id, usage.input_tokens ?? 0, usage.output_tokens ?? 0).catch(() => {});
          }
        }
        const body = JSON.stringify(responsesBody);
        ctx.res.setHeader('Content-Type', 'application/json');
        ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
        ctx.res.writeHead(response.status);
        ctx.res.end(body);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      ctx.trace('responses.error', {
        requestId: ctx.requestId,
        durationMs: Date.now() - ctx.startedAt,
        errorName: err instanceof Error ? err.name : typeof err,
        message,
      });
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
    return true;
  }

  if (ctx.pathname === '/v1/chat/completions' && ctx.req.method === 'POST') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<ChatCompletionRequest>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    let request = parsedBody.value;
    let attachmentSummaryHeader = '';

    ctx.trace('openai.request', {
      requestId: ctx.requestId,
      model: request.model ?? null,
      stream: !!request.stream,
      messageCount: Array.isArray(request.messages) ? request.messages.length : null,
      messageContentShapes: summarizeMessageContentShapes(request.messages),
      toolCount: Array.isArray(request.tools) ? request.tools.length : 0,
      tools: summarizeToolDefinitions(request.tools),
      toolChoice: request.tool_choice ?? null,
      parallelToolCalls: request.parallel_tool_calls ?? null,
    });

    if (!request.model) {
      sendJSON(ctx.res, 400, { error: { message: 'Missing "model" field', type: 'invalid_request_error' } });
      return true;
    }

    try {
      const normalized = await normalizeChatRequestAttachments(request);
      assertRequestModelCapabilities(normalized.request);
      attachmentSummaryHeader = formatAttachmentSummaryHeader(normalized.summaries);
      request = normalized.request;

      const { response, provider, routeModel, virtualModelId, virtualModelTraceId } = await routeChatCompletion(attachVirtualModelMeta(request, ctx));
      ctx.trace('openai.route', {
        requestId: ctx.requestId,
        model: request.model,
        provider: provider.name,
        status: response.status,
      });
      const contentType = response.headers.get('content-type') ?? 'application/json';
      ctx.res.setHeader('Content-Type', contentType);
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
      if (attachmentSummaryHeader) {
        ctx.res.setHeader('X-AgentRail-Attachments', attachmentSummaryHeader);
      }


      if (!response.ok) {
        const rawBody = await response.text();
        const contentType = response.headers.get('content-type') ?? 'application/json';
        ctx.res.setHeader('Content-Type', contentType);
        ctx.res.setHeader('Content-Length', Buffer.byteLength(rawBody));
        ctx.res.writeHead(response.status);
        ctx.res.end(rawBody);
        return true;
      }
      if (request.stream) {
        let completionBuffer = '';
        let rawCompletionBuffer = '';
        let streamUsage: Record<string, number> | null = null;
        const toolCount = Array.isArray(request.tools) ? request.tools.length : 0;
        const hasTools = toolCount > 0;
        let malformedStreamChunks = 0;
        let toolCallChunkCount = 0;
        let sawToolCallFinishReason = false;
        let loggedTextualToolSignal = false;
        if (DEBUG_TOOL_CALLS && hasTools) {
          ctx.trace('openai.stream_tool_debug_start', {
            requestId: ctx.requestId,
            model: request.model,
            provider: provider.name,
            routeModel: routeModel ?? null,
            toolCount,
          });
        }
        if (!hasTools) {
          if (getSettingsConfigSync().streamingMode === 'passthrough') {
            sendStream(ctx.res, response.status);
            const passthrough = await streamPassthroughWithoutTools(
              response.body,
              {
                write: (chunk) => ctx.res.write(chunk),
                once: (event, listener) => ctx.res.once(event, listener),
                off: (event, listener) => ctx.res.off(event, listener),
              },
              ctx.trace,
              ctx.requestId,
              provider.name,
              routeModel,
            );
            completionBuffer = passthrough.completionBuffer;
            rawCompletionBuffer = passthrough.rawCompletionBuffer;
            streamUsage = passthrough.streamUsage;
            malformedStreamChunks = passthrough.malformedStreamChunks;
            loggedTextualToolSignal = passthrough.sawTextualToolSignal;
          } else {
            const validated = await collectValidatedStreamWithoutTools(response.body, ctx.trace, ctx.requestId, provider.name, routeModel);
            completionBuffer = validated.completionBuffer;
            streamUsage = validated.streamUsage;
            malformedStreamChunks = validated.malformedStreamChunks;
            sendStream(ctx.res, response.status);
            for (const chunk of validated.chunks) {
              ctx.res.write(chunk);
            }
          }
        } else if (response.body) {
          sendStream(ctx.res, response.status);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';
          const rawChunks: string[] = [];
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const decoded = decoder.decode(value, { stream: true });
              rawChunks.push(decoded);
              sseBuffer += decoded;
              const lines = sseBuffer.split('\n');
              sseBuffer = lines.pop() ?? '';
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const json = line.slice(6);
                  if (json === '[DONE]') continue;
                  try {
                    const parsed = JSON.parse(json) as Record<string, unknown>;
                    const delta = ((parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta as Record<string, unknown> | undefined)?.content;
                    if (typeof delta === 'string') {
                      rawCompletionBuffer += delta;
                      completionBuffer += stripTextualToolCalls(delta);
                    }
                    const usage = (parsed.usage as Record<string, number> | undefined);
                    if (usage) streamUsage = usage;
                    if (DEBUG_TOOL_CALLS && !hasTools && !loggedTextualToolSignal && typeof delta === 'string') {
                      const textualSignal = summarizeTextualToolCallSignals(completionBuffer);
                      if (textualSignal) {
                        loggedTextualToolSignal = true;
                        ctx.trace('openai.stream_textual_tool_signal', {
                          requestId: ctx.requestId,
                          provider: provider.name,
                          routeModel: routeModel ?? null,
                          ...textualSignal,
                        });
                      }
                    }
                    if (DEBUG_TOOL_CALLS && hasTools) {
                      const toolSummary = summarizeToolCallsForTrace(parsed);
                      if (toolSummary) {
                        toolCallChunkCount += 1;
                        if (toolSummary.finishReason === 'tool_calls') {
                          sawToolCallFinishReason = true;
                        }
                        ctx.trace('openai.stream_tool_chunk', {
                          requestId: ctx.requestId,
                          provider: provider.name,
                          routeModel: routeModel ?? null,
                          ...toolSummary,
                        });
                      }
                    }
                  } catch {
                    malformedStreamChunks += 1;
                  }
                }
              }
            }
            if (sseBuffer.trim().startsWith('data: ')) {
              const json = sseBuffer.trim().slice(6);
              if (json && json !== '[DONE]') {
                try {
                  const parsed = JSON.parse(json) as Record<string, unknown>;
                  const delta = ((parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta as Record<string, unknown> | undefined)?.content;
                  if (typeof delta === 'string') {
                    rawCompletionBuffer += delta;
                    completionBuffer += stripTextualToolCalls(delta);
                  }
                  const usage = (parsed.usage as Record<string, number> | undefined);
                  if (usage) streamUsage = usage;
                  if (DEBUG_TOOL_CALLS && !hasTools && !loggedTextualToolSignal && typeof delta === 'string') {
                    const textualSignal = summarizeTextualToolCallSignals(completionBuffer);
                    if (textualSignal) {
                      loggedTextualToolSignal = true;
                      ctx.trace('openai.stream_textual_tool_signal', {
                        requestId: ctx.requestId,
                        provider: provider.name,
                        routeModel: routeModel ?? null,
                        trailingBuffer: true,
                        ...textualSignal,
                      });
                    }
                  }
                  if (DEBUG_TOOL_CALLS && hasTools) {
                    const toolSummary = summarizeToolCallsForTrace(parsed);
                    if (toolSummary) {
                      toolCallChunkCount += 1;
                      if (toolSummary.finishReason === 'tool_calls') {
                        sawToolCallFinishReason = true;
                      }
                      ctx.trace('openai.stream_tool_chunk', {
                        requestId: ctx.requestId,
                        provider: provider.name,
                        routeModel: routeModel ?? null,
                        ...toolSummary,
                        trailingBuffer: true,
                      });
                    }
                  }
                } catch {
                  malformedStreamChunks += 1;
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
          const normalizedPseudoToolPayload = toolCallChunkCount === 0 && !sawToolCallFinishReason
            ? normalizePseudoToolCallsFromContent(rawCompletionBuffer)
            : null;
          if (normalizedPseudoToolPayload) {
            ctx.res.write(buildSyntheticToolCallStream(
              normalizedPseudoToolPayload.tool_calls,
              streamUsage,
              request.model,
              `chatcmpl-${ctx.requestId}`,
            ));
            completionBuffer = normalizedPseudoToolPayload.content ?? '';
            toolCallChunkCount = normalizedPseudoToolPayload.tool_calls.length;
            sawToolCallFinishReason = true;
          } else {
            for (const chunk of rawChunks) {
              ctx.res.write(chunk);
            }
          }
        }
        if (shouldRejectTextualToolCallText(completionBuffer, hasTools, toolCallChunkCount > 0 || sawToolCallFinishReason)) {
          throw new Error('Provider returned textual tool-call content without structured tool_calls');
        }
        if (DEBUG_TOOL_CALLS && hasTools) {
          ctx.trace('openai.stream_tool_debug_end', {
            requestId: ctx.requestId,
            provider: provider.name,
            routeModel: routeModel ?? null,
            toolCallChunkCount,
            sawToolCallFinishReason,
            malformedStreamChunks,
            usedReportedUsage: !!streamUsage,
            completionPreview: completionBuffer.slice(0, 160),
            completionLength: completionBuffer.length,
          });
        } else if (DEBUG_TOOL_CALLS && !hasTools) {
          const textualSignal = summarizeTextualToolCallSignals(completionBuffer);
          if (textualSignal) {
            ctx.trace('openai.stream_textual_tool_summary', {
              requestId: ctx.requestId,
              provider: provider.name,
              routeModel: routeModel ?? null,
              completionLength: completionBuffer.length,
              ...textualSignal,
            });
          } else if (completionBuffer.trim().length > 0) {
            ctx.trace('openai.stream_no_tools_text_summary', {
              requestId: ctx.requestId,
              provider: provider.name,
              routeModel: routeModel ?? null,
              completionLength: completionBuffer.length,
              preview: completionBuffer.slice(0, 220),
            });
          }
        }
        const saasUser = getSaasUser(ctx);
        if (streamUsage) {
          usageTracker.record(request.model, provider.name, streamUsage.prompt_tokens ?? 0, streamUsage.completion_tokens ?? 0);
          if (saasUser) {
            recordSaasUsage(saasUser.id, streamUsage.prompt_tokens ?? 0, streamUsage.completion_tokens ?? 0).catch(() => {});
          }
        } else if (completionBuffer) {
          const promptText = JSON.stringify(request.messages ?? []);
          const est = estimateUsage({ promptText, completionText: completionBuffer });
          usageTracker.record(request.model, provider.name, est.prompt_tokens, est.completion_tokens);
          if (saasUser) {
            recordSaasUsage(saasUser.id, est.prompt_tokens, est.completion_tokens).catch(() => {});
          }
        }
        ctx.res.end();
      } else {
        const rawBody = await response.text();
        const parsedResponseBody = normalizePseudoToolCallsInChatResponse(JSON.parse(rawBody) as Record<string, unknown>);
        const message = ((parsedResponseBody.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined);
        const completionText = String(
          message?.content ?? '',
        );
        const hasStructuredToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
        if (shouldRejectTextualToolCallText(completionText, Array.isArray(request.tools) && request.tools.length > 0, hasStructuredToolCalls)) {
          throw new Error('Provider returned textual tool-call content without structured tool_calls');
        }
        const strippedCompletionText = stripTextualToolCalls(completionText);
        const promptText = JSON.stringify(request.messages ?? []);
        const normalizedBody = normalizeOpenAIResponseUsage(parsedResponseBody, promptText, strippedCompletionText);
        const usage = (normalizedBody.usage as Record<string, number> | undefined);
        if (usage) {
          usageTracker.record(request.model, provider.name, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
          const saasUser = getSaasUser(ctx);
          if (saasUser) {
            recordSaasUsage(saasUser.id, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0).catch(() => {});
          }
        }
        const body = JSON.stringify(normalizedBody);
        ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
        ctx.res.writeHead(response.status);
        ctx.res.end(body);
      }
    } catch (err) {
      if (err instanceof AttachmentProcessingError) {
        const invalidMessageIndex = extractInvalidMessageIndex(err.message);
        ctx.trace('openai.attachments_error', {
          requestId: ctx.requestId,
          model: request.model ?? null,
          message: err.message,
          messageCount: Array.isArray(request.messages) ? request.messages.length : null,
          messageContentShapes: summarizeMessageContentShapes(request.messages),
          invalidMessageIndex,
          invalidMessage: invalidMessageIndex !== null && Array.isArray(request.messages)
            ? summarizeSingleMessageContent(request.messages[invalidMessageIndex], invalidMessageIndex)
            : null,
        });
        sendJSON(ctx.res, err.status, { error: { message: err.message, type: err.type } });
        return true;
      }
      if (err instanceof ToolCallContractError) {
        ctx.trace('openai.tool_call_contract_error', {
          requestId: ctx.requestId,
          model: request.model ?? null,
          durationMs: Date.now() - ctx.startedAt,
          message: err.message,
        });
        sendJSON(ctx.res, err.status, { error: { message: err.message, type: err.type } });
        return true;
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      ctx.trace('openai.error', {
        requestId: ctx.requestId,
        model: request.model ?? null,
        durationMs: Date.now() - ctx.startedAt,
        errorName: err instanceof Error ? err.name : typeof err,
        message,
      });
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
    return true;
  }

  if (ctx.pathname === '/v1/completions' && ctx.req.method === 'POST') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<CompletionsRequest>(raw, ctx.res);
    if (!parsedBody.ok) return true;

    try {
      const bridge = fromCompletionsRequest(parsedBody.value);
      const routed = await routeChatCompletion(attachVirtualModelMeta(bridge.request, ctx));

      if (bridge.request.stream) {
        const contentType = routed.response.headers.get('content-type') ?? 'text/event-stream';
        ctx.res.setHeader('Content-Type', contentType);
        ctx.res.writeHead(routed.response.status);
        if (routed.response.body) {
          const reader = routed.response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              ctx.res.write(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        ctx.res.end();
        return true;
      }

      const rawBody = await routed.response.text();
      const openAIResponse = JSON.parse(rawBody) as Record<string, unknown>;
      const completionsBody = toCompletionsResponse(openAIResponse, bridge.request.model, bridge.promptText);
      const usage = completionsBody.usage as Record<string, number> | undefined;
      if (usage) {
        usageTracker.record(bridge.request.model, routed.provider.name, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
      }
      const body = JSON.stringify(completionsBody);
      ctx.res.setHeader('Content-Type', 'application/json');
      ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
      ctx.res.writeHead(routed.response.status);
      ctx.res.end(body);
    } catch (err) {
      if (err instanceof CompletionsCompatibilityError) {
        sendJSON(ctx.res, err.status, { error: { message: err.message, type: err.type } });
        return true;
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJSON(ctx.res, 500, { error: { message, type: 'internal_error' } });
    }
    return true;
  }

  if (ctx.pathname === '/v1/files' && ctx.req.method === 'POST') {
    if (!(await checkGatewayAuth(ctx))) return true;
    try {
      const declaredLength = Number(ctx.req.headers['content-length'] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES + 1024 * 1024) {
        sendJSON(ctx.res, 400, { error: { message: 'File exceeds 512 MiB limit', type: 'invalid_request_error' } });
        return true;
      }
      const bodyBuffer = await readBodyBuffer(ctx.req, MAX_FILE_BYTES + 1024 * 1024);
      const headers = new Headers();
      for (const [name, value] of Object.entries(ctx.req.headers)) if (typeof value === 'string') headers.set(name, value);
      const request = new Request('http://' + String(ctx.req.headers.host ?? 'localhost') + ctx.pathname, { method: 'POST', headers, body: new Uint8Array(bodyBuffer) });
      const formData = await request.formData();
      const file = formData.get('file');
      const purpose = String(formData.get('purpose') ?? '').trim();
      if (!(file instanceof File) || !purpose) {
        sendJSON(ctx.res, 400, { error: { message: 'Missing file or purpose', type: 'invalid_request_error' } });
        return true;
      }
      if (file.size > MAX_FILE_BYTES) {
        sendJSON(ctx.res, 400, { error: { message: 'File exceeds 512 MiB limit', type: 'invalid_request_error' } });
        return true;
      }
      const anchor = formData.get('expires_after[anchor]');
      const secondsRaw = formData.get('expires_after[seconds]');
      let expiresAt: number | undefined;
      if (anchor !== null || secondsRaw !== null) {
        const seconds = Number(secondsRaw);
        if (anchor !== 'created_at' || !Number.isInteger(seconds) || seconds <= 0) {
          sendJSON(ctx.res, 400, { error: { message: 'Invalid expires_after', type: 'invalid_request_error' } });
          return true;
        }
        expiresAt = Math.floor(Date.now() / 1000) + seconds;
      }
      const scope = getStorageScope(ctx);
      const record = await createStoredFile({ filename: file.name, purpose, mimeType: file.type, content: Buffer.from(await file.arrayBuffer()), ownerApiKeyId: scope.ownerApiKeyId, expiresAt });
      sendJSON(ctx.res, 200, formatStoredFile(record));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      sendJSON(ctx.res, 400, { error: { message, type: 'invalid_request_error' } });
    }
    return true;
  }

  if (ctx.pathname === '/v1/files' && ctx.req.method === 'GET') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const query = new URL(ctx.requestUrl, 'http://localhost').searchParams;
    const limit = Number(query.get('limit') ?? '20');
    const order = query.get('order') ?? 'desc';
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000 || !['asc', 'desc'].includes(order)) {
      sendJSON(ctx.res, 400, { error: { message: 'Invalid file list parameters', type: 'invalid_request_error' } });
      return true;
    }
    const scope = getStorageScope(ctx);
    const purpose = query.get('purpose');
    let files = (await listStoredFiles()).filter((file) => canAccessStoredRecord(file, scope) && (!purpose || file.purpose === purpose));
    if (order === 'asc') files.reverse();
    const totalCount = files.length;
    const after = query.get('after');
    if (after) {
      const cursor = files.findIndex((file) => file.id === after);
      if (cursor < 0) { sendJSON(ctx.res, 400, { error: { message: 'Invalid after cursor', type: 'invalid_request_error' } }); return true; }
      files = files.slice(cursor + 1);
    }
    const hasMore = files.length > limit;
    files = files.slice(0, limit);
    sendJSON(ctx.res, 200, { object: 'list', data: files.map(formatStoredFile), first_id: files[0]?.id ?? null, last_id: files.at(-1)?.id ?? null, has_more: hasMore, total_count: totalCount });
    return true;
  }

  if (ctx.pathname.startsWith('/v1/files/') && ctx.req.method === 'GET') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const rest = ctx.pathname.slice('/v1/files/'.length);
    const [id, action] = rest.split('/', 2);
    if (!id) {
      sendJSON(ctx.res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
      return true;
    }
    const fileRecord = await getStoredFile(id);
    if (!fileRecord || !canAccessStoredRecord(fileRecord, getStorageScope(ctx))) {
      sendJSON(ctx.res, 404, { error: { message: 'File not found', type: 'invalid_request_error' } });
      return true;
    }
    if (action === 'content') {
      const content = await getStoredFileContent(id);
      if (!content) {
        sendJSON(ctx.res, 404, { error: { message: 'File content not found', type: 'invalid_request_error' } });
        return true;
      }
      const sanitizedFilename = fileRecord.filename.replace(/[^\w.\-()\[\] ]/g, '_').slice(0, 255);
      ctx.res.writeHead(200, {
        'Content-Type': fileRecord.mime_type || 'application/octet-stream',
        'Content-Length': content.length,
        'Content-Disposition': 'attachment; filename="' + sanitizedFilename + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileRecord.filename),
      });
      ctx.res.end(content);
      return true;
    }
    sendJSON(ctx.res, 200, formatStoredFile(fileRecord));
    return true;
  }

  if (ctx.pathname.startsWith('/v1/files/') && ctx.req.method === 'DELETE') {
    if (!(await checkGatewayAuth(ctx))) return true;
    const id = ctx.pathname.slice('/v1/files/'.length);
    const record = await getStoredFile(id);
    const deleted = !!record && canAccessStoredRecord(record, getStorageScope(ctx)) && await deleteStoredFile(id);
    if (!deleted) {
      sendJSON(ctx.res, 404, { error: { message: 'File not found', type: 'invalid_request_error' } });
      return true;
    }
    sendJSON(ctx.res, 200, { id, object: 'file', deleted: true });
    return true;
  }

  return false;
}
