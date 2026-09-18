import { fetchWithProviderTimeout } from '../../providers/timeout.js';
import { providers } from '../../providers/index.js';
import { getActiveCanonicalModelsForApi } from '../../catalog.js';
import { deleteStoredFile, getStoredFile } from '../../files-store.js';
import { cancelStoredBatch, createStoredBatch, deleteStoredBatch, deleteStoredBatches, getStoredBatch, listStoredBatches } from '../../batches-store.js';
import type { RequestContext } from '../types.js';
import { checkGatewayAuth } from '../access.js';
import { parseJsonBody, readBody, readBodyBuffer } from '../request-context.js';
import { sendJSON, sendNoContent } from '../responses.js';
import type { ModelCapability } from '../../models/capabilities.js';
import { toPublicModel } from '../public-models.js';

const JSON_SPECIALTY_ROUTES: Array<{ pathname: string; capability: ModelCapability; discoverable?: boolean }> = [
  { pathname: '/v1/embeddings', capability: 'embeddings', discoverable: true },
  { pathname: '/v1/images/generations', capability: 'image_generation', discoverable: true },
  { pathname: '/v1/audio/speech', capability: 'audio_generation' },
  { pathname: '/v1/videos/generations', capability: 'video_generation', discoverable: true },
  { pathname: '/v1/music/generations', capability: 'music_generation', discoverable: true },
  { pathname: '/v1/search', capability: 'search' },
  { pathname: '/v1/rerank', capability: 'rerank' },
  { pathname: '/v1/moderations', capability: 'moderation' },
];

const MULTIPART_SPECIALTY_ROUTES: Array<{ pathname: string; capability: ModelCapability }> = [
  { pathname: '/v1/images/edits', capability: 'image_edit' },
  { pathname: '/v1/audio/transcriptions', capability: 'audio_transcription' },
  { pathname: '/v1/audio/translations', capability: 'audio_translation' },
];

const SUPPORTED_BATCH_ENDPOINTS = new Set<string>([
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/responses',
  '/v1/embeddings',
  '/v1/images/generations',
  '/v1/images/edits',
  '/v1/audio/transcriptions',
  '/v1/audio/translations',
  '/v1/audio/speech',
  '/v1/videos/generations',
  '/v1/music/generations',
  '/v1/search',
  '/v1/rerank',
  '/v1/moderations',
]);

const TERMINAL_BATCH_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

function getStorageScope(ctx: RequestContext): { ownerApiKeyId?: string; canAccessAll: boolean } {
  const apiKey = (ctx.req as unknown as Record<string, unknown>).saasApiKey as { id?: string } | undefined;
  const user = (ctx.req as unknown as Record<string, unknown>).saasUser as { isAdmin?: boolean } | undefined;
  return { ownerApiKeyId: apiKey?.id, canAccessAll: user?.isAdmin === true };
}

function canAccessStoredRecord(record: { owner_api_key_id?: string }, scope: { ownerApiKeyId?: string; canAccessAll: boolean }): boolean {
  if (scope.canAccessAll) return true;
  if (scope.ownerApiKeyId) return record.owner_api_key_id === scope.ownerApiKeyId;
  return !record.owner_api_key_id;
}

function validStringMetadata(value: unknown): value is Record<string, string> {
  return value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string'));
}
function setRoutingHeaders(ctx: RequestContext, providerName: string, routeModel: string) {
  ctx.res.setHeader('X-AgentRail-Provider', providerName);
  ctx.res.setHeader('X-AgentRail-Route-Model', routeModel);
}

function sendInvalidRequest(ctx: RequestContext, message: string, status = 400) {
  sendJSON(ctx.res, status, { error: { message, type: 'invalid_request_error' } });
}

function sendDiscoveryHead(ctx: RequestContext): void {
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json',
    Allow: 'GET, POST, HEAD, OPTIONS',
  });
  ctx.res.end();
}

function sendModelDiscovery(ctx: RequestContext, capability: ModelCapability): void {
  sendJSON(ctx.res, 200, {
    object: 'list',
    data: getActiveCanonicalModelsForApi(capability).map(toPublicModel),
  });
}

function sendSearchProviderDiscovery(ctx: RequestContext): void {
  const providerNames = new Set(
    getActiveCanonicalModelsForApi('search').flatMap((model) => model.providers.map((provider) => provider.name)),
  );
  sendJSON(ctx.res, 200, {
    object: 'list',
    data: Array.from(providerNames).sort().map((name) => ({
      id: name,
      object: 'search_provider',
      created: 0,
      name,
      search_types: ['web'],
    })),
  });
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/content$/, '');
}

