import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

process.env.AGENTRAIL_SAAS = '1';
process.env.AGENTRAIL_ADMIN_EMAIL = 'admin@example.com';
process.env.AGENTRAIL_ADMIN_PASSWORD = 'supersecret';
process.env.AGENTRAIL_ADMIN_NAME = 'Platform Admin';

const { createServer } = await import('../dist/server.js');
const { setAgentRailApiKey } = await import('../dist/config.js');
const { checkProviderHealth } = await import('../dist/health.js');
const { getActiveCanonicalModelsForApi } = await import('../dist/catalog.js');
const { mergeFetchedModels } = await import('../dist/models/sync.js');
const { ensureAdminUserFromEnv } = await import('../dist/saas/auth.js');
const { providers } = await import('../dist/providers/index.js');
const { initDB } = await import('../dist/saas/db.js');

const providerByName = new Map(providers.map((provider) => [provider.name, provider]));
const root = process.cwd();
const agentrailDir = path.join(root, '.agentrail');

setAgentRailApiKey('');

async function resetSaasState() {
  await rm(agentrailDir, { recursive: true, force: true });
  await mkdir(agentrailDir, { recursive: true });
  await initDB();
  await ensureAdminUserFromEnv();
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

function getCookie(response) {
  const cookie = response.headers.get('set-cookie');
  assert(cookie, 'expected session cookie');
  return cookie.split(';', 1)[0];
}

await resetSaasState();

const server = createServer({
  routeChatCompletion: async () => {
    throw new Error('product regression should not route chat completions');
  },
});
const baseUrl = await listen(server);

try {
  const landing = await fetch(`${baseUrl}/`);
  assert.equal(landing.status, 200);
  const landingHtml = await landing.text();
  assert.match(landingHtml, /AgentRail/);
  assert.match(landingHtml, /public-shell/);
  assert.doesNotMatch(landingHtml, /dashboard-shell/);
  assert.doesNotMatch(landingHtml, /Create Account/);
  assert.doesNotMatch(landingHtml, /Local LLM Control Plane/);

  const dashboard = await fetch(`${baseUrl}/dashboard`);
  assert.equal(dashboard.status, 200);
  const dashboardHtml = await dashboard.text();
  assert.match(dashboardHtml, /dashboard-shell/);
  assert.doesNotMatch(dashboardHtml, /public-shell/);

  const registerResponse = await fetch(`${baseUrl}/api/saas/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'User', email: 'user@example.com', password: 'secret12' }),
  });
  assert.equal(registerResponse.status, 403);

  const loginResponse = await fetch(`${baseUrl}/api/saas/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'supersecret' }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json();
  assert.equal(loginBody.user.email, 'admin@example.com');
  assert.equal(loginBody.user.isAdmin, true);
  assert.equal(typeof loginBody.csrfToken, 'string');
  const sessionCookie = getCookie(loginResponse);

  const authMe = await fetch(`${baseUrl}/api/saas/auth/me`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(authMe.status, 200);
  const authMeBody = await authMe.json();
  assert.equal(authMeBody.user?.isAdmin, true);
  assert.equal(typeof authMeBody.csrfToken, 'string');

  const missingCsrfKeyResponse = await fetch(`${baseUrl}/api/saas/keys`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Blocked key' }),
  });
  assert.equal(missingCsrfKeyResponse.status, 403);

  const createKeyResponse = await fetch(`${baseUrl}/api/saas/keys`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json',
      'x-csrf-token': loginBody.csrfToken,
    },
    body: JSON.stringify({ name: 'Embeddings only', scopes: ['embeddings'] }),
  });
  assert.equal(createKeyResponse.status, 201);
  const createKeyBody = await createKeyResponse.json();
  assert.deepEqual(createKeyBody.key.scopes, ['embeddings']);

  const scopedChatAttempt = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${createKeyBody.key.key}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });
  assert.equal(scopedChatAttempt.status, 403);

  const openRouter = providerByName.get('openrouter');
  const groq = providerByName.get('groq');
  assert(openRouter);
  assert(groq);
  process.env.OPENROUTER_API_KEY = 'openrouter-key';
  process.env.GROQ_API_KEY = 'groq-key';
  process.env.CLOUDFLARE_API_KEY = '';

  const openRouterHealth = await checkProviderHealth('openrouter');
  const groqHealth = await checkProviderHealth('groq');
  assert.equal(openRouterHealth.state, 'unhealthy');
  assert.equal(groqHealth.state, 'unhealthy');

  const activeModels = getActiveCanonicalModelsForApi();
  assert.equal(activeModels.length, 0);
  assert.equal(activeModels.some((model) => model.providers.some((provider) => provider.name === 'cloudflare')), false);

  const mergedModels = mergeFetchedModels(
    [
      { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', object: 'model' },
      { id: 'nvidia/new-free-model', object: 'model' },
    ],
    [
      { id: 'llama-3.1-nemotron-ultra', providerModelId: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', modality: 'Text' },
    ],
  );
  assert.equal(mergedModels.some((model) => model.providerModelId === 'nvidia/new-free-model'), true);

  console.log('product regression checks passed');
} finally {
  await close(server);
  await rm(agentrailDir, { recursive: true, force: true });
}
