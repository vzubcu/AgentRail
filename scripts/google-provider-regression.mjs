import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildCatalogSummary, listProviderEnvVars } from '../dist/catalog.js';
import { checkProviderHealth, getProviderHealth } from '../dist/health.js';
import { setRuntimeApiKey } from '../dist/config.js';
import { getProviderByName, refreshProviderModels } from '../dist/providers/index.js';

const googleProvider = getProviderByName('google');
assert(googleProvider, 'Expected google provider to be registered');
assert.equal(googleProvider.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai');
assert.equal(googleProvider.apiKeyEnvVar, 'GEMINI_API_KEY');
assert.deepEqual(
  googleProvider.originalModels.map((model) => model.id),
  [
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ],
  'Expected the configured Gemini fallback allowlist',
);

assert.equal(listProviderEnvVars().includes('GEMINI_API_KEY'), true, 'Expected GEMINI_API_KEY to be configurable');

const providerSummary = buildCatalogSummary().providers.find((provider) => provider.name === 'google');
assert(providerSummary, 'Expected google provider in catalog summary');
assert.equal(providerSummary.apiKeyEnvVar, 'GEMINI_API_KEY');
assert.equal(providerSummary.available, false);
assert.equal(providerSummary.health.state, 'missing_key');

assert.equal(getProviderHealth('google', false).state, 'missing_key');
assert.equal((await checkProviderHealth('google')).state, 'missing_key');
assert.equal(await refreshProviderModels('google'), 'skipped');

const originalModels = googleProvider.models;
const originalFetch = globalThis.fetch;
const calls = [];

setRuntimeApiKey('GEMINI_API_KEY', 'google-test-key');

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });

  if (new URL(String(url)).pathname.endsWith('/models')) {
    return new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/antigravity-preview-05-2026', supportedGenerationMethods: ['interactions'] },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (String(url).endsWith('/chat/completions')) {
    return new Response(JSON.stringify({
      id: 'chatcmpl-google-test',
      object: 'chat.completion',
      created: 1,
      model: 'gemini-3.5-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  throw new Error(`Unexpected fetch URL: ${url}`);
};

try {
  assert.equal(await refreshProviderModels('google'), 'refreshed');
  assert.deepEqual(
    googleProvider.models.map((model) => model.id),
    ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
    'Expected synced Google models to remain in the allowlist order',
  );

  const cachePath = path.resolve(process.cwd(), '.agentrail', 'models', 'google.json');
  const cache = JSON.parse(await readFile(cachePath, 'utf-8'));
  assert.equal(Array.isArray(cache.models), true, 'Expected google cache to be written');
  assert.equal(cache.models.some((model) => model.id === 'gemini-3.5-flash'), true);

  const health = await checkProviderHealth('google');
  assert.equal(health.state, 'healthy');

  const response = await googleProvider.chatCompletion({
    model: 'google/gemini-3.5-flash',
    messages: [{ role: 'user', content: 'ping' }],
    stream: false,
  });
  assert.equal(response.ok, true);

  const modelsCall = calls.find((call) => new URL(String(call.url)).pathname.endsWith('/models'));
  assert(modelsCall, 'Expected a Google models sync request');
  assert.equal(modelsCall.init.headers['x-goog-api-key'], 'google-test-key');
  const chatCall = calls.find((call) => String(call.url).endsWith('/chat/completions'));
  assert(chatCall, 'Expected a Google chat completion request');
  assert.equal(chatCall.init.headers.Authorization, 'Bearer google-test-key');
  assert.equal(JSON.parse(String(chatCall.init.body)).model, 'gemini-3.5-flash');
} finally {
  globalThis.fetch = originalFetch;
  googleProvider.updateModels(originalModels);
  setRuntimeApiKey('GEMINI_API_KEY', '');
}

console.log('google provider regression passed');
