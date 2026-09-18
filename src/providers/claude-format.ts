import type { ChatCompletionRequest } from '../types.js';

interface Block { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; }

function extractContentText(content: string | Block[]): string {
  if (typeof content === 'string') return content;
  return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

function findToolCallBlocks(content: string | Block[]): Block[] {
  if (typeof content === 'string') return [];
  return content.filter((b) => b.type === 'tool_use');
}

export interface AnthropicRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  system?: string;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Block[];
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamChunk {
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
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function toAnthropicRequest(req: ChatCompletionRequest): AnthropicRequest {
  const anthropicReq: AnthropicRequest = {
    model: req.model,
    messages: [],
    max_tokens: req.max_tokens || 8192,
    stream: req.stream,
  };

  if (req.temperature !== undefined) anthropicReq.temperature = req.temperature;
  if (req.top_p !== undefined) anthropicReq.top_p = req.top_p;

  let systemContent = '';

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => ('text' in p ? p.text : '')).join('')
          : '';
      if (systemContent) systemContent += '\n' + text;
      else systemContent = text;
      continue;
    }

    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
      const m = msg as { tool_call_id?: string };
      anthropicReq.messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id || `toolu_${Date.now()}`,
          content,
        }],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const textContent = typeof msg.content === 'string' ? msg.content : '';
      const m = msg as { tool_calls?: Array<Record<string, unknown>> };
      const toolCalls = m.tool_calls;

      const content: Record<string, unknown>[] = [];
      if (textContent) {
        content.push({ type: 'text', text: textContent });
      }
      if (toolCalls) {
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown> | undefined;
          content.push({
            type: 'tool_use',
            id: String(tc.id || `toolu_${Date.now()}`),
            name: String(fn?.name || 'tool'),
            input: fn?.arguments ? JSON.parse(String(fn.arguments)) : {},
          });
        }
      }

      anthropicReq.messages.push({
        role: 'assistant',
        content: content.length > 0 ? content : textContent,
      });
      continue;
    }

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        anthropicReq.messages.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks: Record<string, unknown>[] = [];
        for (const part of (Array.isArray(msg.content) ? msg.content : [])) {
          if (part.type === 'text' || part.type === 'input_text') {
            blocks.push({ type: 'text', text: 'text' in part ? (part as { text: string }).text : '' });
          } else if (part.type === 'image_url' || part.type === 'input_image') {
            const imageUrl = 'image_url' in part
              ? (part as { image_url: string | { url: string } }).image_url
              : (part as { image_url: string | { url: string } }).image_url;
            const url = typeof imageUrl === 'string' ? imageUrl : imageUrl.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                blocks.push({
                  type: 'image',
                  source: { type: 'base64', media_type: match[1], data: match[2] },
                });
              }
            }
          }
        }
        anthropicReq.messages.push({ role: 'user', content: blocks });
      }
    }
  }

  if (systemContent) {
    anthropicReq.system = systemContent;
  }

  if (req.tools && Array.isArray(req.tools)) {
    anthropicReq.tools = req.tools.map((tool) => {
      const fn = tool.function;
      return {
        name: fn?.name || '',
        description: fn?.description || '',
        input_schema: fn?.parameters || { type: 'object', properties: {} },
      };
    });
  }

  if (req.tool_choice) {
    const choice = req.tool_choice;
    if (choice === 'auto') {
      anthropicReq.tool_choice = { type: 'auto' };
    } else if (choice === 'required' || choice === 'any') {
      anthropicReq.tool_choice = { type: 'any' };
    } else if (typeof choice === 'object' && (choice as Record<string, unknown>).type === 'function') {
      const fn = (choice as Record<string, unknown>).function as Record<string, unknown> | undefined;
      anthropicReq.tool_choice = { type: 'tool', name: fn?.name || '' };
    }
  }

  return anthropicReq;
}

