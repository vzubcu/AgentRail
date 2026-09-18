import type { RequestContext } from '../types.js';
import { sendJSON, sendNoContent } from '../responses.js';
import { parseJsonBody, readBody } from '../request-context.js';
import {
  createSystemPrompt,
  deleteSystemPrompt,
  getAllSystemPrompts,
  updateSystemPrompt,
} from '../../system-prompts.js';

const ID_REGEX = /^[a-zA-Z0-9\/\-_]+$/;

interface SystemPromptInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  content?: unknown;
}

function validateSystemPromptInput(
  body: SystemPromptInput,
  requireId: boolean,
): { ok: true; value: { id?: string; name: string; description: string | null; content: string } } | { ok: false; message: string } {
  if (requireId) {
    if (typeof body.id !== 'string' || !ID_REGEX.test(body.id)) {
      return { ok: false, message: 'id must be a non-empty string matching /^[a-zA-Z0-9\\/\\-_]+$/' };
    }
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return { ok: false, message: 'name is required and must be a non-empty string' };
  }

  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    return { ok: false, message: 'content is required and must be a non-empty string' };
  }

  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return { ok: false, message: 'description must be a string or null when provided' };
  }

  return {
    ok: true,
    value: {
      id: typeof body.id === 'string' ? body.id : undefined,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : null,
      content: body.content,
    },
  };
}

export async function handleSystemPromptsRoute(ctx: RequestContext): Promise<boolean> {
  if (ctx.pathname === '/api/system-prompts' && ctx.req.method === 'GET') {
    const prompts = await getAllSystemPrompts();
    sendJSON(ctx.res, 200, prompts);
    return true;
  }

  if (ctx.pathname === '/api/system-prompts' && ctx.req.method === 'POST') {
    const raw = await readBody(ctx.req);
    const parsed = parseJsonBody<SystemPromptInput>(raw, ctx.res);
    if (!parsed.ok) return true;

    const validation = validateSystemPromptInput(parsed.value, true);
    if (!validation.ok) {
      sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
      return true;
    }

    try {
      const record = await createSystemPrompt({
        id: validation.value.id as string,
        name: validation.value.name,
        description: validation.value.description,
        content: validation.value.content,
      });
      sendJSON(ctx.res, 201, record);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create system prompt';
      sendJSON(ctx.res, message.includes('already exists') ? 409 : 500, { error: { message, type: 'invalid_request_error' } });
    }
    return true;
  }

  const detailMatch = ctx.pathname.match(/^\/api\/system-prompts\/(.+)$/);
  if (!detailMatch) {
    return false;
  }

  const id = decodeURIComponent(detailMatch[1]);
  if (ctx.req.method === 'PUT') {
    const raw = await readBody(ctx.req);
    const parsed = parseJsonBody<SystemPromptInput>(raw, ctx.res);
    if (!parsed.ok) return true;

    const validation = validateSystemPromptInput(parsed.value, false);
    if (!validation.ok) {
      sendJSON(ctx.res, 400, { error: { message: validation.message, type: 'invalid_request_error' } });
      return true;
    }

    const record = await updateSystemPrompt(id, validation.value);
    if (!record) {
      sendJSON(ctx.res, 404, { error: { message: `System prompt "${id}" not found`, type: 'invalid_request_error' } });
      return true;
    }
    sendJSON(ctx.res, 200, record);
    return true;
  }

  if (ctx.req.method === 'DELETE') {
    const deleted = await deleteSystemPrompt(id);
    if (!deleted) {
      sendJSON(ctx.res, 404, { error: { message: `System prompt "${id}" not found`, type: 'invalid_request_error' } });
      return true;
    }
    sendNoContent(ctx.res, 'DELETE');
    return true;
  }

  return false;
}