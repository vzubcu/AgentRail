import { AUTO_MODEL_ALIASES, AUTO_MODEL_ID, FILES_MODEL_ID } from '../../router.js';
import { getActiveCanonicalModelsForApi, getAllActiveCanonicalModelsForApi } from '../../catalog.js';
import { refreshAllProviderModels, refreshProviderModels } from '../../providers/index.js';
import type { RequestContext } from '../types.js';
import { sendJSON } from '../responses.js';
import { checkCatalogAccess, checkGatewayAuth } from '../access.js';
import { getVirtualModels, hasVirtualModelsInDb } from '../../virtual-models.js';
import { toAgentRailPublicModel, toPublicModel, type PublicModel } from '../public-models.js';

function buildPublicModels(): PublicModel[] {
  const healthyModels = getAllActiveCanonicalModelsForApi();
  const models = healthyModels.map(toPublicModel);
  const existingIds = new Set(models.map((model) => model.id));
  const upsertAgentRailModel = (id: string, capabilities: string[]) => {
    const index = models.findIndex((model) => model.id === id);
    if (index >= 0) models[index] = toAgentRailPublicModel(id, capabilities);
    else models.push(toAgentRailPublicModel(id, capabilities));
    existingIds.add(id);
  };
  const addAgentRailModel = (id: string) => {
    if (!existingIds.has(id)) {
      models.push(toAgentRailPublicModel(id));
      existingIds.add(id);
    }
  };

  if (hasVirtualModelsInDb()) {
    for (const virtualModel of getVirtualModels()) {
      upsertAgentRailModel(virtualModel.id, virtualModel.capabilities);
      for (const alias of virtualModel.autoAliases) upsertAgentRailModel(alias, virtualModel.capabilities);
    }
  } else if (healthyModels.length > 0) {
    if (!existingIds.has(AUTO_MODEL_ID)) {
      models.unshift(toAgentRailPublicModel(AUTO_MODEL_ID));
      existingIds.add(AUTO_MODEL_ID);
    }
    if (healthyModels.some((model) => model.id === FILES_MODEL_ID)) addAgentRailModel(FILES_MODEL_ID);
    for (const alias of AUTO_MODEL_ALIASES) addAgentRailModel(alias);
  }

  return models;
}

function summarizePublicModels(models: PublicModel[]): Record<string, unknown> {
  return {
    count: models.length,
    firstIds: models.slice(0, 12).map((model) => model.id),
    agentrailIds: models.filter((model) => model.owned_by === 'agentrail').map((model) => model.id).slice(0, 12),
  };
}

function sendModelHead(ctx: RequestContext): void {
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json',
    Allow: 'GET, HEAD, OPTIONS',
  });
  ctx.res.end();
}

async function checkPublicModelsAccess(ctx: RequestContext): Promise<boolean> {
  if (ctx.config.saasMode) {
    return true;
  }
  return checkGatewayAuth(ctx);
}

function sendModelError(ctx: RequestContext, status: number, message: string): void {
  if (ctx.req.method === 'HEAD') {
    ctx.res.writeHead(status, { 'Content-Type': 'application/json' });
    ctx.res.end();
    return;
  }
  sendJSON(ctx.res, status, { error: { message, type: 'invalid_request_error' } });
}

export async function handleModelsRoute(ctx: RequestContext): Promise<boolean> {
  if (ctx.pathname === '/api/models/active' && ctx.req.method === 'GET') {
    if (!(await checkCatalogAccess(ctx))) return true;
    sendJSON(ctx.res, 200, { models: getActiveCanonicalModelsForApi() });
    return true;
  }

  if (ctx.pathname.startsWith('/api/models/refresh/') && ctx.req.method === 'POST') {
    const providerName = decodeURIComponent(ctx.pathname.slice('/api/models/refresh/'.length));
    const result = await refreshProviderModels(providerName);
    sendJSON(ctx.res, 200, {
      ok: true,
      refreshed: result === 'refreshed' ? [providerName] : [],
      failed: [],
      skipped: result === 'skipped' ? [providerName] : [],
      syncedAt: Date.now(),
    });
    return true;
  }

  if (ctx.pathname === '/api/models/refresh' && ctx.req.method === 'POST') {
    const result = await refreshAllProviderModels();
    sendJSON(ctx.res, 200, {
      ok: true,
      refreshed: result.refreshed,
      failed: result.failed,
      skipped: result.skipped,
      syncedAt: Date.now(),
    });
    return true;
  }

  const isModelsList = ctx.pathname === '/v1' || ctx.pathname === '/v1/models';
  if (isModelsList && ctx.req.method === 'HEAD') {
    if (!(await checkPublicModelsAccess(ctx))) return true;
    sendModelHead(ctx);
    return true;
  }

  if (isModelsList && ctx.req.method === 'GET') {
    if (!(await checkPublicModelsAccess(ctx))) return true;
    const models = buildPublicModels();
    ctx.trace('models.list', {
      requestId: ctx.requestId,
      pathname: ctx.pathname,
      ...summarizePublicModels(models),
    });
    sendJSON(ctx.res, 200, { object: 'list', data: models });
    return true;
  }

  if (ctx.pathname.startsWith('/v1/models/') && (ctx.req.method === 'GET' || ctx.req.method === 'HEAD')) {
    if (!(await checkGatewayAuth(ctx))) return true;
    const encodedId = ctx.pathname.slice('/v1/models/'.length);
    let modelId = '';
    try {
      modelId = decodeURIComponent(encodedId);
    } catch {
      sendModelError(ctx, 400, 'Invalid model ID');
      return true;
    }
    const model = buildPublicModels().find((entry) => entry.id === modelId);
    if (!model) {
      sendModelError(ctx, 404, `Model not found: ${modelId}`);
      return true;
    }
    if (ctx.req.method === 'HEAD') sendModelHead(ctx);
    else sendJSON(ctx.res, 200, model);
    return true;
  }

  return false;
}