export function fromAnthropicResponseToChat(anthropicResp: AnthropicResponse): ChatCompletionResponse {
  const contentText = extractContentText(anthropicResp.content);
  const toolCalls = findToolCallBlocks(anthropicResp.content);

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: contentText || null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.input),
      },
    }));
  }

  const finishReason = toolCalls.length > 0
    ? 'tool_calls'
    : anthropicResp.stop_reason === 'end_turn'
      ? 'stop'
      : anthropicResp.stop_reason === 'max_tokens'
        ? 'length'
        : anthropicResp.stop_reason || 'stop';

  return {
    id: anthropicResp.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicResp.model,
    choices: [{
      index: 0,
      message: message as ChatCompletionResponse['choices'][0]['message'],
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: anthropicResp.usage?.input_tokens || 0,
      completion_tokens: anthropicResp.usage?.output_tokens || 0,
      total_tokens: (anthropicResp.usage?.input_tokens || 0) + (anthropicResp.usage?.output_tokens || 0),
    },
  };
}

export function createClaudeToOpenAIStreamTransformer() {
  const contentBlocks: Record<number, { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = {};
  let pendingText = '';
  let hasStarted = false;

  return {
    transform(chunk: AnthropicStreamChunk): string {
      let out = '';

      if (chunk.type === 'message_start') {
        const msg = chunk.message as Record<string, unknown> | undefined;
        hasStarted = true;
        out += `data: ${JSON.stringify({
          id: msg?.id || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: msg?.model || '',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        })}\n\n`;
      }

      if (chunk.type === 'content_block_start') {
        const block = chunk.content_block as Record<string, unknown> | undefined;
        const index = Number(chunk.index ?? 0);
        contentBlocks[index] = { type: String(block?.type || '') };

        if (block?.type === 'tool_use') {
          contentBlocks[index].id = String(block.id || '');
          contentBlocks[index].name = String(block.name || '');
          contentBlocks[index].input = {};
        }
      }

      if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta as Record<string, unknown> | undefined;
        const index = Number(chunk.index ?? 0);

        if (delta?.type === 'text_delta') {
          const text = String(delta.text || '');
          contentBlocks[index] = contentBlocks[index] || { type: 'text' };
          pendingText += text;
          out += `data: ${JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: '',
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          })}\n\n`;
        }

        if (delta?.type === 'input_json_delta') {
          const partialJson = String(delta.partial_json || '');
          const block = contentBlocks[index];
          if (block) {
            block.input = block.input || {};
            const accumulatedJson = String((block as Record<string, unknown>)._partialJson || '') + partialJson;
            (block as Record<string, unknown>)._partialJson = accumulatedJson;
            out += `data: ${JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: '',
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index,
                    id: block.id || `toolu_${Date.now()}`,
                    function: { name: block.name || 'tool', arguments: accumulatedJson },
                  }],
                },
                finish_reason: null,
              }],
            })}\n\n`;
          }
        }
      }

      if (chunk.type === 'message_delta') {
        const delta = chunk.delta as Record<string, unknown> | undefined;
        const stopReason = delta?.stop_reason === 'end_turn'
          ? 'stop'
          : delta?.stop_reason === 'max_tokens'
            ? 'length'
            : 'tool_calls';

        out += `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: '',
          choices: [{ index: 0, delta: {}, finish_reason: stopReason }],
        })}\n\n`;
      }

      if (chunk.type === 'message_stop') {
        out += 'data: [DONE]\n\n';
      }

      if (chunk.type === 'ping') {
        out += 'data: {"type":"ping"}\n\n';
      }

      return out;
    },

    end(): string {
      if (!hasStarted) {
        return `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: '',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\ndata: [DONE]\n\n`;
      }
      return '';
    },
  };
}

export function parseAnthropicSSELine(line: string): AnthropicStreamChunk | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return JSON.parse(line.slice(6)) as AnthropicStreamChunk;
  } catch {
    return null;
  }
}

export function parseAnthropicResponseBody(body: string): AnthropicResponse | null {
  try {
    const parsed = JSON.parse(body) as AnthropicResponse;
    if (parsed.type === 'message' && Array.isArray(parsed.content)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
