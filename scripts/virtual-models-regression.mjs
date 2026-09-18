import assert from 'node:assert/strict';

import { buildCatalogSummary, getActiveCanonicalModelsForApi } from '../dist/catalog.js';
import { setAgentRailApiKey, setRuntimeApiKey } from '../dist/config.js';
import { getProviderHealth } from '../dist/health.js';
import { listCanonicalModels } from '../dist/models/registry.js';
import { providers } from '../dist/providers/index.js';
import { AUTO_MODEL_ID, FILES_MODEL_ID, routeChatCompletion } from '../dist/router.js';
import { createServer } from '../dist/server.js';
import { getVirtualModelById, reconcileVirtualModelOperationalState } from '../dist/virtual-models.js';

await setAgentRailApiKey('');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    response,
    body: await response.json(),
  };
}

async function postJson(baseUrl, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

async function postRawJson(baseUrl, pathname, payload) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function deleteRequest(baseUrl, pathname) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'DELETE',
  });
}

const groqProvider = providers.find((provider) => provider.name === 'groq');
const openRouterProvider = providers.find((provider) => provider.name === 'openrouter');

assert(groqProvider, 'Expected groq provider');
assert(openRouterProvider, 'Expected openrouter provider');

const originalGroqModels = groqProvider.models;
const originalOpenRouterModels = openRouterProvider.models;
const originalGroqChatCompletion = groqProvider.chatCompletion.bind(groqProvider);
const originalOpenRouterChatCompletion = openRouterProvider.chatCompletion.bind(openRouterProvider);
const originalGroqHealth = { ...getProviderHealth(groqProvider.name, false) };
const originalOpenRouterHealth = { ...getProviderHealth(openRouterProvider.name, false) };

const calls = [];
let openRouterFailureBudget = 0;
let openRouterUnusableSuccessBudget = 0;

setRuntimeApiKey('GROQ_API_KEY', 'groq-test-key');
setRuntimeApiKey('OPENROUTER_API_KEY', 'openrouter-test-key');

groqProvider.updateModels([
  {
    id: 'llama-4-scout',
    providerModelId: 'llama-4-scout-17b-16e-instruct',
    modality: 'Text + Vision',
    capabilities: ['chat', 'vision', 'file_input'],
  },
]);
openRouterProvider.updateModels([
  {
    id: 'llama-4-scout',
    providerModelId: 'meta-llama/llama-4-scout:free',
    modality: 'Multimodal',
    capabilities: ['chat', 'vision'],
  },
]);

groqProvider.chatCompletion = async function mockGroq(request) {
  calls.push({ provider: this.name, model: request.model, hasAgentrailMeta: request.__agentrail !== undefined });
  return jsonResponse({
    id: 'chatcmpl-file-route',
    object: 'chat.completion',
    created: 1,
    model: request.model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'file route ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  });
};
openRouterProvider.chatCompletion = async function mockOpenRouter(request) {
  calls.push({ provider: this.name, model: request.model, hasAgentrailMeta: request.__agentrail !== undefined });
  if (openRouterFailureBudget > 0) {
    openRouterFailureBudget -= 1;
    return jsonResponse({
      error: { message: 'forced upstream failure' },
    }, 503);
  }
  if (openRouterUnusableSuccessBudget > 0) {
    openRouterUnusableSuccessBudget -= 1;
    return jsonResponse({
      id: 'chatcmpl-reasoning-only',
      object: 'chat.completion',
      created: 1,
      model: request.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: null, reasoning: 'thinking without final text' },
        finish_reason: 'length',
      }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    });
  }
  return jsonResponse({
    id: 'chatcmpl-non-file-route',
    object: 'chat.completion',
    created: 1,
    model: request.model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'wrong route' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  });
};

Object.assign(getProviderHealth(groqProvider.name, true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});
Object.assign(getProviderHealth(openRouterProvider.name, true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});

