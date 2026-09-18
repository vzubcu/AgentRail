import { AUTO_MODEL_ID, FILES_MODEL_ID } from '../../router.js';
import { getActiveCanonicalModelsForApi, buildCatalogSummary } from '../../catalog.js';
import { usageTracker } from '../../usage-tracker.js';
import {
  checkAllProvidersHealth,
  getAllProvidersHealthCheckJob,
  checkProviderHealth,
  getAllProviderHealth,
  persistProviderHealthSnapshot,
  startAllProvidersHealthCheck,
} from '../../health.js';
import { configureClaudeAgentProfiles, configureCodexAgentProfiles, configureContinueAgent, configureClineAgent, configureRooAgent, configureKiloAgent } from '../../agent-config.js';
import { launchAgentTool, type AgentLaunchTarget } from '../../agent-launch.js';
import { loadCompressionConfig, saveCompressionConfig } from '../../compression/config.js';
import { loadSettingsConfig, saveSettingsConfig } from '../../settings/config.js';
import { listSkills } from '../../skills/catalog.js';
import { addMemory, searchMemory, listMemory, deleteMemory } from '../../memory/store.js';
import { getQuotaConfig, setQuotaConfig, computeHeadroom, type QuotaConfig } from '../../quota/engine.js';
import type { RequestContext } from '../types.js';
import { readBody, parseJsonBody } from '../request-context.js';
import { sendJSON } from '../responses.js';

function getQuickConnectModels(requestedModelIds: string[] | undefined): { id: string }[] {
  const activeModels = getActiveCanonicalModelsForApi()
    .filter((model) => model.id !== FILES_MODEL_ID)
    .map((model) => ({ id: model.id }));
  const available = activeModels.length > 0 ? [{ id: AUTO_MODEL_ID }, ...activeModels] : activeModels;
  if (!requestedModelIds?.length) return available;
  const allowed = new Set(available.map((model) => model.id));
  const selected = requestedModelIds
    .map((value) => String(value || '').trim())
    .filter((value, index, list) => value && allowed.has(value) && list.indexOf(value) === index)
    .map((id) => ({ id }));
  return selected.length > 0 ? selected : available;
}

function getPrimaryModelId(models: { id: string }[]): string | undefined {
  return models.find((model) => model.id === AUTO_MODEL_ID)?.id ?? models[0]?.id;
}

