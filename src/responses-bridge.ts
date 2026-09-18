import type { ChatCompletionRequest, ChatMessage, ChatMessageContent } from './types.js';
import { contentToText } from './attachments.js';
import { ensureUsage, type NormalizedUsage } from './usage.js';

export class ResponsesCompatibilityError extends Error {
  readonly status = 400;
  readonly type = 'invalid_request_error';

  constructor(message: string) {
    super(message);
    this.name = 'ResponsesCompatibilityError';
  }
}

export interface ResponsesRequest {
  model?: string;
  input?: unknown;
  instructions?: unknown;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  tools?: unknown;
  tool_choice?: unknown;
  previous_response_id?: unknown;
  [key: string]: unknown;
}

export interface ResponsesBridgeResult {
  request: ChatCompletionRequest;
  promptText: string;
}

type BridgeMessage = ChatMessage & {
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value: unknown, context: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  throw new ResponsesCompatibilityError(`${context} must be text in AgentRail's Responses API compatibility layer.`);
}

function extractContentText(content: unknown, context: string): string {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) {
    return requireText(content, context);
  }

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }

    if (!isRecord(part)) {
      throw new ResponsesCompatibilityError(`${context} contains an unsupported content block.`);
    }

    const type = String(part.type ?? '');
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      parts.push(requireText(part.text, `${context}.${type}.text`));
      continue;
    }

    throw new ResponsesCompatibilityError(`Unsupported Responses API content block type: ${type || 'unknown'}.`);
  }

  return parts.join('');
}

function normalizeMessageContent(content: unknown, context: string): ChatMessageContent {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    return requireText(content, context);
  }

  const normalized: Exclude<ChatMessageContent, string> = content.map((part, index) => {
    if (typeof part === 'string') {
      return { type: 'text', text: part };
    }

    if (!isRecord(part)) {
      throw new ResponsesCompatibilityError(`${context}[${index}] contains an unsupported content block.`);
    }

    const type = String(part.type ?? '');
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      return {
        type: type === 'input_text' ? ('input_text' as const) : ('text' as const),
        text: requireText(part.text, `${context}[${index}].text`),
      };
    }

    if (type === 'input_image') {
      const imageUrl = part.image_url;
      if (typeof imageUrl !== 'string' && !(isRecord(imageUrl) && typeof imageUrl.url === 'string')) {
        throw new ResponsesCompatibilityError(`${context}[${index}].image_url must be a string or object with a url field.`);
      }
      return {
        type: 'input_image',
        image_url: typeof imageUrl === 'string' ? imageUrl : { url: String(imageUrl.url), detail: imageUrl.detail === 'low' || imageUrl.detail === 'high' || imageUrl.detail === 'auto' ? imageUrl.detail : undefined },
        detail: part.detail === 'low' || part.detail === 'high' || part.detail === 'auto' ? part.detail : undefined,
      };
    }

    if (type === 'input_file') {
      const filename = typeof part.filename === 'string' ? part.filename : '';
      if (!filename) {
        throw new ResponsesCompatibilityError(`${context}[${index}].filename is required for input_file content.`);
      }
      return {
        type: 'input_file',
        filename,
        mime_type: typeof part.mime_type === 'string' ? part.mime_type : undefined,
        data: typeof part.data === 'string' ? part.data : undefined,
        text: typeof part.text === 'string' ? part.text : undefined,
      };
    }

    if (type === 'attachment_metadata') {
      const filename = typeof part.filename === 'string' ? part.filename : '';
      if (!filename) {
        throw new ResponsesCompatibilityError(`${context}[${index}].filename is required for attachment_metadata content.`);
      }
      return {
        type: 'attachment_metadata',
        filename,
        mime_type: typeof part.mime_type === 'string' ? part.mime_type : undefined,
        size_bytes: typeof part.size_bytes === 'number' ? part.size_bytes : undefined,
        cache_path: typeof part.cache_path === 'string' ? part.cache_path : undefined,
        source: typeof part.source === 'string' ? part.source : undefined,
        status: typeof part.status === 'string' ? part.status : undefined,
        attachment_id: typeof part.attachment_id === 'string' ? part.attachment_id : undefined,
      };
    }

    throw new ResponsesCompatibilityError(`Unsupported Responses API content block type: ${type || 'unknown'}.`);
  });

  const hasNonTextParts = normalized.some((part) => part.type !== 'text' && part.type !== 'input_text');
  if (!hasNonTextParts) {
    return normalized
      .map((part) => (part.type === 'text' || part.type === 'input_text') ? String(part.text ?? '') : '')
      .join('');
  }

  return normalized;
}

