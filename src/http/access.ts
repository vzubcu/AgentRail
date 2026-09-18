import type { RequestContext } from './types.js';
import { getHeader, authHeaderMode, isAllowedLocalOrigin } from './request-context.js';
import { sendJSON } from './responses.js';
import { hasAgentRailApiKey, isAgentRailApiKey } from '../config.js';
import { validateApiKey } from '../saas/auth.js';

export function getRequiredCapabilityForPath(pathname: string): string | undefined {
  if (pathname === '/v1/chat/completions' || pathname === '/v1/completions' || (pathname === '/v1/responses' || pathname.startsWith('/v1/responses/')) || pathname === '/v1/messages' || pathname === '/v1/messages/count_tokens') {
    return 'chat';
  }
  if (pathname === '/v1/embeddings') return 'embeddings';
  if (pathname === '/v1/images/generations') return 'image_generation';
  if (pathname === '/v1/images/edits') return 'image_edit';
  if (pathname === '/v1/audio/transcriptions') return 'audio_transcription';
  if (pathname === '/v1/audio/translations') return 'audio_translation';
  if (pathname === '/v1/audio/speech') return 'audio_generation';
  if (pathname === '/v1/videos/generations') return 'video_generation';
  if (pathname === '/v1/music/generations') return 'music_generation';
  if (pathname === '/v1/search') return 'search';
  if (pathname === '/v1/rerank') return 'rerank';
  if (pathname === '/v1/moderations') return 'moderation';
  return undefined;
}

export function isManagementRequest(pathname: string, method: string | undefined): boolean {
  if (pathname === '/api/config/keys' && method === 'POST') return true;
  if (pathname === '/api/config/keys/summary' && method === 'GET') return true;
  if (pathname.startsWith('/api/config/keys/') && (method === 'POST' || method === 'DELETE')) return true;
  if (pathname === '/api/models/refresh' && method === 'POST') return true;
  if (pathname.startsWith('/api/models/refresh/') && method === 'POST') return true;
  if (pathname === '/api/health/check-all/status' && method === 'GET') return true;
  if (pathname === '/api/health/check-all' && method === 'POST') return true;
  if (pathname.startsWith('/api/health/check/') && method === 'POST') return true;
  if (pathname === '/api/usage' && (method === 'GET' || method === 'DELETE')) return true;
  if (pathname === '/api/agents/configure' && method === 'POST') return true;
  if (pathname === '/api/agents/launch' && method === 'POST') return true;
  if (pathname === '/api/system-prompts' && method === 'POST') return true;
  if (pathname.startsWith('/api/system-prompts/') && (method === 'PUT' || method === 'DELETE')) return true;
  if (pathname === '/api/virtual-models' && method === 'POST') return true;
  if (pathname.startsWith('/api/virtual-models/') && (method === 'PUT' || method === 'DELETE')) return true;
  return false;
}

export async function getAuthenticatedAdminSession(ctx: RequestContext): Promise<{ id: string; isAdmin: boolean } | undefined> {
  const cookie = ctx.req.headers.cookie ?? '';
  const sessionMatch = cookie.match(/fw_session=([^;]+)/);
  if (!sessionMatch) return undefined;

  const { authenticateSession } = await import('../saas/auth.js');
  const user = await authenticateSession(sessionMatch[1]);
  if (!user?.isAdmin) return undefined;

  return { id: user.id, isAdmin: user.isAdmin };
}