function getResponseHeaders(response: Response, body: Buffer): Record<string, string | number> {
  const headers: Record<string, string | number> = {
    'Content-Length': body.length,
  };
  const contentType = response.headers.get('content-type');
  const cacheControl = response.headers.get('cache-control');
  const contentDisposition = response.headers.get('content-disposition');
  if (contentType) headers['Content-Type'] = contentType;
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  if (contentDisposition) headers['Content-Disposition'] = contentDisposition;
  return headers;
}

function resolveTarget(modelId: string, capability: ModelCapability) {
  const model = getActiveCanonicalModelsForApi(capability).find((entry) => entry.id === modelId);
  if (!model) {
    return null;
  }
  const selectedProvider = model.providers[0];
  if (!selectedProvider) {
    return null;
  }
  const provider = providers.find((entry) => entry.name === selectedProvider.name) ?? null;
  if (!provider) {
    return null;
  }
  return {
    provider,
    routeModel: selectedProvider.providerModelId,
  };
}

async function proxyJsonRoute(ctx: RequestContext, capability: ModelCapability): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const raw = await readBody(ctx.req);
  const parsedBody = parseJsonBody<Record<string, unknown>>(raw, ctx.res);
  if (!parsedBody.ok) return true;

  const modelId = typeof parsedBody.value.model === 'string' ? parsedBody.value.model : '';
  if (!modelId) {
    sendInvalidRequest(ctx, 'Missing "model" field');
    return true;
  }

  const target = resolveTarget(modelId, capability);
  if (!target) {
    sendInvalidRequest(ctx, `No healthy provider is available for model "${modelId}" on ${ctx.pathname}`);
    return true;
  }

  const url = target.provider.getEndpointUrl(ctx.pathname);
  if (!url) {
    sendJSON(ctx.res, 501, { error: { message: `Provider "${target.provider.name}" does not support ${ctx.pathname}`, type: 'unsupported_error' } });
    return true;
  }

  const headers = await target.provider.getRequestHeaders('application/json');
  if (!headers) {
    sendJSON(ctx.res, 401, { error: { message: `Provider "${target.provider.name}" is not configured`, type: 'authentication_error' } });
    return true;
  }

  const response = await fetchWithProviderTimeout(
    { providerName: target.provider.name, operation: normalizePath(ctx.pathname) },
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...parsedBody.value, model: target.routeModel }),
    },
  );
  const body = Buffer.from(await response.arrayBuffer());
  setRoutingHeaders(ctx, target.provider.name, target.routeModel);
  ctx.res.writeHead(response.status, getResponseHeaders(response, body));
  ctx.res.end(body);
  return true;
}