function normalizeRole(value: unknown): BridgeMessage['role'] {
  const role = String(value ?? 'user');
  if (role === 'developer' || role === 'system') return 'system';
  if (role === 'assistant') return 'assistant';
  if (role === 'tool') return 'tool';
  return 'user';
}

function messageHasContent(message: BridgeMessage): boolean {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  if (typeof message.content === 'string') return message.content.trim().length > 0;
  return Array.isArray(message.content) && message.content.length > 0;
}

function addInputItem(messages: BridgeMessage[], item: unknown): void {
  if (typeof item === 'string') {
    messages.push({ role: 'user', content: item });
    return;
  }

  if (!isRecord(item)) {
    throw new ResponsesCompatibilityError('Responses API input items must be text or objects.');
  }

  const type = String(item.type ?? 'message');

  if (type === 'function_call_output') {
    const callId = typeof item.call_id === 'string' ? item.call_id : '';
    if (!callId) {
      throw new ResponsesCompatibilityError('function_call_output items require a call_id.');
    }
    messages.push({
      role: 'tool',
      content: extractContentText(item.output ?? '', 'function_call_output.output'),
      tool_call_id: callId,
    });
    return;
  }

  if (type === 'function_call') {
    const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : `call_${Date.now()}`;
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name) {
      throw new ResponsesCompatibilityError('function_call items require a name.');
    }
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        },
      ],
    });
    return;
  }

  if (type === 'additional_tools') {
    return;
  }

  if (type !== 'message' && type !== 'input_message') {
    throw new ResponsesCompatibilityError(`Unsupported Responses API input item type: ${type || 'unknown'}.`);
  }

  messages.push({
    role: normalizeRole(item.role),
    content: normalizeMessageContent(item.content ?? '', 'message.content'),
  });
}

function toMessages(input: unknown, instructions: unknown): { messages: BridgeMessage[]; additionalTools: unknown[] } {
  const additionalTools: unknown[] = [];
  const messages: BridgeMessage[] = [];

  if (instructions !== undefined) {
    messages.push({ role: 'system', content: extractContentText(instructions, 'instructions') });
  }

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (isRecord(item) && String((item as Record<string, unknown>).type ?? '') === 'additional_tools') {
        const tools = (item as Record<string, unknown>).tools;
        if (Array.isArray(tools)) {
          additionalTools.push(...tools);
        }
      } else {
        addInputItem(messages, item);
      }
    }
  } else if (isRecord(input)) {
    addInputItem(messages, input);
  } else if (input == null) {
    throw new ResponsesCompatibilityError('Missing "input" field');
  } else {
    throw new ResponsesCompatibilityError('Responses API input must be a string, object, or array.');
  }

  if (messages.length === 0 || messages.every((message) => !messageHasContent(message))) {
    throw new ResponsesCompatibilityError('Responses API input did not contain any text, multimodal, or tool-call content.');
  }

  return { messages, additionalTools };
}

function toOpenAITools(tools: unknown): Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }> | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) {
    throw new ResponsesCompatibilityError('Responses API tools must be an array.');
  }

  const mapped: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }> = [];
  for (const tool of tools) {
    if (!isRecord(tool)) {
      throw new ResponsesCompatibilityError('Responses API tools must be objects.');
    }

    const type = String(tool.type ?? '');
    if (type === 'function' || type === 'custom') {
      const name = typeof tool.name === 'string' ? tool.name : '';
      if (!name) {
        throw new ResponsesCompatibilityError(`${type === 'function' ? 'Function' : 'Custom'} tools require a name.`);
      }
      mapped.push({
        type: 'function' as const,
        function: {
          name,
          description: typeof tool.description === 'string' ? tool.description : undefined,
          parameters: isRecord(tool.parameters) ? tool.parameters : { type: 'object', properties: {} },
        },
      });
    } else if (type === 'namespace') {
      const innerTools = Array.isArray(tool.tools) ? tool.tools : [];
      const innerMapped = toOpenAITools(innerTools);
      if (innerMapped) {
        mapped.push(...innerMapped);
      }
    } else {
      // Skip unsupported tool types (file_search, code_interpreter, web_search, computer, etc.)
      // instead of throwing, so the request can proceed without them
    }
  }

  return mapped.length ? mapped : undefined;
}

