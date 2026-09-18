import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentrail-startup-probe-'));
process.chdir(tempRoot);

const { providers } = await import('../dist/providers/index.js');
const { setRuntimeApiKey } = await import('../dist/config.js');
const {
  getProviderHealth,
  loadPersistedProviderHealthSnapshot,
  persistProviderHealthSnapshot,
  setPersistedHealthSnapshotForTests,
} = await import('../dist/health.js');
const {
  runStartupProviderProbe,
  setStartupProbeDepsForTests,
} = await import('../dist/server-runtime.js');

const groqProvider = providers.find((provider) => provider.name === 'groq');
assert(groqProvider, 'Expected groq provider');

const originalGroqModels = groqProvider.models;
const originalGroqChatCompletion = groqProvider.chatCompletion.bind(groqProvider);
const originalGroqHealth = { ...getProviderHealth(groqProvider.name, false) };

const snapshotPath = path.join(tempRoot, '.agentrail', 'provider-health.json');

setRuntimeApiKey('GROQ_API_KEY', 'groq-test-key');
groqProvider.updateModels([
  {
    id: 'llama-3.3-70b',
    providerModelId: 'llama-3.3-70b-versatile',
    modality: 'Text',
    capabilities: ['chat'],
  },
]);

groqProvider.chatCompletion = async function mockGroqHealth() {
  return new Response(JSON.stringify({
    id: 'chatcmpl-startup-probe',
    object: 'chat.completion',
    created: 1,
    model: 'groq/llama-3.3-70b',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

setPersistedHealthSnapshotForTests(snapshotPath);

await persistProviderHealthSnapshot([
  {
    provider: 'groq',
    state: 'healthy',
    message: 'Previously healthy snapshot',
    checkedAt: 111,
    latencyMs: 222,
    lastStatusCode: 200,
    lastError: null,
    lastSuccessAt: 111,
    isStale: true,
    source: 'snapshot',
  },
]);

await loadPersistedProviderHealthSnapshot();

assert.equal(getProviderHealth('groq', true).isStale, true, 'expected persisted health snapshot to load as stale');

setStartupProbeDepsForTests({
  refreshConfiguredProviders: async () => ({
    refreshed: ['groq'],
    failed: [],
    skipped: [],
  }),
});

try {
  const result = await runStartupProviderProbe();
  assert.deepEqual(result.refresh.refreshed, ['groq']);
  assert.equal(result.health.some((entry) => entry.provider === 'groq' && entry.state === 'healthy'), true);

  const groqHealth = getProviderHealth('groq', true);
  assert.equal(groqHealth.state, 'healthy');
  assert.equal(groqHealth.isStale, false);
  assert.equal(groqHealth.source, 'runtime');

  const savedSnapshot = JSON.parse(await readFile(snapshotPath, 'utf-8'));
  assert.equal(Array.isArray(savedSnapshot.providers), true);
  assert.equal(savedSnapshot.providers.some((entry) => entry.provider === 'groq' && entry.state === 'healthy' && entry.isStale === false), true);
} finally {
  setStartupProbeDepsForTests(null);
  setPersistedHealthSnapshotForTests(null);
  setRuntimeApiKey('GROQ_API_KEY', '');
  groqProvider.updateModels(originalGroqModels);
  groqProvider.chatCompletion = originalGroqChatCompletion;
  Object.assign(getProviderHealth(groqProvider.name, false), originalGroqHealth);
  process.chdir(originalCwd);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('startup provider probe regression passed');