async function proxyMultipartRoute(ctx: RequestContext, capability: ModelCapability): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const bodyBuffer = await readBodyBuffer(ctx.req);
  const headers = new Headers();
  for (const [name, value] of Object.entries(ctx.req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const request = new Request('http://' + String(ctx.req.headers.host ?? 'localhost') + ctx.pathname, {
    method: ctx.req.method,
    headers,
    body: new Uint8Array(bodyBuffer),
  });
  const formData = await request.formData();
  const modelId = String(formData.get('model') ?? '');
  if (!modelId) {
    sendInvalidRequest(ctx, 'Missing "model" field');
    return true;
  }

  const target = resolveTarget(modelId, capability);
  if (!target) {
    sendInvalidRequest(ctx, `No healthy provider is available for model "${modelId}" on ${ctx.pathname}`);
    return true;
  }

  const url = target.provider.getEndpointUrl(ctx.pathname);
  if (!url) {
    sendJSON(ctx.res, 501, { error: { message: `Provider "${target.provider.name}" does not support ${ctx.pathname}`, type: 'unsupported_error' } });
    return true;
  }

  formData.set('model', target.routeModel);
  const upstreamHeaders = await target.provider.getRequestHeaders();
  if (!upstreamHeaders) {
    sendJSON(ctx.res, 401, { error: { message: `Provider "${target.provider.name}" is not configured`, type: 'authentication_error' } });
    return true;
  }

  const response = await fetchWithProviderTimeout(
    { providerName: target.provider.name, operation: normalizePath(ctx.pathname) },
    url,
    {
      method: 'POST',
      headers: upstreamHeaders,
      body: formData,
    },
  );
  const body = Buffer.from(await response.arrayBuffer());
  setRoutingHeaders(ctx, target.provider.name, target.routeModel);
  ctx.res.writeHead(response.status, getResponseHeaders(response, body));
  ctx.res.end(body);
  return true;
}

async function handleBatchCreate(ctx: RequestContext): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const raw = await readBody(ctx.req);
  const parsedBody = parseJsonBody<Record<string, unknown>>(raw, ctx.res);
  if (!parsedBody.ok) return true;

  const inputFileId = typeof parsedBody.value.input_file_id === 'string' ? parsedBody.value.input_file_id : '';
  const endpoint = typeof parsedBody.value.endpoint === 'string' ? parsedBody.value.endpoint : '';
  const completionWindow = typeof parsedBody.value.completion_window === 'string' ? parsedBody.value.completion_window : undefined;

  if (!inputFileId || !endpoint) {
    sendInvalidRequest(ctx, 'Missing input_file_id or endpoint');
    return true;
  }
  if (!SUPPORTED_BATCH_ENDPOINTS.has(endpoint)) {
    sendInvalidRequest(ctx, `Unsupported batch endpoint: ${endpoint}`);
    return true;
  }
  if (completionWindow !== undefined && completionWindow !== '24h') { sendInvalidRequest(ctx, 'completion_window must be 24h'); return true; }
  if (!validStringMetadata(parsedBody.value.metadata)) { sendInvalidRequest(ctx, 'metadata values must be strings'); return true; }
  const file = await getStoredFile(inputFileId);
  const scope = getStorageScope(ctx);
  if (!file || !canAccessStoredRecord(file, scope)) {
    sendInvalidRequest(ctx, `Input file not found: ${inputFileId}`, 404);
    return true;
  }

  if (file.purpose !== 'batch') { sendInvalidRequest(ctx, 'Input file purpose must be batch'); return true; }

  const batch = await createStoredBatch({
    endpoint,
    inputFileId,
    completionWindow,
    metadata: parsedBody.value.metadata,
    ownerApiKeyId: scope.ownerApiKeyId,
  });
  sendJSON(ctx.res, 200, batch);
  return true;
}

async function handleBatchList(ctx: RequestContext): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const query = new URL(ctx.requestUrl, 'http://localhost').searchParams;
  const limit = Number(query.get('limit') ?? '20');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) { sendInvalidRequest(ctx, 'Invalid limit'); return true; }
  const scope = getStorageScope(ctx);
  let batches = (await listStoredBatches()).filter((batch) => canAccessStoredRecord(batch, scope));
  const totalCount = batches.length;
  const after = query.get('after');
  if (after) { const cursor = batches.findIndex((batch) => batch.id === after); if (cursor < 0) { sendInvalidRequest(ctx, 'Invalid after cursor'); return true; } batches = batches.slice(cursor + 1); }
  const hasMore = batches.length > limit;
  batches = batches.slice(0, limit);
  sendJSON(ctx.res, 200, {
    object: 'list',
    data: batches,
    first_id: batches[0]?.id ?? null,
    last_id: batches.at(-1)?.id ?? null,
    has_more: hasMore,
    total_count: totalCount,
  });
  return true;
}

async function handleBatchGet(ctx: RequestContext, id: string): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const batch = await getStoredBatch(id);
  if (!batch || !canAccessStoredRecord(batch, getStorageScope(ctx))) {
    sendInvalidRequest(ctx, `Batch not found: ${id}`, 404);
    return true;
  }
  sendJSON(ctx.res, 200, batch);
  return true;
}

async function handleBatchCancel(ctx: RequestContext, id: string): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const existing = await getStoredBatch(id);
  if (!existing || !canAccessStoredRecord(existing, getStorageScope(ctx))) { sendInvalidRequest(ctx, 'Batch not found: ' + id, 404); return true; }
  if (TERMINAL_BATCH_STATES.has(existing.status)) { sendInvalidRequest(ctx, 'Batch is already terminal: ' + existing.status); return true; }
  const batch = await cancelStoredBatch(id);
  if (!batch) {
    sendInvalidRequest(ctx, `Batch not found: ${id}`, 404);
    return true;
  }
  sendJSON(ctx.res, 200, batch);
  return true;
}