function toOpenAIToolChoice(choice: unknown): ChatCompletionRequest['tool_choice'] | undefined {
  if (choice === undefined) return undefined;
  if (typeof choice === 'string') {
    if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
    return undefined;
  }

  if (!isRecord(choice)) return undefined;
  if (choice.type === 'function' && typeof choice.name === 'string') {
    return { type: 'function', function: { name: choice.name } };
  }

  return undefined;
}

function mergeToolArrays(topLevel: unknown, additional: unknown[]): unknown {
  if (additional.length === 0) return topLevel;
  const base = Array.isArray(topLevel) ? [...topLevel] : [];
  base.push(...additional);
  return base;
}

export function fromResponsesRequest(req: ResponsesRequest): ResponsesBridgeResult {
  if (req.previous_response_id !== undefined) {
    throw new ResponsesCompatibilityError('previous_response_id is not supported by AgentRail Responses API compatibility yet. Send the full conversation in input instead.');
  }

  if (!req.model) {
    throw new ResponsesCompatibilityError('Missing "model" field');
  }

  const { messages, additionalTools } = toMessages(req.input, req.instructions);
  const request: ChatCompletionRequest = {
    model: req.model,
    messages,
    stream: req.stream,
    temperature: req.temperature,
    top_p: req.top_p,
    max_tokens: req.max_output_tokens ?? req.max_tokens,
    tools: toOpenAITools(mergeToolArrays(req.tools, additionalTools)),
    tool_choice: toOpenAIToolChoice(req.tool_choice),
  };

  return {
    request,
    promptText: JSON.stringify(messages),
  };
}

function responseUsage(usage: NormalizedUsage) {
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

function collectOutputText(output: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('');
}

export function toResponsesResponse(
  openAIResponse: Record<string, unknown>,
  modelId: string,
  promptText: string,
): Record<string, unknown> {
  const choices = (openAIResponse.choices as Array<Record<string, unknown>>) ?? [];
  const firstChoice = choices[0] ?? {};
  const message = (firstChoice.message as Record<string, unknown>) ?? {};
  const contentText = contentToText(message.content as ChatMessageContent);
  const toolCalls = Array.isArray(message.tool_calls)
    ? (message.tool_calls as Array<Record<string, unknown>>)
    : [];
  const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null;
  const usage = ensureUsage(openAIResponse.usage, { promptText, completionText: contentText });

  const output: Array<Record<string, unknown>> = [];

  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const fn = (toolCall.function as Record<string, unknown>) ?? {};
      output.push({
        id: typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : `fc_${Date.now()}`,
        type: 'function_call',
        call_id: typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : `fc_${Date.now()}`,
        name: typeof fn.name === 'string' ? fn.name : 'tool',
        arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        status: 'completed',
      });
    }
  } else {
    output.push({
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: contentText,
          annotations: [],
        },
      ],
      status: 'completed',
    });
  }

  return {
    id: String(openAIResponse.id ?? `resp_${Date.now()}`),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: modelId,
    output,
    output_text: toolCalls.length > 0 ? collectOutputText(output) : contentText,
    usage: responseUsage(usage),
    incomplete_details: null,
    error: null,
    metadata: null,
    temperature: openAIResponse.temperature ?? null,
    top_p: openAIResponse.top_p ?? null,
    tools: [],
    tool_choice: null,
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: null,
    max_output_tokens: openAIResponse.max_tokens ?? null,
    finish_reason: finishReason,
  };
}