export async function handleManagementRoute(ctx: RequestContext): Promise<boolean> {
  if (ctx.pathname === '/api/catalog' && ctx.req.method === 'GET') {
    sendJSON(ctx.res, 200, buildCatalogSummary());
    return true;
  }

  if (ctx.pathname === '/api/health/check-all/status' && ctx.req.method === 'GET') {
    sendJSON(ctx.res, 200, {
      job: getAllProvidersHealthCheckJob(),
      health: getAllProviderHealth(),
    });
    return true;
  }

  if (ctx.pathname === '/api/health/check-all' && ctx.req.method === 'POST') {
    const requestUrl = new URL(ctx.requestUrl, `http://${ctx.req.headers.host ?? 'localhost'}`);
    if (requestUrl.searchParams.get('async') === '1') {
      const job = startAllProvidersHealthCheck();
      sendJSON(ctx.res, 202, { job });
      return true;
    }

    const health = await checkAllProvidersHealth();
    await persistProviderHealthSnapshot(getAllProviderHealth());
    sendJSON(ctx.res, 200, { health });
    return true;
  }

  if (ctx.pathname.startsWith('/api/health/check/') && ctx.req.method === 'POST') {
    const providerName = decodeURIComponent(ctx.pathname.slice('/api/health/check/'.length));
    const health = await checkProviderHealth(providerName);
    await persistProviderHealthSnapshot(getAllProviderHealth());
    sendJSON(ctx.res, 200, { health });
    return true;
  }

  if (ctx.pathname === '/api/usage' && ctx.req.method === 'GET') {
    sendJSON(ctx.res, 200, {
      records: usageTracker.getStats(),
      virtualModelStats: usageTracker.listVirtualModelStats(),
    });
    return true;
  }

  if (ctx.pathname === '/api/usage' && ctx.req.method === 'DELETE') {
    const records = await usageTracker.clear();
    sendJSON(ctx.res, 200, { records });
    return true;
  }

  if (ctx.pathname === '/api/agents/configure' && ctx.req.method === 'POST') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ target?: unknown; modelIds?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;

    const target = typeof parsedBody.value.target === 'string' ? parsedBody.value.target.trim() : '';
    if (!['claude', 'codex', 'continue', 'cline', 'roo', 'kilo'].includes(target)) {
      sendJSON(ctx.res, 400, { error: { message: 'Invalid target. Expected one of: claude, codex, continue, cline, roo, kilo.', type: 'invalid_request_error' } });
      return true;
    }

    const requestedModelIds = Array.isArray(parsedBody.value.modelIds) ? parsedBody.value.modelIds.filter((value): value is string => typeof value === 'string') : undefined;
    const models = getQuickConnectModels(requestedModelIds);
    const baseUrl = `http://localhost:${ctx.config.port}`;

    const result = target === 'claude'
      ? await configureClaudeAgentProfiles({ baseUrl, models })
      : target === 'codex'
        ? await configureCodexAgentProfiles({ baseUrl, models })
        : target === 'continue'
          ? await configureContinueAgent({ baseUrl, models })
          : target === 'cline'
            ? await configureClineAgent({ baseUrl, models })
            : target === 'roo'
              ? await configureRooAgent({ baseUrl, models })
              : await configureKiloAgent({ baseUrl, models });
    sendJSON(ctx.res, 200, result);
    return true;
  }

  if (ctx.pathname === '/api/agents/launch' && ctx.req.method === 'POST') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ target?: unknown; profileName?: unknown; gatewayKey?: unknown; modelId?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;

    const target = typeof parsedBody.value.target === 'string' ? parsedBody.value.target.trim() : '';
    if (!['claude', 'codex'].includes(target)) {
      sendJSON(ctx.res, 400, { error: { message: 'Invalid launch target. Expected one of: claude, codex.', type: 'invalid_request_error' } });
      return true;
    }

    const modelId = typeof parsedBody.value.modelId === 'string' ? parsedBody.value.modelId.trim() : '';
    const baseUrl = `http://localhost:${ctx.config.port}`;
    const launcher = ctx.options.launchAgentTool ?? launchAgentTool;
    const result = await launcher({
      target: target as AgentLaunchTarget,
      baseUrl,
      profileName: typeof parsedBody.value.profileName === 'string' ? parsedBody.value.profileName.trim() : undefined,
      gatewayKey: typeof parsedBody.value.gatewayKey === 'string' ? parsedBody.value.gatewayKey : undefined,
      modelId: modelId || getPrimaryModelId(getQuickConnectModels(modelId ? [modelId] : undefined)),
    });
    sendJSON(ctx.res, result.ok ? 200 : 400, result);
    return true;
  }

  if (ctx.pathname === '/health' && ctx.req.method === 'GET') {
    sendJSON(ctx.res, 200, { status: 'ok' });
    return true;
  }

  if (ctx.pathname === '/api/compression' && ctx.req.method === 'GET') {
    const config = await loadCompressionConfig();
    sendJSON(ctx.res, 200, { config });
    return true;
  }

  if (ctx.pathname === '/api/compression' && ctx.req.method === 'PUT') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ config?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;

    const next = await saveCompressionConfig(parsedBody.value.config ?? parsedBody.value);
    sendJSON(ctx.res, 200, { config: next });
    return true;
  }

  if (ctx.pathname === '/api/settings' && ctx.req.method === 'GET') {
    const config = await loadSettingsConfig();
    sendJSON(ctx.res, 200, { config });
    return true;
  }

  if (ctx.pathname === '/api/settings' && ctx.req.method === 'PUT') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ config?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;

    const next = await saveSettingsConfig(parsedBody.value.config ?? parsedBody.value);
    sendJSON(ctx.res, 200, { config: next });
    return true;
  }

  if (ctx.pathname === '/api/skills' && ctx.req.method === 'GET') {
    sendJSON(ctx.res, 200, { skills: listSkills() });
    return true;
  }

  if (ctx.pathname === '/api/memory' && ctx.req.method === 'GET') {
    const url = new URL(ctx.req.url ?? '', `http://localhost:${ctx.config.port}`);
    const query = url.searchParams.get('q');
    const entries = query ? await searchMemory(query) : await listMemory();
    sendJSON(ctx.res, 200, { entries });
    return true;
  }

  if (ctx.pathname === '/api/memory' && ctx.req.method === 'POST') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ content?: unknown; session?: unknown; tags?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    if (typeof parsedBody.value.content !== 'string' || !parsedBody.value.content.trim()) {
      sendJSON(ctx.res, 400, { error: { message: 'content is required', type: 'invalid_request_error' } });
      return true;
    }
    const entry = await addMemory({
      content: parsedBody.value.content,
      session: typeof parsedBody.value.session === 'string' ? parsedBody.value.session : undefined,
      tags: Array.isArray(parsedBody.value.tags) ? parsedBody.value.tags : undefined,
    });
    sendJSON(ctx.res, 201, { entry });
    return true;
  }

  if (ctx.pathname.startsWith('/api/memory/') && ctx.req.method === 'DELETE') {
    const id = decodeURIComponent(ctx.pathname.slice('/api/memory/'.length));
    const ok = await deleteMemory(id);
    sendJSON(ctx.res, ok ? 200 : 404, { ok });
    return true;
  }

  if (ctx.pathname === '/api/quota' && ctx.req.method === 'GET') {
    const [config, headroom] = await Promise.all([getQuotaConfig(), computeHeadroom()]);
    sendJSON(ctx.res, 200, { config, headroom });
    return true;
  }

  if (ctx.pathname === '/api/quota' && ctx.req.method === 'PUT') {
    const raw = await readBody(ctx.req);
    const parsedBody = parseJsonBody<{ config?: unknown }>(raw, ctx.res);
    if (!parsedBody.ok) return true;
    const next = await setQuotaConfig((parsedBody.value.config ?? parsedBody.value) as QuotaConfig);
    sendJSON(ctx.res, 200, { config: next });
    return true;
  }

  return false;
}