async function handleBatchDelete(ctx: RequestContext, id: string): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const batch = await getStoredBatch(id);
  if (!batch || !canAccessStoredRecord(batch, getStorageScope(ctx))) { sendInvalidRequest(ctx, 'Batch not found: ' + id, 404); return true; }
  if (!TERMINAL_BATCH_STATES.has(batch.status)) { sendInvalidRequest(ctx, 'Batch is not terminal', 409); return true; }
  await deleteStoredBatch(id);
  sendJSON(ctx.res, 200, { id, object: 'batch', deleted: true });
  return true;
}

async function handleDeleteCompletedBatches(ctx: RequestContext): Promise<boolean> {
  if (!(await checkGatewayAuth(ctx))) return true;
  const scope = getStorageScope(ctx);
  const batches = (await listStoredBatches()).filter((batch) => canAccessStoredRecord(batch, scope) && TERMINAL_BATCH_STATES.has(batch.status));
  let deletedFiles = 0;
  for (const batch of batches) {
    for (const fileId of [batch.output_file_id, batch.error_file_id]) {
      if (!fileId) continue;
      const file = await getStoredFile(fileId);
      if (file && canAccessStoredRecord(file, scope) && await deleteStoredFile(fileId)) deletedFiles += 1;
    }
  }
  const deletedBatches = await deleteStoredBatches(new Set(batches.map((batch) => batch.id)));
  sendJSON(ctx.res, 200, { object: 'batch.deleted', deleted_batches: deletedBatches, deleted_files: deletedFiles });
  return true;
}
export async function handleSpecialtyRoute(ctx: RequestContext): Promise<boolean> {
  const matchedJsonRoute = JSON_SPECIALTY_ROUTES.find((route) => route.pathname === ctx.pathname);
  if (matchedJsonRoute) {
    const supportsDiscovery = matchedJsonRoute.discoverable || matchedJsonRoute.capability === 'search';
    if (ctx.req.method === 'HEAD') {
      if (!(await checkGatewayAuth(ctx))) return true;
      if (supportsDiscovery) sendDiscoveryHead(ctx);
      else sendNoContent(ctx.res, 'POST, HEAD, OPTIONS');
      return true;
    }
    if (ctx.req.method === 'GET') {
      if (!supportsDiscovery) return false;
      if (!(await checkGatewayAuth(ctx))) return true;
      if (matchedJsonRoute.capability === 'search') sendSearchProviderDiscovery(ctx);
      else sendModelDiscovery(ctx, matchedJsonRoute.capability);
      return true;
    }
    if (ctx.req.method === 'POST') {
      return proxyJsonRoute(ctx, matchedJsonRoute.capability);
    }
    return false;
  }

  const matchedMultipartRoute = MULTIPART_SPECIALTY_ROUTES.find((route) => route.pathname === ctx.pathname);
  if (matchedMultipartRoute) {
    if (ctx.req.method === 'HEAD') {
      if (!(await checkGatewayAuth(ctx))) return true;
      sendNoContent(ctx.res, 'POST, HEAD, OPTIONS');
      return true;
    }
    if (ctx.req.method === 'POST') {
      return proxyMultipartRoute(ctx, matchedMultipartRoute.capability);
    }
    return false;
  }

  if (ctx.pathname === '/v1/batches' && ctx.req.method === 'HEAD') {
    if (!(await checkGatewayAuth(ctx))) return true;
    sendNoContent(ctx.res, 'GET, POST, HEAD, OPTIONS');
    return true;
  }

  if (ctx.pathname === '/v1/batches' && ctx.req.method === 'POST') {
    return handleBatchCreate(ctx);
  }

  if (ctx.pathname === '/v1/batches' && ctx.req.method === 'GET') {
    return handleBatchList(ctx);
  }

  if (ctx.pathname === '/v1/batches/delete-completed' && ctx.req.method === 'DELETE') {
    return handleDeleteCompletedBatches(ctx);
  }

  if (ctx.pathname.startsWith('/v1/batches/') && ctx.req.method === 'DELETE') {
    return handleBatchDelete(ctx, ctx.pathname.slice('/v1/batches/'.length));
  }
  if (ctx.pathname.startsWith('/v1/batches/') && ctx.req.method === 'GET') {
    const id = ctx.pathname.slice('/v1/batches/'.length);
    if (id.endsWith('/cancel')) {
      return false;
    }
    return handleBatchGet(ctx, id);
  }

  if (ctx.pathname.startsWith('/v1/batches/') && ctx.req.method === 'POST' && ctx.pathname.endsWith('/cancel')) {
    const id = ctx.pathname.slice('/v1/batches/'.length, -'/cancel'.length);
    return handleBatchCancel(ctx, id);
  }

  return false;
}
