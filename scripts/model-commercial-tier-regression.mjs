import assert from 'node:assert/strict';

import { buildCatalogSummary } from '../dist/catalog.js';
import { setAgentRailApiKey, setRuntimeApiKey } from '../dist/config.js';
import { getProviderHealth } from '../dist/health.js';
import { providers } from '../dist/providers/index.js';
import { createServer } from '../dist/server.js';

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

class FakeElement {
  constructor({ value = '', innerHTML = '' } = {}) {
    this.value = value;
    this.innerHTML = innerHTML;
  }

  querySelectorAll() {
    return [];
  }
}

const openRouterProvider = providers.find((provider) => provider.name === 'openrouter');
const cohereProvider = providers.find((provider) => provider.name === 'cohere');
const tokenRouterProvider = providers.find((provider) => provider.name === 'tokenrouter');

assert(openRouterProvider, 'Expected openrouter provider');
assert(cohereProvider, 'Expected cohere provider');
assert(tokenRouterProvider, 'Expected tokenrouter provider');

const originalOpenRouterHealth = { ...getProviderHealth('openrouter', false) };
const originalCohereHealth = { ...getProviderHealth('cohere', false) };
const originalTokenRouterHealth = { ...getProviderHealth('tokenrouter', false) };

await setAgentRailApiKey('');
setRuntimeApiKey('OPENROUTER_API_KEY', 'openrouter-test-key');
setRuntimeApiKey('COHERE_API_KEY', 'cohere-test-key');
setRuntimeApiKey('TOKENROUTER_API_KEY', 'tokenrouter-test-key');

Object.assign(getProviderHealth('openrouter', true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});
Object.assign(getProviderHealth('cohere', true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});
Object.assign(getProviderHealth('tokenrouter', true), {
  state: 'healthy',
  message: 'mocked healthy',
  checkedAt: Date.now(),
});

const server = createServer();
const baseUrl = await listen(server);

try {
  const catalog = buildCatalogSummary();
  const freeModel = catalog.models.find((model) => model.id === 'qwen3.6-plus');
  const trialModel = catalog.models.find((model) => model.id === 'command-a');
  const paidModel = catalog.models.find((model) => model.id === 'deepseek-v4-pro');

  assert(freeModel, 'Expected qwen3.6-plus in active catalog');
  assert(trialModel, 'Expected command-a in active catalog');
  assert(paidModel, 'Expected deepseek-v4-pro in active catalog');

  assert.equal(freeModel.commercialTier, 'free');
  assert.equal(trialModel.commercialTier, 'trial');
  assert.equal(paidModel.commercialTier, 'paid');

  const activeModelsResponse = await fetch(`${baseUrl}/api/models/active`);
  assert.equal(activeModelsResponse.status, 200);
  const activeModelsBody = await activeModelsResponse.json();
  const apiFreeModel = activeModelsBody.models.find((model) => model.id === 'qwen3.6-plus');
  assert(apiFreeModel, 'Expected qwen3.6-plus in /api/models/active');
  assert.equal(apiFreeModel.commercialTier, 'free');

  const elements = new Map([
    ['model-search', new FakeElement({ value: '' })],
    ['model-provider-filter', new FakeElement({ value: 'all' })],
    ['model-tier-filter', new FakeElement({ value: 'free' })],
    ['model-sort', new FakeElement({ value: 'name' })],
    ['models-list', new FakeElement()],
  ]);

  globalThis.document = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };

  const { createModelsFeature } = await import('../src/web/app/features/models.js');
  const state = {
    providers: [{ name: 'openrouter' }, { name: 'cohere' }, { name: 'tokenrouter' }],
    models: [
      {
        id: 'qwen3.6-plus',
        providers: [{ name: 'openrouter', providerModelId: 'qwen/qwen3.6-plus:free' }],
        capabilities: ['chat'],
        modality: 'Text',
        commercialTier: 'free',
      },
      {
        id: 'command-a',
        providers: [{ name: 'cohere', providerModelId: 'command-a' }],
        capabilities: ['chat'],
        modality: 'Text',
        commercialTier: 'trial',
      },
      {
        id: 'deepseek-v4-pro',
        providers: [{ name: 'tokenrouter', providerModelId: 'deepseek-v4-pro' }],
        capabilities: ['chat'],
        modality: 'Text',
        commercialTier: 'paid',
      },
    ],
  };

  const modelsFeature = createModelsFeature({
    state,
    escapeHtml: (value) => String(value),
    formatNumber: (value) => String(value),
    copyText: async () => {},
  });

  assert.equal(typeof modelsFeature.renderModelTierFilter, 'function');
  modelsFeature.renderModelTierFilter();
  modelsFeature.renderModels();

  const rendered = elements.get('models-list').innerHTML;
  assert(rendered.includes('Commercial Tier'));
  assert(rendered.includes('Free'));
  assert.equal(rendered.includes('deepseek-v4-pro'), false);

  console.log('model commercial tier regression passed');
} finally {
  await close(server);
  setRuntimeApiKey('OPENROUTER_API_KEY', '');
  setRuntimeApiKey('COHERE_API_KEY', '');
  setRuntimeApiKey('TOKENROUTER_API_KEY', '');
  Object.assign(getProviderHealth('openrouter', false), originalOpenRouterHealth);
  Object.assign(getProviderHealth('cohere', false), originalCohereHealth);
  Object.assign(getProviderHealth('tokenrouter', false), originalTokenRouterHealth);
  delete globalThis.document;
}