export function createResponsesStreamTransformer(modelId: string) {
  let responseId = `resp_${Date.now()}`;
  let outputIndex = 0;
  let textBuffer = '';
  let sawTextOutput = false;
  const functionCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let usage: NormalizedUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated: false };

  function sseEvent(event: string, data: Record<string, unknown>): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return {
    start(): string {
      return sseEvent('response.created', {
        type: 'response.created',
        response: {
          id: responseId,
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          status: 'in_progress',
          model: modelId,
          output: [],
        },
      });
    },

    transform(openAIChunk: Record<string, unknown>): string {
      const choices = (openAIChunk.choices as Array<Record<string, unknown>>) ?? [];
      const choice = choices[0] ?? {};
      const delta = (choice.delta as Record<string, unknown>) ?? {};
      const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
      const chunkUsage = openAIChunk.usage;
      if (chunkUsage) {
        usage = ensureUsage(chunkUsage, { promptText: '', completionText: textBuffer });
      }

      let out = '';
      const text = typeof delta.content === 'string' ? delta.content : '';
      if (text) {
        if (!sawTextOutput) {
          sawTextOutput = true;
          out += sseEvent('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              id: `msg_${Date.now()}`,
              type: 'message',
              role: 'assistant',
              content: [],
              status: 'in_progress',
            },
          });
          out += sseEvent('response.content_part.added', {
            type: 'response.content_part.added',
            output_index: outputIndex,
            content_index: 0,
            part: {
              type: 'output_text',
              text: '',
              annotations: [],
            },
          });
        }
        textBuffer += text;
        out += sseEvent('response.output_text.delta', {
          type: 'response.output_text.delta',
          output_index: outputIndex,
          content_index: 0,
          delta: text,
        });
      }

      const toolCalls = Array.isArray(delta.tool_calls)
        ? (delta.tool_calls as Array<Record<string, unknown>>)
        : [];

      for (const toolCall of toolCalls) {
        const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
        const fn = (toolCall.function as Record<string, unknown>) ?? {};
        const existing = functionCalls.get(index) ?? {
          id: typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : `fc_${Date.now()}_${index}`,
          name: typeof fn.name === 'string' ? fn.name : 'tool',
          arguments: '',
        };

        if (!functionCalls.has(index)) {
          out += sseEvent('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: outputIndex + index,
            item: {
              id: existing.id,
              type: 'function_call',
              call_id: existing.id,
              name: existing.name,
              arguments: '',
              status: 'in_progress',
            },
          });
        }

        const argsDelta = typeof fn.arguments === 'string' ? fn.arguments : '';
        existing.arguments += argsDelta;
        if (typeof fn.name === 'string' && fn.name) {
          existing.name = fn.name;
        }
        functionCalls.set(index, existing);

        if (argsDelta) {
          out += sseEvent('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            output_index: outputIndex + index,
            delta: argsDelta,
          });
        }
      }

      if (finishReason === 'tool_calls') {
        for (const [index, call] of functionCalls.entries()) {
          out += sseEvent('response.function_call_arguments.done', {
            type: 'response.function_call_arguments.done',
            output_index: outputIndex + index,
            arguments: call.arguments,
          });
        }
      }

      return out;
    },

    end(promptText: string): { body: string; usage: NormalizedUsage } {
      if (usage.total_tokens === 0) {
        usage = ensureUsage(undefined, { promptText, completionText: textBuffer });
      }

      let out = '';
      if (sawTextOutput) {
        out += sseEvent('response.output_text.done', {
          type: 'response.output_text.done',
          output_index: outputIndex,
          content_index: 0,
          text: textBuffer,
        });
        out += sseEvent('response.content_part.done', {
          type: 'response.content_part.done',
          output_index: outputIndex,
          content_index: 0,
          part: { type: 'output_text', text: textBuffer, annotations: [] },
        });
      }

      for (const [index, call] of functionCalls.entries()) {
        out += sseEvent('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: outputIndex + index,
          item: {
            id: call.id,
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
            status: 'completed',
          },
        });
      }

      out += sseEvent('response.completed', {
        type: 'response.completed',
        response: {
          id: responseId,
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          status: 'completed',
          model: modelId,
          output: [],
          usage: responseUsage(usage),
        },
      });

      return { body: out, usage };
    },
  };
}

