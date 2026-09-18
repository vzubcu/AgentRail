import assert from 'node:assert/strict';

import { buildCatalogSummary, getActiveCanonicalModelsForApi, listProviderEnvVars } from '../dist/catalog.js';
import { createVirtualModel, deleteVirtualModel } from '../dist/virtual-models.js';
import { initializePersistedApiKeys, setAgentRailApiKey, setRuntimeApiKey } from '../dist/config.js';
import { getProviderHealth } from '../dist/health.js';
import { filterCanonicalModelsByCapability } from '../dist/models/registry.js';
import { getProviderByName, providers, refreshProviderModels } from '../dist/providers/index.js';
import { BaseProvider } from '../dist/providers/base.js';
import { CohereProvider } from '../dist/providers/cohere.js';
import { getNvidiaChatTimeoutMs } from '../dist/providers/nvidia.js';
import { createServer } from '../dist/server.js';
import { buildTestConversationMessages, formatTestConversationEntryLabel } from '../dist/web/test-thread-reset.js';

await setAgentRailApiKey('');

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

class TestProvider extends BaseProvider {}

const githubProvider = providers.find((provider) => provider.name === 'github');
const nvidiaProvider = providers.find((provider) => provider.name === 'nvidia');
const opencodeProvider = getProviderByName('opencode');
const inactiveCohereProvider = getProviderByName('cohere');

assert(githubProvider, 'Expected github provider');
assert(nvidiaProvider, 'Expected nvidia provider');
assert(opencodeProvider, 'Expected opencode provider');
assert(inactiveCohereProvider, 'Expected cohere provider');

const originalGithubModels = githubProvider.models;
const originalNvidiaModels = nvidiaProvider.models;
const originalOpenCodeModels = opencodeProvider.models;
const originalInactiveCohereModels = inactiveCohereProvider.models;
const originalGithubHealth = { ...getProviderHealth(githubProvider.name, false) };
const originalNvidiaHealth = { ...getProviderHealth(nvidiaProvider.name, false) };
const originalNvidiaBlocked = new Set(nvidiaProvider.blockedModelIds);
const originalNvidiaTimeouts = new Map(nvidiaProvider.timeoutModelStreaks);
const originalOpenCodeBlocked = new Set(opencodeProvider.blockedModelIds);
const originalOpenCodeTimeouts = new Map(opencodeProvider.timeoutModelStreaks);

setRuntimeApiKey('GITHUB_TOKEN', 'github-test-key');
setRuntimeApiKey('NVIDIA_API_KEY', 'nvidia-test-key');

githubProvider.updateModels([
  {
    id: 'Cohere-embed-v3-english',
    providerModelId: 'Cohere-embed-v3-english',
    modality: 'Embeddings',
    capabilities: ['embeddings'],
  },
  {
    id: 'gpt-4o',
    providerModelId: 'gpt-4o',
    modality: 'Text + Vision',
    capabilities: ['chat', 'vision'],
  },
  {
    id: 'shared-health-capability',
    providerModelId: 'shared-chat',
    modality: 'Text',
    capabilities: ['chat'],
  },
]);

inactiveCohereProvider.updateModels([{
  id: 'shared-health-capability',
  providerModelId: 'shared-embedding',
  modality: 'Embeddings',
  capabilities: ['embeddings'],
}]);

nvidiaProvider.updateModels([
  {
    id: 'codegemma-1.1-7b',
    providerModelId: 'google/codegemma-1.1-7b',
    modality: 'Text',
    capabilities: ['chat'],
  },
  {
    id: 'nemotron-3-super',
    providerModelId: 'nvidia/nemotron-3-super-120b-a12b',
    modality: 'Text',
    capabilities: ['chat'],
  },
]);

nvidiaProvider.blockedModelIds = new Set(['codegemma-1.1-7b']);
nvidiaProvider.timeoutModelStreaks = new Map();

Object.assign(getProviderHealth(githubProvider.name, true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});
Object.assign(getProviderHealth(nvidiaProvider.name, true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});

const virtualModelId = 'custom/chat-surface-test';
const embeddingVirtualModelId = 'custom/embedding-surface-test';
await createVirtualModel({
  id: virtualModelId,
  name: 'Chat Surface Test',
  routingStrategy: 'priority',
  capabilities: ['chat'],
  selectedModels: [{ provider: 'github', modelId: 'gpt-4o', priority: 1, enabled: true, weight: 1, fallbackOnly: false }],
});
await createVirtualModel({
  id: embeddingVirtualModelId,
  name: 'Embedding Surface Test',
  routingStrategy: 'priority',
  capabilities: ['embeddings'],
  selectedModels: [{ provider: 'github', modelId: 'Cohere-embed-v3-english', priority: 1, enabled: true, weight: 1, fallbackOnly: false }],
});

