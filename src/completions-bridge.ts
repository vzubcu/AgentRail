import type { ChatCompletionRequest, ChatMessageContent } from './types.js';
import { contentToText } from './attachments.js';
import { ensureUsage, type NormalizedUsage } from './usage.js';

export class CompletionsCompatibilityError extends Error {
  readonly status = 400;
  readonly type = 'invalid_request_error';

  constructor(message: string) {
    super(message);
    this.name = 'CompletionsCompatibilityError';
  }
}

export interface CompletionsRequest {
  model?: string;
  prompt?: unknown;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: unknown;
  user?: unknown;
  [key: string]: unknown;
}

export interface CompletionsBridgeResult {
  request: ChatCompletionRequest;
  promptText: string;
}

function promptToText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt;
  if (typeof prompt === 'number') return String(prompt);
  if (Array.isArray(prompt)) {
    return prompt.map((value) => {
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
      }
      throw new CompletionsCompatibilityError('Legacy prompt arrays must contain only strings or numbers.');
    }).join('\n');
  }
  throw new CompletionsCompatibilityError('Legacy completions prompt must be a string, number, or array of strings.');
}

export function fromCompletionsRequest(req: CompletionsRequest): CompletionsBridgeResult {
  if (!req.model) {
    throw new CompletionsCompatibilityError('Missing "model" field');
  }
  if (req.prompt === undefined || req.prompt === null) {
    throw new CompletionsCompatibilityError('Missing "prompt" field');
  }

  const promptText = promptToText(req.prompt);
  const request: ChatCompletionRequest = {
    model: req.model,
    messages: [{ role: 'user', content: promptText }],
    stream: req.stream,
    temperature: req.temperature,
    top_p: req.top_p,
    max_tokens: req.max_tokens,
    ...(typeof req.system_prompt === 'string' ? { system_prompt: req.system_prompt } : {}),
  };

  if (req.stop !== undefined) request.stop = req.stop;
  if (req.user !== undefined) request.user = req.user;

  return { request, promptText };
}

function responseUsage(usage: NormalizedUsage) {
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

export function toCompletionsResponse(
  openAIResponse: Record<string, unknown>,
  modelId: string,
  promptText: string,
): Record<string, unknown> {
  const choices = (openAIResponse.choices as Array<Record<string, unknown>> | undefined) ?? [];
  const firstChoice = choices[0] ?? {};
  const message = (firstChoice.message as Record<string, unknown> | undefined) ?? {};
  const completionText = contentToText(message.content as ChatMessageContent);
  const usage = ensureUsage(openAIResponse.usage, { promptText, completionText });

  return {
    id: String(openAIResponse.id ?? `cmpl_${Date.now()}`),
    object: 'text_completion',
    created: Number(openAIResponse.created ?? Math.floor(Date.now() / 1000)),
    model: modelId,
    choices: [
      {
        text: completionText,
        index: 0,
        logprobs: null,
        finish_reason: firstChoice.finish_reason ?? 'stop',
      },
    ],
    usage: responseUsage(usage),
  };
}
