import type { ChatCompletionRequest } from '../types.js';

interface CodexMessage {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
}

interface CodexTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

interface CodexReasoningConfig {
  effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface CodexRequest {
  model: string;
  input: string | CodexMessage[];
  tools?: CodexTool[];
  reasoning?: CodexReasoningConfig;
  store?: boolean;
  stream?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  metadata?: Record<string, string>;
}

interface CodexOutputText {
  type: 'text';
  text: string;
}

interface CodexOutputMessage {
  type: 'message';
  id: string;
  role: 'assistant';
  content: CodexOutputText[];
}

interface CodexOutputToolCall {
  type: 'function_call';
  id: string;
  name: string;
  arguments: string;
  status: string;
}

type CodexOutput = CodexOutputMessage | CodexOutputToolCall;

export interface CodexResponse {
  id: string;
  object: 'response';
  model: string;
  output: CodexOutput[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
  };
}

export interface CodexStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<Record<string, unknown>>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function toCodexRequest(req: ChatCompletionRequest): CodexRequest {
  const hasSystem = req.messages.some((m) => m.role === 'system');
  const messages = req.messages.map((m) => {
    const role = m.role === 'system' ? 'developer' : m.role;
    if (typeof m.content === 'string') {
      return { role, content: m.content } as CodexMessage;
    }
    const parts = (Array.isArray(m.content) ? m.content : []).map((p) => {
      if (p.type === 'text' || p.type === 'input_text') {
        return { type: 'text', text: (p as { text: string }).text };
      }
      if (p.type === 'image_url') {
        const img = p as { image_url: string | { url: string; detail?: string } };
        const url = typeof img.image_url === 'string' ? img.image_url : img.image_url.url;
        return { type: 'image_url', image_url: { url, detail: (typeof img.image_url === 'object' ? img.image_url.detail : undefined) } };
      }
      if (p.type === 'input_image') {
        const img = p as { image_url: string | { url: string; detail?: string } };
        const url = typeof img.image_url === 'string' ? img.image_url : img.image_url.url;
        return { type: 'image_url', image_url: { url } };
      }
      return { type: 'text', text: '' };
    });
    return { role, content: parts } as CodexMessage;
  });

  const codexReq: CodexRequest = {
    model: req.model,
    input: messages,
    store: req.store === undefined ? false : Boolean(req.store),
    stream: req.stream,
  };

  if (!hasSystem && messages.length > 0) {
    const firstMsg = messages[0];
    if (firstMsg.role === 'developer') {
      codexReq.input = messages;
    }
  }

  if (req.max_tokens !== undefined) {
    codexReq.max_output_tokens = req.max_tokens;
  }
  if (req.temperature !== undefined) {
    codexReq.temperature = req.temperature;
  }
  if (req.top_p !== undefined) {
    codexReq.top_p = req.top_p;
  }

  if (req.tools && Array.isArray(req.tools)) {
    codexReq.tools = req.tools.map((tool) => {
      const fn = tool.function;
      return {
        type: 'function',
        function: {
          name: fn?.name || '',
          description: fn?.description,
          parameters: fn?.parameters,
        },
      };
    });
  }

  const modelLower = req.model.toLowerCase();
  if (modelLower.includes('xhigh') || modelLower.includes('x-high')) {
    codexReq.reasoning = { effort: 'xhigh' };
  } else if (modelLower.includes('high')) {
    codexReq.reasoning = { effort: 'high' };
  } else if (modelLower.includes('medium')) {
    codexReq.reasoning = { effort: 'medium' };
  } else if (modelLower.includes('low')) {
    codexReq.reasoning = { effort: 'low' };
  }

  return codexReq;
}

export function fromCodexResponse(codexResp: CodexResponse): ChatCompletionResponse {
  let content = '';
  const toolCalls: Array<Record<string, unknown>> = [];

  for (const output of codexResp.output || []) {
    if (output.type === 'message') {
      content = output.content?.map((c) => c.text).join('') || '';
    }
    if (output.type === 'function_call') {
      toolCalls.push({
        id: output.id,
        type: 'function',
        function: {
          name: output.name,
          arguments: output.arguments,
        },
      });
    }
  }

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: content || null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';

  return {
    id: codexResp.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: codexResp.model,
    choices: [{
      index: 0,
      message: message as ChatCompletionResponse['choices'][0]['message'],
      finish_reason: finishReason,
    }],
    usage: codexResp.usage ? {
      prompt_tokens: codexResp.usage.input_tokens || 0,
      completion_tokens: codexResp.usage.output_tokens || 0,
      total_tokens: (codexResp.usage.input_tokens || 0) + (codexResp.usage.output_tokens || 0),
    } : undefined,
  };
}

export function createCodexToOpenAIStreamTransformer() {
  let messageContent = '';
  let toolCallsAccum: Record<number, Record<string, unknown>> = {};
  let responseId = '';
  let responseModel = '';

  return {
    transform(event: CodexStreamEvent): string {
      let out = '';

      if (event.type === 'response.output_text.delta') {
        const delta = event.delta as string | undefined;
        const text = delta || '';
        messageContent += text;
        out = `data: ${JSON.stringify({
          id: responseId || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: responseModel,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        })}\n\n`;
      }

      if (event.type === 'response.function_call_arguments.delta') {
        const delta = event.delta as string | undefined;
        const index = Number((event as Record<string, unknown>).index ?? 0);
        const id = (event as Record<string, unknown>).item_id as string | undefined;
        const name = (event as Record<string, unknown>).name as string | undefined;

        if (!toolCallsAccum[index]) {
          toolCallsAccum[index] = {
            id: id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: { name: name || 'tool', arguments: '' },
            index,
          };
        }

        const existing = toolCallsAccum[index].function as Record<string, unknown>;
        existing.arguments = (existing.arguments || '') + (delta || '');
        const accumulatedArguments = String(existing.arguments || '');

        out = `data: ${JSON.stringify({
          id: responseId || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: responseModel,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                id: toolCallsAccum[index].id as string,
                function: {
                  name: existing.name as string,
                  arguments: accumulatedArguments,
                },
              }],
            },
            finish_reason: null,
          }],
        })}\n\n`;
      }

      return out;
    },

    end(): string {
      let out = '';

      const toolCallValues = Object.values(toolCallsAccum);
      if (toolCallValues.length > 0) {
        for (const tc of toolCallValues) {
          out += `data: ${JSON.stringify({
            id: responseId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: responseModel,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: tc.index as number,
                  id: tc.id as string,
                  function: { name: (tc.function as Record<string, unknown>).name as string, arguments: '' },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`;
        }
      }

      out += `data: ${JSON.stringify({
        id: responseId || `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: responseModel,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`;

      out += 'data: [DONE]\n\n';
      return out;
    },

    setId(id: string) { responseId = id; },
    setModel(model: string) { responseModel = model; },
  };
}

export function parseCodexSSEBuffer(buffer: string): CodexStreamEvent[] {
  const events: CodexStreamEvent[] = [];
  const lines = buffer.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('event:')) continue;
    if (trimmed.startsWith('data:')) {
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') continue;
      try {
        events.push(JSON.parse(jsonStr));
      } catch {
        // skip malformed JSON
      }
    }
  }

  return events;
}

export function parseCodexResponseBody(body: string): CodexResponse | null {
  try {
    const parsed = JSON.parse(body) as CodexResponse;
    if (parsed.object === 'response' && Array.isArray(parsed.output)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function createCodexRequest(modelId: string, req: ChatCompletionRequest): CodexRequest {
  return toCodexRequest(req);
}
