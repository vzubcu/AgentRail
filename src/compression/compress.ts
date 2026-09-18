import type { ChatMessage, ChatMessageContent } from '../types.js';

export type CompressionMode = 'none' | 'drop_oldest' | 'truncate';

export interface CompressionConfig {
  mode: CompressionMode;
  /** For drop_oldest: keep at most this many non-system messages (most recent). */
  keepLastN: number;
  /** For truncate: max characters per text content part. */
  maxCharsPerPart: number;
  /** Always preserve system messages regardless of mode. */
  preserveSystem: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  mode: 'none',
  keepLastN: 10,
  maxCharsPerPart: 4000,
  preserveSystem: true,
};

function isTextPart(part: unknown): part is { type: 'text' | 'input_text'; text: string } {
  if (!part || typeof part !== 'object') return false;
  const p = part as Record<string, unknown>;
  return (p.type === 'text' || p.type === 'input_text') && typeof p.text === 'string';
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isTextPart(part) ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function truncateContent(content: unknown, maxChars: number): unknown {
  if (typeof content === 'string') {
    return content.length > maxChars ? `${content.slice(0, maxChars)}\n…[truncated]` : content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (isTextPart(part) && part.text.length > maxChars) {
        return { ...part, text: `${part.text.slice(0, maxChars)}\n…[truncated]` };
      }
      return part;
    });
  }
  return content;
}

function isSystemMessage(message: { role: string }): boolean {
  return message.role === 'system';
}

/**
 * Apply compression to a chat completion request's messages.
 * Returns a new request object; never mutates the input.
 * Fail-open: if config is invalid, returns the original request unchanged.
 */
export function applyCompression(
  request: { messages: ChatMessage[] },
  config: CompressionConfig,
): { messages: ChatMessage[] } {
  if (!config || config.mode === 'none') {
    return { messages: request.messages };
  }

  try {
    let messages = request.messages;

    if (config.mode === 'drop_oldest') {
      const systemMessages = config.preserveSystem
        ? messages.filter((m) => isSystemMessage(m))
        : [];
      const nonSystem = messages.filter((m) => !isSystemMessage(m));
      const kept = nonSystem.slice(-Math.max(0, config.keepLastN));
      messages = [...systemMessages, ...kept];
    }

    if (config.mode === 'truncate') {
      messages = messages.map((m) => ({
        ...m,
        content: truncateContent(m.content, config.maxCharsPerPart) as ChatMessageContent,
      }));
    }

    return { messages };
  } catch {
    return { messages: request.messages };
  }
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough heuristic: ~4 chars per token for English-mixed content.
  return Math.ceil(text.length / 4);
}

export function summarizeRequestSize(messages: ChatMessage[]): { chars: number; tokens: number } {
  const chars = messages.reduce((sum, m) => sum + extractText(m.content).length, 0);
  return { chars, tokens: estimateTokens(chars.toString()) };
}