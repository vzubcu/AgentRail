import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentrail-oauth-model-sync-'));
process.chdir(tempRoot);

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
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

function sendJson(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const geminiModelRequests = [];

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const modelServer = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(404).end();
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/claude/v1/models') {
    assert.equal(req.headers['x-api-key'], 'claude-oauth-token');
    sendJson(res, {
      data: [
        { id: 'claude-sonnet-4-6', object: 'model' },
        { id: 'claude-opus-4-8', object: 'model' },
      ],
      object: 'list',
    });
    return;
  }

  if (url.pathname === '/codex/models') {
    assert.equal(req.headers.authorization, 'Bearer codex-oauth-token');
    sendJson(res, {
      data: [
        { id: 'o3', object: 'model' },
        { id: 'o4-mini', object: 'model' },
        { id: 'gpt-5.3-codex', object: 'model' },
      ],
      object: 'list',
    });
    return;
  }

  if (url.pathname === '/codex/responses') {
    assert.equal(req.headers.authorization, 'Bearer codex-oauth-token');
    const body = await readRequestJson(req);
    assert.equal(body.store, false, 'Codex /responses probes should explicitly disable stored responses');
    assert.equal(body.stream, true, 'Codex /responses probes should use streaming because some Codex models require it');
    if (body.model !== 'o3' && body.model !== 'codex-safe-test') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: `The '${body.model}' model is not supported when using Codex with a ChatGPT account.` }));
      return;
    }

    sendJson(res, {
      id: 'resp_test_codex_health',
      model: 'o3',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'pong' }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    return;
  }

  if (url.pathname === '/v1beta/models') {
    const authMode = req.headers.authorization === 'Bearer gemini-oauth-token'
      ? 'oauth'
      : req.headers['x-goog-api-key'] === 'google-test-key'
        ? 'api-key'
        : 'unknown';
    assert.notEqual(authMode, 'unknown');
    geminiModelRequests.push({
      authMode,
      pageToken: url.searchParams.get('pageToken'),
    });

    if (url.searchParams.get('pageToken') === 'second-page') {
      sendJson(res, {
        models: [
          {
            name: 'models/gemini-test-generate-content',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/lyria-3-pro-preview',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      });
      return;
    }

    sendJson(res, {
      models: [
        {
          name: 'models/gemini-2.5-pro',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/antigravity-preview-05-2026',
          supportedGenerationMethods: ['interactions'],
        },
        {
          name: 'models/gemini-3.1-flash-image',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          name: 'models/nano-banana-pro-preview',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          name: 'models/gemini-embedding-2-preview',
          supportedGenerationMethods: ['embedContent'],
        },
        {
          name: 'models/gemini-3.1-flash-live-preview',
          supportedGenerationMethods: ['bidiGenerateContent'],
        },
      ],
      nextPageToken: 'second-page',
    });
    return;
  }

  res.writeHead(404).end();
});

const baseUrl = await listen(modelServer);

const { buildCatalogSummary, getActiveCanonicalModelsForApi } = await import('../dist/catalog.js');
const { setRuntimeApiKey } = await import('../dist/config.js');
const { checkProviderHealth, getProviderHealth } = await import('../dist/health.js');
const { clearOAuthToken, setOAuthToken } = await import('../dist/oauth-store.js');
const { providers, loadAllModelCaches, refreshProviderModels } = await import('../dist/providers/index.js');
const { saveBlockedModelIds } = await import('../dist/providers/base.js');
const { isUnsupportedModelResponse } = await import('../dist/providers/model-failures.js');

const claudeProvider = providers.find((provider) => provider.name === 'claude');
const codexProvider = providers.find((provider) => provider.name === 'codex');
const googleProvider = providers.find((provider) => provider.name === 'google');
const geminiProvider = providers.find((provider) => provider.name === 'gemini');

assert(claudeProvider, 'Expected claude provider');
assert(codexProvider, 'Expected codex provider');
assert(googleProvider, 'Expected google provider');
assert(geminiProvider, 'Expected gemini provider');

const originalClaudeModels = claudeProvider.models;
const originalCodexModels = codexProvider.models;
const originalGoogleModels = googleProvider.models;
const originalGeminiModels = geminiProvider.models;
const originalClaudeBaseUrl = claudeProvider.baseURL;
const originalCodexBaseUrl = codexProvider.baseURL;
const originalGoogleBaseUrl = googleProvider.baseURL;
const originalGeminiBaseUrl = geminiProvider.baseURL;

assert.equal(
  originalCodexBaseUrl,
  'https://chatgpt.com/backend-api/codex',
  'Default Codex OAuth transport should target the Codex backend namespace, not the generic ChatGPT backend root',
);
assert.equal(
  originalCodexModels.some((model) => model.id.startsWith('gpt-5.3-codex')),
  false,
  'ChatGPT-account Codex OAuth catalog should not include gpt-5.3-codex models rejected by the Codex backend',
);

await setOAuthToken('claude', {
  provider: 'claude',
  accessToken: 'claude-oauth-token',
  expiresAt: Date.now() + 60000,
});
await setOAuthToken('codex', {
  provider: 'codex',
  accessToken: 'codex-oauth-token',
  expiresAt: Date.now() + 60000,
});
await setOAuthToken('gemini', {
  provider: 'gemini',
  accessToken: 'gemini-oauth-token',
  expiresAt: Date.now() + 60000,
});

setRuntimeApiKey('ANTHROPIC_API_KEY', '');
setRuntimeApiKey('CODEX_API_KEY', '');
setRuntimeApiKey('CODEX_MODEL_CANDIDATES', 'codex-safe-test, gpt-5.3-codex-spark');
setRuntimeApiKey('GEMINI_API_KEY', 'google-test-key');

claudeProvider.baseURL = `${baseUrl}/claude`;
codexProvider.baseURL = `${baseUrl}/codex`;
googleProvider.baseURL = `${baseUrl}/v1beta/openai`;
geminiProvider.baseURL = `${baseUrl}/v1beta/models`;

try {
  assert.equal(await refreshProviderModels('claude'), 'refreshed');
  assert.equal(claudeProvider.models.some((model) => model.id === 'claude-sonnet-4-6'), true);

  assert.equal(await refreshProviderModels('codex'), 'refreshed');
  assert.equal(codexProvider.models.some((model) => model.id === 'o3'), true);
  assert.equal(codexProvider.models.some((model) => model.id === 'codex-safe-test'), true);
  assert.equal(codexProvider.models.some((model) => model.id === 'o4-mini'), false);
  assert.equal(codexProvider.models.some((model) => model.id === 'gpt-5.3-codex'), false);
  assert.equal(codexProvider.models.some((model) => model.id === 'gpt-5.3-codex-spark'), false);

  await saveBlockedModelIds('codex', new Set(originalCodexModels.map((model) => model.id)));
  await loadAllModelCaches();
  assert.equal(codexProvider.models.some((model) => model.id === 'codex-safe-test'), true);
  assert.equal(codexProvider.models.some((model) => originalCodexModels.some((original) => original.id === model.id)), false, 'Codex should not recover unverified static defaults while loading an exhausted persisted blocklist');
  codexProvider.updateModels([]);
  const blockedCodexHealth = await checkProviderHealth('codex');
  assert.equal(
    blockedCodexHealth.failureReason,
    'no_models',
    'OAuth-connected Codex with no verified models should report no models instead of recovering static defaults',
  );
  assert.equal(
    blockedCodexHealth.message,
    'No verified models configured for provider',
    'OAuth-connected Codex should report no verified models instead of static recovery',
  );
  assert.equal(await refreshProviderModels('codex'), 'refreshed');

  assert.equal(await refreshProviderModels('google'), 'refreshed');
  assert.equal(googleProvider.models.some((model) => model.id === 'gemini-2.5-pro'), true);
  assert.equal(googleProvider.models.some((model) => model.id === 'gemini-test-generate-content'), true);
  assert.equal(googleProvider.models.some((model) => model.id === 'antigravity-preview-05-2026'), false);
  assert.equal(googleProvider.models.some((model) => model.id === 'gemini-3.1-flash-image'), false);
  assert.equal(googleProvider.models.some((model) => model.id === 'nano-banana-pro-preview'), false);
  assert.equal(googleProvider.models.some((model) => model.id === 'lyria-3-pro-preview'), false);

  assert.equal(await refreshProviderModels('gemini'), 'refreshed');
  assert.equal(geminiProvider.models.some((model) => model.id === 'gemini-2.5-pro'), true);
  assert.equal(geminiProvider.models.some((model) => model.id === 'gemini-test-generate-content'), true);
  assert.equal(geminiProvider.models.some((model) => model.id === 'antigravity-preview-05-2026'), false);
  assert.equal(geminiProvider.models.some((model) => model.id === 'gemini-3.1-flash-image'), false);
  assert.equal(geminiProvider.models.some((model) => model.id === 'nano-banana-pro-preview'), false);
  assert.equal(geminiProvider.models.some((model) => model.id === 'lyria-3-pro-preview'), false);
  assert.deepEqual(
    new Set(geminiModelRequests.map((request) => request.authMode)),
    new Set(['api-key', 'oauth']),
  );
  assert.equal(geminiModelRequests.some((request) => request.pageToken === 'second-page'), true);
  assert.equal(
    isUnsupportedModelResponse(400, '{"error":{"message":"This model only supports Interactions API."}}'),
    true,
  );

  const geminiCachePath = path.join(tempRoot, '.agentrail', 'models', 'gemini.json');
  await writeFile(geminiCachePath, JSON.stringify({
    updatedAt: Date.now(),
    models: [
      { id: 'gemini-2.5-pro', providerModelId: 'gemini-2.5-pro', modality: 'Text', capabilities: ['chat'] },
      { id: 'antigravity-preview-05-2026', providerModelId: 'antigravity-preview-05-2026', modality: 'Text', capabilities: ['chat'] },
    ],
  }));
  geminiProvider.baseURL = `${baseUrl}/missing-models`;
  assert.equal(await refreshProviderModels('gemini'), 'refreshed');
  assert.equal(geminiProvider.models.some((model) => model.id === 'gemini-2.5-pro'), true);
  assert.equal(geminiProvider.models.some((model) => model.id === 'antigravity-preview-05-2026'), false);
  geminiProvider.baseURL = `${baseUrl}/v1beta/models`;
  assert.equal(await refreshProviderModels('gemini'), 'refreshed');

  const now = Date.now();
  Object.assign(getProviderHealth('claude', true), { state: 'healthy', checkedAt: now, isStale: false });
  Object.assign(getProviderHealth('codex', true), { state: 'healthy', checkedAt: now, isStale: false });
  Object.assign(getProviderHealth('gemini', true), { state: 'healthy', checkedAt: now, isStale: false });

  const activeModels = getActiveCanonicalModelsForApi();
  assert.equal(activeModels.some((model) => model.id === 'claude-sonnet-4-6' && model.providers.some((provider) => provider.name === 'claude')), true);
  assert.equal(activeModels.some((model) => model.id === 'o3' && model.providers.some((provider) => provider.name === 'codex')), true);
  assert.equal(activeModels.some((model) => model.id === 'codex-safe-test' && model.providers.some((provider) => provider.name === 'codex')), true);
  assert.equal(activeModels.some((model) => model.id.startsWith('gpt-5.3-codex') && model.providers.some((provider) => provider.name === 'codex')), false);
  assert.equal(activeModels.some((model) => model.id === 'gemini-2.5-pro' && model.providers.some((provider) => provider.name === 'gemini')), true);
  assert.equal(activeModels.some((model) => model.id === 'antigravity-preview-05-2026' && model.providers.some((provider) => ['google', 'gemini'].includes(provider.name))), false);

  const catalog = buildCatalogSummary();
  assert.equal(catalog.models.some((model) => model.id === 'claude-sonnet-4-6'), true);
  assert.equal(catalog.models.some((model) => model.id === 'o3'), true);
  assert.equal(catalog.models.some((model) => model.id === 'codex-safe-test'), true);
  assert.equal(catalog.models.some((model) => model.id.startsWith('gpt-5.3-codex')), false);
  assert.equal(catalog.models.some((model) => model.id === 'gemini-2.5-pro'), true);

  await clearOAuthToken('gemini');
  setRuntimeApiKey('GEMINI_API_KEY', '');
  assert.equal(await refreshProviderModels('gemini'), 'skipped');
} finally {
  claudeProvider.updateModels(originalClaudeModels);
  codexProvider.updateModels(originalCodexModels);
  googleProvider.updateModels(originalGoogleModels);
  geminiProvider.updateModels(originalGeminiModels);
  claudeProvider.baseURL = originalClaudeBaseUrl;
  codexProvider.baseURL = originalCodexBaseUrl;
  googleProvider.baseURL = originalGoogleBaseUrl;
  geminiProvider.baseURL = originalGeminiBaseUrl;
  setRuntimeApiKey('ANTHROPIC_API_KEY', '');
  setRuntimeApiKey('CODEX_API_KEY', '');
  setRuntimeApiKey('CODEX_MODEL_CANDIDATES', '');
  setRuntimeApiKey('GEMINI_API_KEY', '');
  await clearOAuthToken('claude');
  await clearOAuthToken('codex');
  await clearOAuthToken('gemini');
  await close(modelServer);
  process.chdir(originalCwd);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('oauth model sync regression passed');
