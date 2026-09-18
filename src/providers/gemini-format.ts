import type { ChatCompletionRequest } from '../types.js';

interface GeminiContent {
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  tools?: GeminiTool[];
  safetySettings?: GeminiSafetySetting[];
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  safetyRatings?: Array<Record<string, unknown>>;
  tokenCount?: number;
}

interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsage;
  promptFeedback?: Record<string, unknown>;
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsage;
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

export function toGeminiRequest(req: ChatCompletionRequest): GeminiRequest {
  const contents: GeminiContent[] = [];
  let systemInstruction: GeminiContent | undefined;
  let systemText = '';

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => ('text' in p ? p.text : '')).join('')
          : '';
      systemText += (systemText ? '\n' : '') + text;
      continue;
    }

    if (msg.role === 'tool') {
      const m = msg as { tool_call_id?: string };
      const toolCallId = m.tool_call_id;
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const name = toolCallId ? `tool_${toolCallId.slice(0, 8)}` : 'unknown_tool';

      let lastUserMsg: GeminiContent | undefined;
      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role === 'user') { lastUserMsg = contents[i]; break; }
      }
      if (lastUserMsg) {
        lastUserMsg.parts.push({
          functionResponse: { name, response: { content: text } },
        });
      } else {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name, response: { content: text } } }],
        });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textContent = typeof msg.content === 'string' ? msg.content : '';
      const m = msg as { tool_calls?: Array<Record<string, unknown>> };
      const toolCalls = m.tool_calls;
      const parts: GeminiPart[] = [];

      if (textContent) {
        parts.push({ text: textContent });
      }

      if (toolCalls) {
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown> | undefined;
          parts.push({
            functionCall: {
              name: String(fn?.name || 'tool'),
              args: fn?.arguments ? (typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments) as Record<string, unknown> : {},
            },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
      continue;
    }

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else {
        const parts: GeminiPart[] = (Array.isArray(msg.content) ? msg.content : []).map((p) => {
          if (p.type === 'text' || p.type === 'input_text') {
            return { text: (p as { text: string }).text };
          }
          if (p.type === 'image_url') {
            const img = p as { image_url: string | { url: string } };
            const url = typeof img.image_url === 'string' ? img.image_url : img.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return { inlineData: { mimeType: match[1], data: match[2] } };
              }
            }
          }
          if (p.type === 'input_image') {
            const img = p as { image_url: string | { url: string } };
            const url = typeof img.image_url === 'string' ? img.image_url : img.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return { inlineData: { mimeType: match[1], data: match[2] } };
              }
            }
          }
          return { text: '' };
        });
        contents.push({ role: 'user', parts });
      }
    }
  }

  if (systemText) {
    systemInstruction = { parts: [{ text: systemText }] };
  }

  const geminiReq: GeminiRequest = {
    contents,
    generationConfig: {},
  };

  if (systemInstruction) {
    geminiReq.systemInstruction = systemInstruction;
  }

  if (req.temperature !== undefined) {
    geminiReq.generationConfig!.temperature = req.temperature;
  }
  if (req.top_p !== undefined) {
    geminiReq.generationConfig!.topP = req.top_p;
  }
  if (req.max_tokens !== undefined) {
    geminiReq.generationConfig!.maxOutputTokens = req.max_tokens;
  }

  if (req.tools && Array.isArray(req.tools)) {
    geminiReq.tools = req.tools.map((tool) => {
      const fn = tool.function;
      return {
        functionDeclarations: [{
          name: String(fn?.name || ''),
          description: fn?.description,
          parameters: fn?.parameters,
        }],
      };
    });
  }

  return geminiReq;
}

export function fromGeminiResponse(geminiResp: GeminiResponse, model: string): ChatCompletionResponse {
  const candidate = geminiResp.candidates?.[0];
  const content = candidate?.content;
  const text = content?.parts?.filter((p) => p.text).map((p) => p.text).join('') || '';

  const functionCalls = content?.parts?.filter((p) => p.functionCall) || [];
  const toolCalls = functionCalls.map((fc, i) => ({
    id: `call_${Date.now()}_${i}`,
    type: 'function' as const,
    function: {
      name: fc.functionCall!.name,
      arguments: JSON.stringify(fc.functionCall!.args),
    },
  }));

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: text || null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  const finishReason = candidate?.finishReason === 'STOP'
    ? 'stop'
    : candidate?.finishReason === 'MAX_TOKENS'
      ? 'length'
      : toolCalls.length > 0
        ? 'tool_calls'
        : candidate?.finishReason || 'stop';

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: message as ChatCompletionResponse['choices'][0]['message'],
      finish_reason: finishReason as string | null,
    }],
    usage: geminiResp.usageMetadata ? {
      prompt_tokens: geminiResp.usageMetadata.promptTokenCount || 0,
      completion_tokens: geminiResp.usageMetadata.candidatesTokenCount || 0,
      total_tokens: geminiResp.usageMetadata.totalTokenCount || 0,
    } : undefined,
  };
}

export function createGeminiToOpenAIStreamTransformer() {
  let accumulatedText = '';

  return {
    transform(chunk: GeminiStreamChunk): string {
      let out = '';
      const candidate = chunk.candidates?.[0];
      const content = candidate?.content;
      const parts = content?.parts || [];
      const textParts = parts.filter((p) => p.text);
      const fcParts = parts.filter((p) => p.functionCall);

      for (const part of textParts) {
        const text = part.text || '';
        accumulatedText += text;
        out += `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: '',
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        })}\n\n`;
      }

      for (let i = 0; i < fcParts.length; i++) {
        const fc = fcParts[i].functionCall!;
        out += `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: '',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: i,
                id: `call_${Date.now()}_${i}`,
                function: { name: fc.name, arguments: JSON.stringify(fc.args) },
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
      const finishReason = accumulatedText ? 'stop' : 'stop';
      out += `data: ${JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: '',
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      })}\n\n`;
      out += 'data: [DONE]\n\n';
      return out;
    },
  };
}

export function parseGeminiSSELine(line: string): GeminiStreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return null;
  const jsonStr = trimmed.slice(6).trim();
  if (!jsonStr || jsonStr === '[DONE]') return null;
  try {
    return JSON.parse(jsonStr) as GeminiStreamChunk;
  } catch {
    return null;
  }
}

export function parseGeminiResponseBody(body: string): GeminiResponse | null {
  try {
    const parsed = JSON.parse(body) as GeminiResponse;
    if (Array.isArray(parsed.candidates)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