const server = createServer();
const baseUrl = await listen(server);

try {
  assert.equal(
    getActiveCanonicalModelsForApi('embeddings').some((model) => model.id === 'shared-health-capability'),
    false,
  );
  assert.equal(
    getActiveCanonicalModelsForApi('chat').some((model) => model.id === 'shared-health-capability'),
    true,
  );

  const activeModels = getActiveCanonicalModelsForApi();
  assert.equal(activeModels.some((model) => model.id === 'Cohere-embed-v3-english'), false);
  assert.equal(activeModels.some((model) => model.id === 'codegemma-1.1-7b'), false);
  assert.equal(activeModels.some((model) => model.id === 'gpt-4o'), true);
  assert.equal(activeModels.some((model) => model.id === 'nemotron-3-super'), true);

  const catalogModels = buildCatalogSummary().models;
  assert.equal(catalogModels.some((model) => model.id === 'Cohere-embed-v3-english'), false);
  assert.equal(catalogModels.some((model) => model.id === 'codegemma-1.1-7b'), false);
  assert.equal(catalogModels.some((model) => model.id === virtualModelId), true);

  const filteredChatModels = filterCanonicalModelsByCapability([
    {
      id: 'embed-only',
      providers: [{ name: 'github', providerModelId: 'embed-only' }],
      capabilities: ['embeddings'],
    },
    {
      id: 'chat-only',
      providers: [{ name: 'nvidia', providerModelId: 'chat-only' }],
      capabilities: ['chat'],
    },
  ], 'chat');
  assert.deepEqual(filteredChatModels.map((model) => model.id), ['chat-only']);

  assert.deepEqual(
    buildTestConversationMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', pending: true },
    ]),
    [{ role: 'user', content: 'hello' }],
  );
  assert.equal(
    formatTestConversationEntryLabel({ role: 'user', content: 'hello', requestedModel: 'nvidia/gemma-4-31b' }),
    'user → nvidia/gemma-4-31b',
  );
  assert.equal(
    formatTestConversationEntryLabel({ role: 'assistant', content: 'ok', routeModel: 'nvidia/nemotron-3-super' }),
    'assistant ← nvidia/nemotron-3-super',
  );
  assert.equal(
    formatTestConversationEntryLabel({ role: 'assistant', content: 'Error', kind: 'error', routeModel: 'nvidia/gemma-4-31b' }),
    'error ← nvidia/gemma-4-31b',
  );
  assert.equal(getNvidiaChatTimeoutMs('nvidia/deepseek-v4-pro'), 90_000);
  assert.equal(getNvidiaChatTimeoutMs('nvidia/mistral-small-4'), undefined);

  const timeoutProvider = new TestProvider({
    name: 'timeout-test',
    baseURL: 'https://example.com',
    apiKeyEnvVar: 'TIMEOUT_TEST_KEY',
    website: 'https://example.com',
    models: [{ id: 'slow-chat', providerModelId: 'slow-chat', modality: 'Text', capabilities: ['chat'] }],
  });
  timeoutProvider.recordTimeoutFailure('timeout-test/slow-chat', 3);
  assert.equal(timeoutProvider.isModelBlocked('timeout-test/slow-chat'), false);
  timeoutProvider.recordTimeoutFailure('timeout-test/slow-chat', 3);
  assert.equal(timeoutProvider.isModelBlocked('timeout-test/slow-chat'), false);
  timeoutProvider.recordTimeoutFailure('timeout-test/slow-chat', 3);
  assert.equal(timeoutProvider.isModelBlocked('timeout-test/slow-chat'), true);

  const resetProvider = new TestProvider({
    name: 'reset-test',
    baseURL: 'https://example.com',
    apiKeyEnvVar: 'RESET_TEST_KEY',
    website: 'https://example.com',
    models: [{ id: 'recoverable-chat', providerModelId: 'recoverable-chat', modality: 'Text', capabilities: ['chat'] }],
  });
  resetProvider.recordTimeoutFailure('reset-test/recoverable-chat', 3);
  resetProvider.recordTimeoutFailure('reset-test/recoverable-chat', 3);
  assert.equal(resetProvider.getTimeoutFailureCount('reset-test/recoverable-chat'), 2);
  resetProvider.clearModelFailureState('reset-test/recoverable-chat');
  assert.equal(resetProvider.getTimeoutFailureCount('reset-test/recoverable-chat'), 0);

  const activeModelsResponse = await getJson(baseUrl, '/api/models/active');
  assert.equal(activeModelsResponse.response.status, 200);
  assert.equal(activeModelsResponse.body.models.some((model) => model.id === virtualModelId), true);

  const modelsResponse = await getJson(baseUrl, '/v1/models');
  assert.equal(modelsResponse.response.status, 200);
  const publicEmbeddingModel = modelsResponse.body.data.find((model) => model.id === 'Cohere-embed-v3-english');
  assert(publicEmbeddingModel);
  assert.equal(publicEmbeddingModel.type, 'embedding');
  assert.equal(modelsResponse.body.data.some((model) => model.id === 'codegemma-1.1-7b'), false);
  const publicVirtualModel = modelsResponse.body.data.find((model) => model.id === virtualModelId);
  assert(publicVirtualModel);
  assert.equal(publicVirtualModel.owned_by, 'agentrail');
  assert.deepEqual(publicVirtualModel.capabilities, ['chat']);
  const publicEmbeddingVirtualModel = modelsResponse.body.data.find((model) => model.id === embeddingVirtualModelId);
  assert(publicEmbeddingVirtualModel);
  assert.equal(publicEmbeddingVirtualModel.owned_by, 'agentrail');
  assert.deepEqual(publicEmbeddingVirtualModel.capabilities, ['embeddings']);
  assert.equal(publicEmbeddingVirtualModel.type, 'embedding');

  const routeHeaderServer = createServer({
    routeChatCompletion: async () => ({
      provider: githubProvider,
      routeModel: 'github/gpt-4o',
      response: new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    }),
  });
  const routeHeaderBaseUrl = await listen(routeHeaderServer);
  try {
    const response = await fetch(`${routeHeaderBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'github/gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: false }),
    });
    assert.equal(response.headers.get('X-AgentRail-Route-Model'), 'github/gpt-4o');
  } finally {
    await close(routeHeaderServer);
  }

  const originalFetch = globalThis.fetch;
  let capturedRequestBody = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'deepseek-v4-flash-free', object: 'model' },
          { id: 'north-mini-code-free', object: 'model' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    capturedRequestBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({
      id: 'cohere-test',
      text: 'ok',
      finish_reason: 'COMPLETE',
      usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const cohereProvider = new CohereProvider({
    name: 'cohere-test',
    baseURL: 'https://api.cohere.com/v2',
    apiKeyEnvVar: 'COHERE_API_KEY',
    website: 'https://dashboard.cohere.com',
    models: [
      { id: 'command-a', providerModelId: 'command-a', modality: 'Text', capabilities: ['chat'] },
    ],
  });
  setRuntimeApiKey('COHERE_API_KEY', 'cohere-test-key');
  setRuntimeApiKey('OPENCODE_API_KEY', 'opencode-test-key');

  try {
    await cohereProvider.chatCompletion({
      model: 'cohere-test/command-a',
      messages: [
        { role: 'user', content: 'Start here' },
        { role: 'assistant', content: [{ type: 'attachment_metadata', filename: 'a.png' }] },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] },
        { role: 'user', content: 'Finish here' },
      ],
      stream: false,
    });

    const refreshStatus = await refreshProviderModels('opencode');
    assert.equal(refreshStatus, 'refreshed');
    assert.deepEqual(opencodeProvider.models.map((model) => model.id).sort(), ['deepseek-v4-flash-free', 'north-mini-code-free']);
  } finally {
    globalThis.fetch = originalFetch;
    setRuntimeApiKey('COHERE_API_KEY', '');
    setRuntimeApiKey('OPENCODE_API_KEY', '');
  }

  assert(capturedRequestBody, 'Expected captured Cohere request body');
  assert.deepEqual(
    capturedRequestBody.messages.map((message) => message.content),
    ['Start here', 'Finish here'],
  );

  console.log('chat surface regression checks passed');
} finally {
  await close(server);
  await deleteVirtualModel(virtualModelId).catch(() => {});
  await deleteVirtualModel(embeddingVirtualModelId).catch(() => {});
  setRuntimeApiKey('GITHUB_TOKEN', '');
  setRuntimeApiKey('NVIDIA_API_KEY', '');
  setRuntimeApiKey('OPENCODE_API_KEY', '');
  githubProvider.updateModels(originalGithubModels);
  nvidiaProvider.updateModels(originalNvidiaModels);
  opencodeProvider.updateModels(originalOpenCodeModels);
  inactiveCohereProvider.updateModels(originalInactiveCohereModels);
  nvidiaProvider.blockedModelIds = originalNvidiaBlocked;
  nvidiaProvider.timeoutModelStreaks = originalNvidiaTimeouts;
  opencodeProvider.blockedModelIds = originalOpenCodeBlocked;
  opencodeProvider.timeoutModelStreaks = originalOpenCodeTimeouts;
  Object.assign(getProviderHealth(githubProvider.name, false), originalGithubHealth);
  Object.assign(getProviderHealth(nvidiaProvider.name, false), originalNvidiaHealth);
}