const server = createServer();
const baseUrl = await listen(server);
const uniqueSuffix = Date.now();
const baseVirtualModelId = `custom/router-${uniqueSuffix}`;
const baseAlias = `router-alias-${uniqueSuffix}`;
const duplicateAliasId = `custom/alias-conflict-${uniqueSuffix}`;
const duplicateModelId = `custom/model-conflict-${uniqueSuffix}`;
const cloneVirtualModelId = `custom/router-clone-${uniqueSuffix}`;

try {
  const routed = await routeChatCompletion({
    model: FILES_MODEL_ID,
    messages: [{ role: 'user', content: 'Use native file routing' }],
  });
  assert.equal(routed.provider.name, 'groq');
  assert.equal(calls[0]?.model, 'groq/llama-4-scout');

  const canonicalFilesModel = listCanonicalModels().find((model) => model.id === FILES_MODEL_ID);
  assert(canonicalFilesModel);
  assert.deepEqual(canonicalFilesModel.capabilities, ['chat', 'file_input']);

  const activeFilesModel = getActiveCanonicalModelsForApi().find((model) => model.id === FILES_MODEL_ID);
  assert(activeFilesModel);
  assert.equal(activeFilesModel.providers.some((provider) => provider.name === 'groq'), true);

  const catalogFilesModel = buildCatalogSummary().models.find((model) => model.id === FILES_MODEL_ID);
  assert(catalogFilesModel);

  const modelsResponse = await getJson(baseUrl, '/v1/models');
  assert.equal(modelsResponse.response.status, 200);
  assert.equal(modelsResponse.body.data.some((model) => model.id === FILES_MODEL_ID), true);

  const activeResponse = await getJson(baseUrl, '/api/models/active');
  assert.equal(activeResponse.response.status, 200);
  const activeFromApi = activeResponse.body.models.find((model) => model.id === FILES_MODEL_ID);
  assert(activeFromApi);
  assert.equal(activeFromApi.capabilities.includes('file_input'), true);

  calls.length = 0;
  Object.assign(getProviderHealth(groqProvider.name, true), {
    state: 'healthy',
    message: 'mocked healthy',
    checkedAt: Date.now(),
    latencyMs: 50,
  });
  Object.assign(getProviderHealth(openRouterProvider.name, true), {
    state: 'healthy',
    message: 'mocked healthy',
    checkedAt: Date.now(),
    latencyMs: 400,
  });

  const autoRouted = await routeChatCompletion({
    model: AUTO_MODEL_ID,
    messages: [{ role: 'user', content: 'Pick the faster route' }],
  });
  assert.equal(autoRouted.provider.name, 'groq');
  assert.equal(calls[0]?.model, 'groq/llama-4-scout');

  const createResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: baseVirtualModelId,
    name: 'Base Router',
    routingStrategy: 'random',
    capabilities: ['chat'],
    autoAliases: [baseAlias],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 80, fallbackOnly: false, capabilities: ['chat', 'vision'] },
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: false, weight: 20, fallbackOnly: true, capabilities: ['chat'] },
    ],
  });
  assert.equal(createResponse.response.status, 201);
  assert.equal(createResponse.body.selectedModels[0].weight, 80);
  assert.equal(createResponse.body.selectedModels[0].enabled, true);
  assert.equal(createResponse.body.selectedModels[1].fallbackOnly, true);
  assert.equal(createResponse.body.selectedModels[1].enabled, false);

  const templatesResponse = await getJson(baseUrl, '/api/virtual-models/templates');
  assert.equal(templatesResponse.response.status, 200);
  assert.equal(Array.isArray(templatesResponse.body), true);
  assert.equal(templatesResponse.body.length >= 3, true);
  assert.equal(templatesResponse.body.some((template) => template.id === 'chat-failover'), true);
  assert.equal(templatesResponse.body.some((template) => template.id === 'weighted-cheap-pool'), true);
  assert.equal(templatesResponse.body.some((template) => template.id === 'vision-router'), true);

  const duplicateAliasInPayloadResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: `${duplicateAliasId}-in-payload`,
    name: 'Alias Duplicate Payload',
    routingStrategy: 'priority',
    capabilities: ['chat'],
    autoAliases: [`dup-${uniqueSuffix}`, `dup-${uniqueSuffix}`],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1 },
    ],
  });
  assert.equal(duplicateAliasInPayloadResponse.response.status, 400);
  assert.match(duplicateAliasInPayloadResponse.body.error.message, /Duplicate alias/i);

  const duplicateAliasConflictResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: duplicateAliasId,
    name: 'Alias Conflict',
    routingStrategy: 'priority',
    capabilities: ['chat'],
    autoAliases: [baseAlias],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1 },
    ],
  });
  assert.equal(duplicateAliasConflictResponse.response.status, 400);
  assert.match(duplicateAliasConflictResponse.body.error.message, new RegExp(baseAlias));

  const duplicateSelectedModelResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: duplicateModelId,
    name: 'Duplicate Selected Model',
    routingStrategy: 'priority',
    capabilities: ['chat'],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1 },
      { provider: 'groq', modelId: 'llama-4-scout', priority: 2, enabled: false, weight: 50 },
    ],
  });
  assert.equal(duplicateSelectedModelResponse.response.status, 400);
  assert.match(duplicateSelectedModelResponse.body.error.message, /Duplicate selected model/i);

  const previewResponse = await postJson(baseUrl, '/api/virtual-models/preview', {
    routingStrategy: 'priority',
    capabilities: ['chat'],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 80 },
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: false, weight: 20 },
    ],
  });
  assert.equal(previewResponse.response.status, 200);
  assert.equal(previewResponse.body.strategy, 'priority');
  assert.equal(previewResponse.body.eligibleModels.length, 2);
  assert.equal(previewResponse.body.eligibleModels[1].healthy, false);
  assert.equal(previewResponse.body.eligibleModels[1].reason, 'disabled');
  assert.equal(previewResponse.body.suggestedRoute.provider, 'groq');
  assert.ok(Array.isArray(previewResponse.body.explanation));

  const dryRunResponse = await postJson(baseUrl, '/api/virtual-models/test', {
    id: baseVirtualModelId,
    routingStrategy: 'priority',
    capabilities: ['chat'],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 80 },
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: false, weight: 20 },
    ],
    input: { messages: [{ role: 'user', content: 'ping' }] },
    dryRun: true,
  });
  assert.equal(dryRunResponse.response.status, 200);
  assert.equal(dryRunResponse.body.dryRun, true);
  assert.deepEqual(dryRunResponse.body.selectedRoute, { provider: 'groq', modelId: 'llama-4-scout' });
  assert.equal(dryRunResponse.body.preview.eligibleModels.length, 2);

  const initialStatsResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/stats`);
  assert.equal(initialStatsResponse.response.status, 200);
  assert.equal(initialStatsResponse.body.id, baseVirtualModelId);
  assert.equal(initialStatsResponse.body.totalRequests, 0);
  assert.equal(initialStatsResponse.body.lastUsedAt, null);
  assert.deepEqual(initialStatsResponse.body.routeHits, []);
  assert.deepEqual(initialStatsResponse.body.routeFailures, []);
  assert.ok(Array.isArray(initialStatsResponse.body.currentlyExcluded));
  assert.equal(initialStatsResponse.body.currentlyExcluded.some((entry) => entry.provider === 'openrouter' && entry.reason === 'disabled'), true);

  const cloneResponse = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/clone`, {
    id: cloneVirtualModelId,
    name: 'Base Router Copy',
  });
  assert.equal(cloneResponse.response.status, 201);
  assert.equal(cloneResponse.body.id, cloneVirtualModelId);
  assert.equal(cloneResponse.body.name, 'Base Router Copy');
  assert.deepEqual(cloneResponse.body.selectedModels, createResponse.body.selectedModels);
  assert.deepEqual(cloneResponse.body.autoAliases, []);
  assert.equal(cloneResponse.body.isBuiltin, false);

  const cloneConflictResponse = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/clone`, {
    id: cloneVirtualModelId,
    name: 'Base Router Copy Again',
  });
  assert.equal(cloneConflictResponse.response.status, 409);

  const cloneAliasConflictResponse = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/clone`, {
    id: `${cloneVirtualModelId}-alias-conflict`,
    name: 'Base Router Alias Conflict',
    autoAliases: [baseAlias],
  });
  assert.equal(cloneAliasConflictResponse.response.status, 400);
  assert.match(cloneAliasConflictResponse.body.error.message, /Duplicate alias/i);

  const cloneMissingResponse = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(`missing-${uniqueSuffix}`)}/clone`, {
    id: `${cloneVirtualModelId}-missing`,
    name: 'Missing Copy',
  });
  assert.equal(cloneMissingResponse.response.status, 404);

  calls.length = 0;
  const originalMathRandom = Math.random;
  Math.random = () => 0.95;
  const weightedRoute = await routeChatCompletion({
    model: baseVirtualModelId,
    messages: [{ role: 'user', content: 'Prefer higher weighted route when random is high' }],
  });
  Math.random = originalMathRandom;
  assert.equal(weightedRoute.provider.name, 'groq');
  assert.equal(weightedRoute.routeModel, 'groq/llama-4-scout');

  const fallbackOnlyVirtualModelId = `custom/fallback-only-${uniqueSuffix}`;
  const fallbackOnlyCreateResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: fallbackOnlyVirtualModelId,
    name: 'Fallback Only Router',
    routingStrategy: 'priority',
    capabilities: ['chat'],
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1, enabled: false, weight: 1, fallbackOnly: false, capabilities: ['chat', 'vision'] },
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: true, weight: 1, fallbackOnly: true, capabilities: ['chat'] },
    ],
  });
  assert.equal(fallbackOnlyCreateResponse.response.status, 201);

  calls.length = 0;
  Object.assign(getProviderHealth(groqProvider.name, true), {
    state: 'healthy',
    message: 'mocked healthy',
    checkedAt: Date.now(),
  });
  Object.assign(getProviderHealth(openRouterProvider.name, true), {
    state: 'healthy',
    message: 'mocked healthy',
    checkedAt: Date.now(),
  });
  const fallbackOnlyRoute = await routeChatCompletion({
    model: fallbackOnlyVirtualModelId,
    messages: [{ role: 'user', content: 'Use fallback when there is no primary pool' }],
  });
  assert.equal(fallbackOnlyRoute.provider.name, 'openrouter');
  assert.equal(fallbackOnlyRoute.routeModel, 'openrouter/llama-4-scout');
  const unusableSuccessVirtualModelId = `custom/unusable-success-${uniqueSuffix}`;
  const unusableSuccessCreateResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: unusableSuccessVirtualModelId,
    name: 'Unusable Success Router',
    routingStrategy: 'priority',
    capabilities: ['chat'],
    selectedModels: [
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat'] },
      { provider: 'groq', modelId: 'llama-4-scout', priority: 2, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat', 'vision'] },
    ],
  });
  assert.equal(unusableSuccessCreateResponse.response.status, 201);

  calls.length = 0;
  openRouterUnusableSuccessBudget = 1;
  const unusableSuccessRoute = await routeChatCompletion({
    model: unusableSuccessVirtualModelId,
    messages: [{ role: 'user', content: 'Skip responses that contain no assistant text' }],
  });
  assert.equal(unusableSuccessRoute.provider.name, 'groq');
  assert.equal(calls.map((entry) => entry.provider).join(','), 'openrouter,groq');

  const unusableSuccessTraceResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(unusableSuccessVirtualModelId)}/trace?limit=1`);
  assert.equal(unusableSuccessTraceResponse.response.status, 200);
  assert.equal(unusableSuccessTraceResponse.body.traces[0].attempts[0].outcome, 'invalid_response');
  assert.match(unusableSuccessTraceResponse.body.traces[0].attempts[0].message, /empty assistant content/i);

  assert.deepEqual(createResponse.body.autoProtection, {
    enabled: true,
    failureThreshold: 3,
    cooldownMs: 600000,
  });

  const autoProtectVirtualModelId = `custom/auto-protect-${uniqueSuffix}`;
  const autoProtectCreateResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: autoProtectVirtualModelId,
    name: 'Auto Protect Router',
    routingStrategy: 'priority',
    capabilities: ['chat'],
    autoProtection: {
      enabled: true,
      failureThreshold: 3,
      cooldownMs: 500,
    },
    selectedModels: [
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat'] },
      { provider: 'groq', modelId: 'llama-4-scout', priority: 2, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat', 'vision'] },
    ],
  });
  assert.equal(autoProtectCreateResponse.response.status, 201);
  assert.deepEqual(autoProtectCreateResponse.body.autoProtection, {
    enabled: true,
    failureThreshold: 3,
    cooldownMs: 500,
  });

  const stickyVirtualModelId = `custom/sticky-${uniqueSuffix}`;
  const stickyCreateResponse = await postJson(baseUrl, '/api/virtual-models', {
    id: stickyVirtualModelId,
    name: 'Sticky Router',
    routingStrategy: 'random',
    capabilities: ['chat'],
    stickyMode: 'request-key',
    selectedModels: [
      { provider: 'groq', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat', 'vision'] },
      { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat'] },
    ],
  });
  assert.equal(stickyCreateResponse.response.status, 201);

  calls.length = 0;
  Math.random = () => 0.99;
  const stickyRouteA = await routeChatCompletion({
    model: stickyVirtualModelId,
    messages: [{ role: 'user', content: 'Sticky route A' }],
    __agentrail: { stickyKey: 'customer-123' },
  });
  Math.random = () => 0.01;
  const stickyRouteB = await routeChatCompletion({
    model: stickyVirtualModelId,
    messages: [{ role: 'user', content: 'Sticky route B' }],
    __agentrail: { stickyKey: 'customer-123' },
  });
  Math.random = originalMathRandom;
  assert.equal(stickyRouteA.provider.name, stickyRouteB.provider.name);
  assert.equal(stickyRouteA.routeModel, stickyRouteB.routeModel);
  assert.equal(calls.some((entry) => entry.hasAgentrailMeta), false);

  calls.length = 0;
  openRouterFailureBudget = 3;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await routeChatCompletion({
      model: autoProtectVirtualModelId,
      messages: [{ role: 'user', content: `Trigger auto protection ${attempt}` }],
    });
    assert.equal(result.provider.name, 'groq');
  }
  const cooledModel = getVirtualModelById(autoProtectVirtualModelId);
  assert(cooledModel, 'expected auto-protect virtual model to exist');
  const cooledMember = cooledModel.selectedModels.find((entry) => entry.provider === 'openrouter');
  assert(cooledMember, 'expected openrouter member state to exist');
  assert.equal(cooledMember.memberState?.consecutiveFailures, 3);
  assert.equal(typeof cooledMember.memberState?.autoDisabledUntil, 'number');

  calls.length = 0;
  const cooldownRoute = await routeChatCompletion({
    model: autoProtectVirtualModelId,
    messages: [{ role: 'user', content: 'Cooldown should skip failed primary' }],
  });
  assert.equal(cooldownRoute.provider.name, 'groq');
  assert.equal(calls.some((entry) => entry.provider === 'openrouter'), false);

  const cooldownTraceResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(autoProtectVirtualModelId)}/trace?limit=1`);
  assert.equal(cooldownTraceResponse.response.status, 200);
  assert.equal(cooldownTraceResponse.body.traces[0].excludedCandidates.some((entry) => entry.provider === 'openrouter' && entry.reason === 'auto_disabled_cooldown'), true);

  const cooldownStatsResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(autoProtectVirtualModelId)}/stats`);
  assert.equal(cooldownStatsResponse.response.status, 200);
  assert.equal(cooldownStatsResponse.body.routeFailures.some((entry) => entry.provider === 'openrouter' && entry.count === 3), true);
  assert.equal(cooldownStatsResponse.body.cooldownMembers, 1);
  assert.equal(cooldownStatsResponse.body.activeMembers, 1);
  assert.equal(cooldownStatsResponse.body.currentlyExcluded.some((entry) => entry.provider === 'openrouter' && entry.reason === 'auto_disabled_cooldown'), true);

  await new Promise((resolve) => setTimeout(resolve, 550));
  await reconcileVirtualModelOperationalState();
  const recoveredModel = getVirtualModelById(autoProtectVirtualModelId);
  const recoveredMember = recoveredModel?.selectedModels.find((entry) => entry.provider === 'openrouter');
  assert.equal(recoveredMember?.memberState?.autoDisabledUntil ?? null, null);
  assert.equal(recoveredMember?.memberState?.consecutiveFailures, 0);

  calls.length = 0;
  const recoveredRoute = await routeChatCompletion({
    model: autoProtectVirtualModelId,
    messages: [{ role: 'user', content: 'Recovered primary should be tried again' }],
  });
  assert.equal(recoveredRoute.provider.name, 'openrouter');
  assert.equal(calls[0]?.provider, 'openrouter');

  calls.length = 0;
  const virtualModelRoute = await routeChatCompletion({
    model: baseVirtualModelId,
    messages: [{ role: 'user', content: 'Use saved virtual model route' }],
  });
  assert.equal(calls.length, 1);
  assert.equal(virtualModelRoute.routeModel, calls[0]?.model);

  const httpVirtualModelRoute = await postRawJson(baseUrl, '/v1/chat/completions', {
    model: baseVirtualModelId,
    messages: [{ role: 'user', content: 'Route through OpenAI-compatible endpoint' }],
  });
  assert.equal(httpVirtualModelRoute.status, 200);
  assert.equal(httpVirtualModelRoute.headers.get('x-agentrail-virtual-model'), baseVirtualModelId);
  const traceId = httpVirtualModelRoute.headers.get('x-agentrail-virtual-model-trace-id');
  assert.equal(typeof traceId, 'string');
  assert.equal(Boolean(traceId), true);

  const tracesResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/trace?limit=5`);
  assert.equal(tracesResponse.response.status, 200);
  assert.equal(Array.isArray(tracesResponse.body.traces), true);
  assert.equal(tracesResponse.body.traces.length >= 1, true);
  const recentTrace = tracesResponse.body.traces[0];
  assert.equal(recentTrace.id, traceId);
  assert.equal(recentTrace.virtualModelId, baseVirtualModelId);
  assert.equal(recentTrace.outcome, 'success');
  assert.equal(recentTrace.finalRoute.provider, 'groq');
  assert.equal(recentTrace.finalRoute.modelId, 'llama-4-scout');
  assert.equal(Array.isArray(recentTrace.attempts), true);
  assert.equal(recentTrace.attempts.length >= 1, true);
  assert.equal(Array.isArray(recentTrace.excludedCandidates), true);
  assert.equal(recentTrace.excludedCandidates.some((entry) => entry.provider === 'openrouter' && entry.reason === 'disabled'), true);

  const traceDetailResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/trace/${encodeURIComponent(traceId)}`);
  assert.equal(traceDetailResponse.response.status, 200);
  assert.equal(traceDetailResponse.body.id, traceId);
  assert.equal(traceDetailResponse.body.virtualModelId, baseVirtualModelId);
  assert.equal(traceDetailResponse.body.attempts[0].provider, 'groq');
  assert.equal(traceDetailResponse.body.attempts[0].outcome, 'success');

  const statsAfterRouteResponse = await getJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/stats`);
  assert.equal(statsAfterRouteResponse.response.status, 200);
  assert.equal(statsAfterRouteResponse.body.totalRequests, 3);
  assert.equal(typeof statsAfterRouteResponse.body.lastUsedAt, 'number');
  assert.equal(statsAfterRouteResponse.body.routeHits.length, 1);
  assert.equal(statsAfterRouteResponse.body.routeHits[0].provider, virtualModelRoute.provider.name);
  assert.equal(statsAfterRouteResponse.body.routeHits[0].modelId, virtualModelRoute.routeModel.split('/').slice(1).join('/'));
  assert.equal(statsAfterRouteResponse.body.routeHits[0].count, 3);
  assert.deepEqual(statsAfterRouteResponse.body.routeFailures, []);

  const prunePreviewResponse = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/prune-unhealthy`, {});
  assert.equal(prunePreviewResponse.response.status, 200);
  assert.equal(prunePreviewResponse.body.applied, false);
  assert.deepEqual(prunePreviewResponse.body.removed, []);
  assert.deepEqual(prunePreviewResponse.body.kept, [
    { provider: 'groq', modelId: 'llama-4-scout' },
    { provider: 'openrouter', modelId: 'llama-4-scout' },
  ]);

  Object.assign(getProviderHealth(openRouterProvider.name, true), {
    state: 'unhealthy',
    message: 'mocked unhealthy',
    checkedAt: Date.now(),
  });

  const prunePreviewWithUnhealthy = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/prune-unhealthy`, {});
  assert.equal(prunePreviewWithUnhealthy.response.status, 200);
  assert.equal(prunePreviewWithUnhealthy.body.applied, false);
  assert.deepEqual(prunePreviewWithUnhealthy.body.removed, [
    { provider: 'openrouter', modelId: 'llama-4-scout', reason: 'provider_unhealthy' },
  ]);
  assert.equal(prunePreviewWithUnhealthy.body.updatedModel, undefined);

  const pruneApplyResponse = await postJson(baseUrl, `/api/virtual-models/${encodeURIComponent(baseVirtualModelId)}/prune-unhealthy`, {
    apply: true,
  });
  assert.equal(pruneApplyResponse.response.status, 200);
  assert.equal(pruneApplyResponse.body.applied, true);
  assert.equal(pruneApplyResponse.body.updatedModel.id, baseVirtualModelId);
  assert.equal(pruneApplyResponse.body.updatedModel.selectedModels.length, 1);
  assert.equal(pruneApplyResponse.body.updatedModel.selectedModels[0].provider, 'groq');
  assert.equal(pruneApplyResponse.body.updatedModel.selectedModels[0].modelId, 'llama-4-scout');
  assert.equal(pruneApplyResponse.body.updatedModel.selectedModels[0].memberState.consecutiveFailures, 0);

  const modelsAfterPruneResponse = await getJson(baseUrl, '/api/virtual-models');
  const prunedModel = modelsAfterPruneResponse.body.find((entry) => entry.id === baseVirtualModelId);
  assert.equal(prunedModel.selectedModels.length, 1);
  assert.equal(prunedModel.selectedModels[0].provider, 'groq');
  assert.equal(prunedModel.selectedModels[0].memberState.consecutiveFailures, 0);

  const deleteCloneResponse = await deleteRequest(baseUrl, `/api/virtual-models/${encodeURIComponent(cloneVirtualModelId)}`);
  assert.equal(deleteCloneResponse.status, 204);

  const deletedCloneLookup = await getJson(baseUrl, '/api/virtual-models');
  assert.equal(deletedCloneLookup.body.some((entry) => entry.id === cloneVirtualModelId), false);

  Object.assign(getProviderHealth(groqProvider.name, true), {
    state: 'unhealthy',
    message: 'mocked unhealthy',
    checkedAt: Date.now(),
  });

  await assert.rejects(
    () => routeChatCompletion({
      model: FILES_MODEL_ID,
      messages: [{ role: 'user', content: 'Fail when no file route is healthy' }],
    }),
    /file/i,
  );

  console.log('virtual model regression checks passed');
} finally {
  await close(server);
  setRuntimeApiKey('GROQ_API_KEY', '');
  setRuntimeApiKey('OPENROUTER_API_KEY', '');
  groqProvider.updateModels(originalGroqModels);
  openRouterProvider.updateModels(originalOpenRouterModels);
  groqProvider.chatCompletion = originalGroqChatCompletion;
  openRouterProvider.chatCompletion = originalOpenRouterChatCompletion;
  Object.assign(getProviderHealth(groqProvider.name, false), originalGroqHealth);
  Object.assign(getProviderHealth(openRouterProvider.name, false), originalOpenRouterHealth);
}

