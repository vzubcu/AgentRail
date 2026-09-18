import {
  addRuntimeApiKey,
  buildCloudflareCredentialValue,
  buildApiKeySummary,
  getEffectiveApiKeyFingerprints,
  getConfigMeta,
  persistRuntimeApiKeys,
  removeRuntimeApiKeyByFingerprint,
  setAgentRailApiKey,
  setRuntimeApiKey,
} from '../../config.js';
import { checkProviderHealth } from '../../health.js';
import type { RequestContext } from '../types.js';
import { readBody, parseJsonBody } from '../request-context.js';
import { sendJSON } from '../responses.js';
import { refreshProvidersForEnvVars } from '../provider-sync.js';
import { providers } from '../../providers/index.js';

async function runHealthChecksForEnvVars(envVars: string[]) {
  const providerNames = [...new Set(
    envVars.flatMap((envVar) => providers
      .filter((provider) => provider.envVars.includes(envVar))
      .map((provider) => provider.name)),
  )];

  const results = [];
  for (const providerName of providerNames) {
    results.push(await checkProviderHealth(providerName));
  }
  return results;
}

export async function handleConfigKeysRoute(ctx: RequestContext): Promise<boolean> {
  if (ctx.pathname === '/api/config/keys/summary' && ctx.req.method === 'GET') {
    const summaries = Object.fromEntries(
      [...ctx.config.allowedEnvVars].map((envVar) => [envVar, buildApiKeySummary(envVar)]),
    );
    sendJSON(ctx.res, 200, { keys: summaries });
    return true;
  }

  if (ctx.pathname.startsWith('/api/config/keys/') && ctx.req.method === 'POST') {
    const envVar = decodeURIComponent(ctx.pathname.slice('/api/config/keys/'.length));
    if (!ctx.config.allowedEnvVars.has(envVar)) {
      sendJSON(ctx.res, 404, { error: { message: `Unknown provider key: ${envVar}`, type: 'invalid_request_error' } });
      return true;
    }

    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ key?: unknown; accountId?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    if (typeof parsedBody.value.key !== 'string' || !parsedBody.value.key.trim()) {
      sendJSON(ctx.res, 400, { error: { message: 'Missing API key', type: 'invalid_request_error' } });
      return true;
    }

    const accountId = typeof parsedBody.value.accountId === 'string' ? parsedBody.value.accountId.trim() : '';
    const keyValue = envVar === 'CLOUDFLARE_API_KEY' && accountId
      ? buildCloudflareCredentialValue(parsedBody.value.key, accountId)
      : parsedBody.value.key;

    addRuntimeApiKey(envVar, keyValue);
    await persistRuntimeApiKeys(ctx.config.allowedEnvVars);
    const syncResult = await refreshProvidersForEnvVars([envVar]);
    const healthChecks = await runHealthChecksForEnvVars([envVar]);
    const meta = getConfigMeta();
    sendJSON(ctx.res, 200, {
      ok: true,
      envVar,
      summary: buildApiKeySummary(envVar),
      persisted: true,
      persistedPath: meta.persistedPath,
      persistedUpdatedAt: meta.persistedUpdatedAt,
      sync: syncResult,
      fingerprints: getEffectiveApiKeyFingerprints(envVar),
      healthChecks,
    });
    return true;
  }

  if (ctx.pathname.startsWith('/api/config/keys/') && ctx.req.method === 'DELETE') {
    const parts = ctx.pathname.slice('/api/config/keys/'.length).split('/');
    const envVar = decodeURIComponent(parts[0] ?? '');
    const fingerprint = decodeURIComponent(parts[1] ?? '');

    if (!ctx.config.allowedEnvVars.has(envVar)) {
      sendJSON(ctx.res, 404, { error: { message: 'Unknown provider key', type: 'invalid_request_error' } });
      return true;
    }

    if (!fingerprint) {
      setRuntimeApiKey(envVar, '');
      await persistRuntimeApiKeys(ctx.config.allowedEnvVars);
      const meta = getConfigMeta();
      sendJSON(ctx.res, 200, {
        ok: true,
        envVar,
        summary: buildApiKeySummary(envVar),
        persisted: true,
        persistedPath: meta.persistedPath,
        persistedUpdatedAt: meta.persistedUpdatedAt,
      });
      return true;
    }

    const removed = removeRuntimeApiKeyByFingerprint(envVar, fingerprint);
    if (!removed) {
      sendJSON(ctx.res, 404, { error: { message: 'API key was not found', type: 'invalid_request_error' } });
      return true;
    }

    await persistRuntimeApiKeys(ctx.config.allowedEnvVars);
    const meta = getConfigMeta();
    sendJSON(ctx.res, 200, {
      ok: true,
      envVar,
      summary: buildApiKeySummary(envVar),
      persisted: true,
      persistedPath: meta.persistedPath,
      persistedUpdatedAt: meta.persistedUpdatedAt,
    });
    return true;
  }

  if (ctx.pathname === '/api/config/keys' && ctx.req.method === 'POST') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ keys?: Record<string, unknown>; gatewayKey?: string }>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    const payload = parsedBody.value;
    const keys = payload.keys ?? {};
    const updated: string[] = [];
    const ignored: string[] = [];

    for (const [envVar, value] of Object.entries(keys)) {
      if (!ctx.config.allowedEnvVars.has(envVar)) {
        ignored.push(envVar);
        continue;
      }
      setRuntimeApiKey(envVar, value);
      updated.push(envVar);
    }

    if (payload.gatewayKey !== undefined) {
      await setAgentRailApiKey(payload.gatewayKey);
      if (payload.gatewayKey) updated.push('AGENTRAIL_API_KEY');
    }

    await persistRuntimeApiKeys(ctx.config.allowedEnvVars);
    const syncResult = await refreshProvidersForEnvVars(updated.filter((envVar) => envVar !== 'AGENTRAIL_API_KEY'));
    const healthChecks = await runHealthChecksForEnvVars(updated.filter((envVar) => envVar !== 'AGENTRAIL_API_KEY'));
    const meta = getConfigMeta();
    sendJSON(ctx.res, 200, {
      ok: true,
      updated,
      ignored,
      persisted: true,
      persistedPath: meta.persistedPath,
      persistedUpdatedAt: meta.persistedUpdatedAt,
      sync: syncResult,
      healthChecks,
    });
    return true;
  }

  return false;
}
