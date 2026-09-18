import crypto from 'crypto';
import { OAUTH_PROVIDERS, getClientId, getClientSecret } from '../../oauth-config.js';
import { getOAuthToken, setOAuthToken, clearOAuthToken } from '../../oauth-store.js';
import type { RequestContext } from '../types.js';
import { readBody, parseJsonBody } from '../request-context.js';
import { sendJSON, sendText } from '../responses.js';

const VALID_PROVIDERS = new Set(Object.keys(OAUTH_PROVIDERS));

function getOrigin(ctx: RequestContext): string {
  return `http://${ctx.config.host}:${ctx.config.port}`;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

interface PKCEState {
  codeVerifier: string;
  provider: string;
  redirectUri: string;
}

interface DeviceFlowState {
  provider: string;
  deviceAuthId: string;
  userCode: string;
  intervalSec: number;
}

const pkceStore = new Map<string, PKCEState>();
const deviceFlowStore = new Map<string, DeviceFlowState>();

setInterval(() => {
  pkceStore.clear();
  deviceFlowStore.clear();
}, 5 * 60 * 1000).unref();

export async function handleOAuthRoute(ctx: RequestContext): Promise<boolean> {
  const { pathname, req, res } = ctx;

  if (pathname === '/api/oauth/authorize' && req.method === 'POST') {
    return handleAuthorize(ctx);
  }

  if (pathname === '/api/oauth/poll-device' && req.method === 'POST') {
    return handlePollDevice(ctx);
  }

  if (pathname.startsWith('/api/oauth/callback/') && req.method === 'GET') {
    return handleCallback(ctx);
  }

  // Gemini OAuth uses root redirect (http://localhost:PORT/?code=...&state=...)
  // because Google for desktop apps only allows redirect URIs without paths
  if (pathname === '/' && req.method === 'GET') {
    const url = new URL(ctx.requestUrl, getOrigin(ctx));
    if (url.searchParams.has('code') || url.searchParams.has('error')) {
      // Determine provider by looking up the state in PKCE store
      const state = url.searchParams.get('state');
      let provider = '';
      if (state && pkceStore.has(state)) {
        provider = pkceStore.get(state)!.provider;
      }
      if (!provider) {
        provider = 'gemini'; // fallback — root redirects only used by Gemini
      }
      // Override pathname to trick handleCallback into extracting the right provider
      ctx.pathname = `/api/oauth/callback/${provider}`;
      return handleCallback(ctx);
    }
  }

  if (pathname === '/api/oauth/status' && req.method === 'GET') {
    return handleStatus(ctx);
  }

  if (pathname === '/api/oauth/logout' && req.method === 'POST') {
    return handleLogout(ctx);
  }

  return false;
}

async function handleAuthorize(ctx: RequestContext): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<{ provider?: unknown }>(raw, ctx.res);
  if (!parsed.ok) return true;

  const provider = String(parsed.value.provider || '').trim();
  if (!VALID_PROVIDERS.has(provider)) {
    sendJSON(ctx.res, 400, { error: { message: `Unknown provider: ${provider}. Valid: ${Array.from(VALID_PROVIDERS).join(', ')}`, type: 'invalid_request_error' } });
    return true;
  }

  const config = OAUTH_PROVIDERS[provider];
  const clientId = getClientId(provider);

  if (config.deviceFlow) {
    return handleDeviceAuthorize(ctx, config, clientId);
  }

  return handlePKCEAuthorize(ctx, config, clientId);
}

