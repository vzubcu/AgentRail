import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildCatalogSummary, listProviderEnvVars } from '../dist/catalog.js';
import { checkProviderHealth, getProviderHealth } from '../dist/health.js';
import { setRuntimeApiKey } from '../dist/config.js';
import { getProviderByName, refreshProviderModels } from '../dist/providers/index.js';

const providerExpectations = [
  {
    name: 'kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnvVar: 'KIMI_API_KEY',
    website: 'https://platform.moonshot.cn',
    models: [
      'kimi-k2',
      'kimi-k2.5',
      'kimi-k2.6',
      'kimi-k3',
      'kimi-latest',
    ],
  },
  {
    name: 'reka',
    baseURL: 'https://api.reka.ai/v1',
    apiKeyEnvVar: 'REKA_API_KEY',
    website: 'https://docs.reka.ai/chat/overview',
    headerName: 'X-Api-Key',
    headerValueFromKey: true,
    models: [
      'reka-flash-3',
      'reka-core-3',
    ],
  },
  {
    name: 'nous-research',
    baseURL: 'https://inference-api.nousresearch.com/v1',
    apiKeyEnvVar: 'NOUS_RESEARCH_API_KEY',
    website: 'https://portal.nousresearch.com/help',
    models: [
      'hermes-4-70b',
      'hermes-3-llama-3.1-70b',
    ],
  },
  {
    name: 'openadapter',
    baseURL: 'https://api.openadapter.in/v1',
    apiKeyEnvVar: 'OPENADAPTER_API_KEY',
    website: 'https://openadapter.dev',
    models: [
      'deepseek-v3',
      'qwen3-32b',
      'llama-3.3-70b',
    ],
  },
  {
    name: 'tokenrouter',
    baseURL: 'https://api.tokenrouter.com/v1',
    apiKeyEnvVar: 'TOKENROUTER_API_KEY',
    website: 'https://tokenrouter.com',
    models: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'minimax-m1',
    ],
  },
  {
    name: 'bluesminds',
    baseURL: 'https://api.bluesminds.com/v1',
    apiKeyEnvVar: 'BLUESMINDS_API_KEY',
    website: 'https://www.bluesminds.com',
    models: [
      'gpt-4o-mini',
      'gemini-2.5-flash',
      'deepseek-v3',
    ],
  },
];

const originalFetch = globalThis.fetch;

for (const expectation of providerExpectations) {
  const provider = getProviderByName(expectation.name);
  assert(provider, `Expected ${expectation.name} provider to be registered`);
  assert.equal(provider.baseURL, expectation.baseURL);
  assert.equal(provider.apiKeyEnvVar, expectation.apiKeyEnvVar);
  assert.equal(provider.website, expectation.website);
  assert.deepEqual(
    provider.originalModels.map((model) => model.id),
    expectation.models,
    `Expected conservative allowlist for ${expectation.name}`,
  );

  assert.equal(
    listProviderEnvVars().includes(expectation.apiKeyEnvVar),
    true,
    `Expected ${expectation.apiKeyEnvVar} to be configurable`,
  );

  const providerSummary = buildCatalogSummary().providers.find((item) => item.name === expectation.name);
  assert(providerSummary, `Expected ${expectation.name} in catalog summary`);
  assert.equal(providerSummary.apiKeyEnvVar, expectation.apiKeyEnvVar);
  assert.equal(providerSummary.available, false);
  assert.equal(providerSummary.health.state, 'missing_key');

  assert.equal(getProviderHealth(expectation.name, false).state, 'missing_key');
  assert.equal((await checkProviderHealth(expectation.name)).state, 'missing_key');
  assert.equal(await refreshProviderModels(expectation.name), 'skipped');

  const originalModels = provider.models;
  const calls = [];
  const runtimeKey = `${expectation.name}-test-key`;

  setRuntimeApiKey(expectation.apiKeyEnvVar, runtimeKey);

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({
        object: 'list',
        data: expectation.models.map((modelId) => ({ id: modelId, object: 'model' })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (String(url).endsWith('/chat/completions')) {
      return new Response(JSON.stringify({
        id: `chatcmpl-${expectation.name}-test`,
        object: 'chat.completion',
        created: 1,
        model: expectation.models[0],
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    throw new Error(`Unexpected fetch URL for ${expectation.name}: ${url}`);
  };

  try {
    assert.equal(await refreshProviderModels(expectation.name), 'refreshed');
    assert.deepEqual(
      provider.models.map((model) => model.id),
      expectation.models,
      `Expected synced ${expectation.name} models to remain in allowlist order`,
    );

    const cachePath = path.resolve(process.cwd(), '.agentrail', 'models', `${expectation.name}.json`);
    const cache = JSON.parse(await readFile(cachePath, 'utf-8'));
    assert.equal(Array.isArray(cache.models), true, `Expected ${expectation.name} cache to be written`);
    assert.equal(cache.models.some((model) => model.id === expectation.models[0]), true);

    const health = await checkProviderHealth(expectation.name);
    assert.equal(health.state, 'healthy');

    const response = await provider.chatCompletion({
      model: `${expectation.name}/${expectation.models[0]}`,
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
    });
    assert.equal(response.ok, true);

    const modelsCall = calls.find((call) => String(call.url).endsWith('/models'));
    assert(modelsCall, `Expected a ${expectation.name} models sync request`);
    const chatCall = calls.find((call) => String(call.url).endsWith('/chat/completions'));
    assert(chatCall, `Expected a ${expectation.name} chat completion request`);
    assert.equal(chatCall.init.headers.Authorization, `Bearer ${runtimeKey}`);
    if (expectation.headerName && expectation.headerValueFromKey) {
      assert.equal(chatCall.init.headers[expectation.headerName], runtimeKey);
    }
    assert.equal(JSON.parse(String(chatCall.init.body)).model, expectation.models[0]);
  } finally {
    globalThis.fetch = originalFetch;
    provider.updateModels(originalModels);
    setRuntimeApiKey(expectation.apiKeyEnvVar, '');
  }
}

console.log('provider batch regression passed');