export async function checkGatewayAuth(ctx: RequestContext): Promise<boolean> {
  const bearer = (ctx.req.headers.authorization ?? '').match(/^Bearer\s+(.+)$/)?.[1] ?? '';
  const apiKeyHeader = typeof ctx.req.headers['x-api-key'] === 'string' ? ctx.req.headers['x-api-key'] : '';
  const apiKey = bearer || apiKeyHeader;
  ctx.trace('auth.entry', {
    requestId: ctx.requestId,
    hasBearer: !!bearer,
    hasApiKeyHeader: !!apiKeyHeader,
    keyKind: apiKey.startsWith('fw_') ? 'saas' : apiKey ? 'gateway_or_provider' : 'none',
    keyLen: apiKey.length,
    saasMode: ctx.config.saasMode,
  });

  if (ctx.config.saasMode) {
    const adminSession = await getAuthenticatedAdminSession(ctx);
    if (adminSession) {
      (ctx.req as unknown as Record<string, unknown>).saasUser = adminSession;
      ctx.trace('auth.saas_admin_session', { userId: adminSession.id });
      return true;
    }
  }

  if (apiKey.startsWith('fw_') && ctx.config.saasMode) {
    const result = await validateApiKey(apiKey, {
      requiredCapability: getRequiredCapabilityForPath(ctx.pathname),
    });
    if (!result.ok) {
      ctx.trace('auth.saas_key_failed', {
        requestId: ctx.requestId,
        reason: result.error,
        status: result.status,
        path: ctx.pathname,
        requiredCapability: getRequiredCapabilityForPath(ctx.pathname) ?? null,
      });
      sendJSON(ctx.res, result.status, {
        error: {
          message: result.error,
          type: 'authentication_error',
          param: null,
          code: 'invalid_api_key',
        },
      });
      return false;
    }
    (ctx.req as unknown as Record<string, unknown>).saasUser = result.user;
    (ctx.req as unknown as Record<string, unknown>).saasApiKey = result.apiKey;
    ctx.trace('auth.saas_key', {
      requestId: ctx.requestId,
      userId: result.user.id,
      keyId: result.apiKey.id,
      scopes: result.apiKey.scopes ?? [],
    });
    return true;
  }

  if (ctx.config.saasMode && !apiKey.startsWith('fw_')) {
    if (await hasAgentRailApiKey()) {
      const ok = await isAgentRailApiKey(apiKey);
      ctx.trace('auth.saas_fallback', { requestId: ctx.requestId, hasGatewayKey: true, gatewayMatch: ok });
      if (!ok) {
        sendJSON(ctx.res, 401, { error: { message: 'Incorrect API key', type: 'authentication_error', param: null, code: 'invalid_api_key' } });
        return false;
      }
      return true;
    }
    ctx.trace('auth.saas_fallback', { requestId: ctx.requestId, hasGatewayKey: false });
    sendJSON(ctx.res, 401, { error: { message: 'SaaS API key required (fw_...)', type: 'authentication_error', param: null, code: 'invalid_api_key' } });
    return false;
  }

  if (!(await hasAgentRailApiKey())) {
    ctx.trace('auth.skip', { requestId: ctx.requestId, reason: 'gateway_key_not_set' });
    return true;
  }

  const ok = await isAgentRailApiKey(apiKey);
  ctx.trace('auth.check', {
    requestId: ctx.requestId,
    mode: authHeaderMode(ctx.req),
    hasAuthHeader: !!ctx.req.headers.authorization,
    ok,
  });

  if (!ok) {
    sendJSON(ctx.res, 401, {
      error: {
        message: 'Incorrect API key provided. You can find your API key at http://localhost:42424.',
        type: 'authentication_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
    return false;
  }
  return true;
}

export async function checkCatalogAccess(ctx: RequestContext): Promise<boolean> {
  if (!ctx.config.saasMode) {
    return checkGatewayAuth(ctx);
  }

  const adminSession = await getAuthenticatedAdminSession(ctx);
  if (adminSession) {
    (ctx.req as unknown as Record<string, unknown>).saasUser = adminSession;
    return true;
  }

  return checkGatewayAuth(ctx);
}

export async function checkManagementAccess(ctx: RequestContext): Promise<boolean> {
  const origin = getHeader(ctx.req, 'origin');
  if (origin && !isAllowedLocalOrigin(ctx.req)) {
    sendJSON(ctx.res, 403, {
      error: {
        message: 'Management APIs only accept same-machine browser origins.',
        type: 'forbidden',
      },
    });
    return false;
  }

  if (ctx.config.saasMode) {
    const adminSession = await getAuthenticatedAdminSession(ctx);
    if (!adminSession) {
      sendJSON(ctx.res, 401, { error: { message: 'Not authenticated', type: 'authentication_error', param: null, code: 'invalid_api_key' } });
      return false;
    }
    (ctx.req as unknown as Record<string, unknown>).saasUser = adminSession;
    return true;
  }

  return checkGatewayAuth(ctx);
}
