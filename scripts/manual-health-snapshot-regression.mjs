process.env.AGENTRAIL_SAAS = '0';
process.env.HOST = '127.0.0.1';
process.env.AGENTRAIL_API_KEY = '';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentrail-health-route-'));
process.chdir(tempRoot);

const { providers } = await import('../dist/providers/index.js');
const { setRuntimeApiKey } = await import('../dist/config.js');
const { createServer } = await import('../dist/server.js');
const { getProviderHealth, setPersistedHealthSnapshotForTests } = await import('../dist/health.js');

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
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
setPersistedHealthSnapshotForTests(snapshotPath);

const server = createServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject);
    resolve();
  });
});
const address = server.address();
assert(address && typeof address === 'object' && 'port' in address, 'Expected bound server address');

try {
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health/check/groq`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload?.health?.state, 'healthy');

  const savedSnapshot = JSON.parse(await readFile(snapshotPath, 'utf-8'));
  assert.equal(Array.isArray(savedSnapshot.providers), true);
  assert.equal(savedSnapshot.providers.some((entry) => entry.provider === 'groq' && entry.state === 'healthy' && entry.isStale === false), true);
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  setPersistedHealthSnapshotForTests(null);
  setRuntimeApiKey('GROQ_API_KEY', '');
  groqProvider.updateModels(originalGroqModels);
  groqProvider.chatCompletion = originalGroqChatCompletion;
  Object.assign(getProviderHealth(groqProvider.name, false), originalGroqHealth);
  process.chdir(originalCwd);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('manual health snapshot persistence regression passed');