async function handleDeviceAuthorize(ctx: RequestContext, config: typeof OAUTH_PROVIDERS[string], clientId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${config.deviceAuthApiBase}/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    });

    if (resp.status === 404) {
      sendJSON(ctx.res, 400, { error: { message: 'Device code login is not enabled for this account. Enable it in ChatGPT security settings.', type: 'device_disabled' } });
      return true;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      sendJSON(ctx.res, resp.status, { error: { message: `Failed to request device code: ${resp.status} ${text.slice(0, 200)}`, type: 'device_error' } });
      return true;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const deviceAuthId = String(data.device_auth_id || '');
    const userCode = String(data.user_code || data.usercode || '');
    const intervalSec = Number(data.interval || 5);

    if (!deviceAuthId || !userCode) {
      sendJSON(ctx.res, 500, { error: { message: 'Device code response missing device_auth_id or user_code', type: 'device_error' } });
      return true;
    }

    const state = generateState();
    deviceFlowStore.set(state, { provider: config.provider, deviceAuthId, userCode, intervalSec });

    sendJSON(ctx.res, 200, {
      deviceFlow: true,
      state,
      userCode,
      verificationUri: config.verificationUri,
      provider: config.provider,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJSON(ctx.res, 500, { error: { message: `Device flow initiation failed: ${msg}`, type: 'device_error' } });
  }
  return true;
}

async function handlePollDevice(ctx: RequestContext): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<{ state?: unknown }>(raw, ctx.res);
  if (!parsed.ok) return true;

  const state = String(parsed.value.state || '').trim();
  if (!state || !deviceFlowStore.has(state)) {
    sendJSON(ctx.res, 400, { error: { message: 'Invalid or expired device flow state', type: 'invalid_request_error' } });
    return true;
  }

  const flowState = deviceFlowStore.get(state)!;
  const config = OAUTH_PROVIDERS[flowState.provider];
  const clientId = getClientId(flowState.provider);

  try {
    const resp = await fetch(`${config.deviceAuthApiBase}/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ device_auth_id: flowState.deviceAuthId, user_code: flowState.userCode }),
    });

    if (resp.status === 403 || resp.status === 404) {
      sendJSON(ctx.res, 200, { done: false });
      return true;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      deviceFlowStore.delete(state);
      sendJSON(ctx.res, resp.status, { error: { message: `Poll failed: ${resp.status} ${text.slice(0, 200)}`, type: 'poll_error' } });
      return true;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const authorizationCode = String(data.authorization_code || '');
    const codeVerifier = String(data.code_verifier || '');

    if (!authorizationCode || !codeVerifier) {
      deviceFlowStore.delete(state);
      sendJSON(ctx.res, 500, { error: { message: 'Authorization response missing code or verifier', type: 'exchange_error' } });
      return true;
    }

    // Exchange the code for tokens
    const tokenResp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: authorizationCode,
        code_verifier: codeVerifier,
        redirect_uri: `${config.deviceAuthApiBase}/deviceauth/callback`.replace('/api/accounts', ''),
      }).toString(),
    });

    deviceFlowStore.delete(state);

    if (!tokenResp.ok) {
      const text = await tokenResp.text().catch(() => '');
      sendJSON(ctx.res, tokenResp.status, { error: { message: `Token exchange failed: ${tokenResp.status} ${text.slice(0, 200)}`, type: 'exchange_error' } });
      return true;
    }

    const tokenData = (await tokenResp.json()) as Record<string, unknown>;

    await setOAuthToken(flowState.provider, {
      accessToken: String(tokenData.access_token || ''),
      refreshToken: String(tokenData.refresh_token || ''),
      expiresAt: Date.now() + (Number(tokenData.expires_in || 3600) * 1000),
      provider: flowState.provider,
    });

    sendJSON(ctx.res, 200, { done: true });
  } catch (err) {
    deviceFlowStore.delete(state);
    const msg = err instanceof Error ? err.message : String(err);
    sendJSON(ctx.res, 500, { error: { message: `Device flow poll failed: ${msg}`, type: 'poll_error' } });
  }
  return true;
}

async function handlePKCEAuthorize(ctx: RequestContext, config: typeof OAUTH_PROVIDERS[string], clientId: string): Promise<boolean> {
  const redirectUri = `${getOrigin(ctx)}${config.redirectPath}`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
  });

  if (config.scopes.length > 0) {
    params.set('scope', config.scopes.join(' '));
  }

  if (config.codeChallengeMethod === 'S256') {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    pkceStore.set(state, { codeVerifier, provider: config.provider, redirectUri });

    params.set('code_challenge_method', 'S256');
    params.set('code_challenge', codeChallenge);
    params.set('state', state);
  }

  // Add access_type=offline & prompt=consent for Google OAuth (Gemini)
  // This ensures we get a refresh_token even if the user already authorized
  if (config.provider === 'gemini') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  if (config.extraParams) {
    for (const [key, value] of Object.entries(config.extraParams)) {
      params.set(key, value);
    }
  }

  sendJSON(ctx.res, 200, {
    url: `${config.authorizeUrl}?${params.toString()}`,
    provider: config.provider,
    redirectUri,
  });
  return true;
}

async function handleCallback(ctx: RequestContext): Promise<boolean> {
  const provider = ctx.pathname.slice('/api/oauth/callback/'.length);
  if (!VALID_PROVIDERS.has(provider)) {
    sendText(ctx.res, 400, `Unknown provider: ${provider}`, 'text/plain');
    return true;
  }

  const url = new URL(ctx.requestUrl, getOrigin(ctx));
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    sendText(ctx.res, 400, `OAuth error: ${error}`, 'text/plain');
    return true;
  }

  if (!code) {
    sendText(ctx.res, 400, 'Missing authorization code', 'text/plain');
    return true;
  }

  const config = OAUTH_PROVIDERS[provider];
  const clientId = getClientId(provider);
  const redirectUri = `${getOrigin(ctx)}${config.redirectPath}`;

  let stored: PKCEState | undefined;
  if (state) {
    stored = pkceStore.get(state);
    pkceStore.delete(state);
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
    });

    if (stored?.codeVerifier) {
      body.set('code_verifier', stored.codeVerifier);
    }

    // Add client_secret for providers that need it (e.g. Gemini)
    const clientSecret = getClientSecret(provider);
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const resp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      sendText(ctx.res, resp.status, `Token exchange failed: HTTP ${resp.status} ${text.slice(0, 200)}`, 'text/plain');
      return true;
    }

    const data = (await resp.json()) as Record<string, unknown>;

    await setOAuthToken(provider, {
      accessToken: String(data.access_token || ''),
      refreshToken: String(data.refresh_token || ''),
      expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
      provider,
    });

    sendText(ctx.res, 200, 'OAuth setup complete! You can close this tab and return to AgentRail.', 'text/plain');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendText(ctx.res, 500, `Token exchange failed: ${msg}`, 'text/plain');
  }
  return true;
}

async function handleStatus(ctx: RequestContext): Promise<boolean> {
  const results: Record<string, { configured: boolean; tokenPreview?: string }> = {};

  for (const provider of VALID_PROVIDERS) {
    const token = await getOAuthToken(provider);
    results[provider] = {
      configured: !!token,
      tokenPreview: token ? `${token.accessToken.slice(0, 8)}...${token.accessToken.slice(-4)}` : undefined,
    };
  }

  sendJSON(ctx.res, 200, { providers: results });
  return true;
}

async function handleLogout(ctx: RequestContext): Promise<boolean> {
  const raw = await readBody(ctx.req);
  const parsed = parseJsonBody<{ provider?: unknown }>(raw, ctx.res);
  if (!parsed.ok) return true;

  const provider = String(parsed.value.provider || '').trim();
  if (!VALID_PROVIDERS.has(provider)) {
    sendJSON(ctx.res, 400, { error: { message: `Unknown provider: ${provider}`, type: 'invalid_request_error' } });
    return true;
  }

  await clearOAuthToken(provider);
  sendJSON(ctx.res, 200, { ok: true, provider });
  return true;
}
