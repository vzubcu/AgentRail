import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  buildClaudeProfileSettings,
  buildClineGlobalState,
  buildCodexProfileToml,
  buildContinueModels,
  buildKiloVscodeSettings,
  buildRooImport,
  configureClineAgent,
  configureClaudeAgentProfiles,
  configureCodexAgentProfiles,
  configureContinueAgent,
  configureKiloAgent,
  configureRooAgent,
  mergeCodexProviderConfig,
  mergeContinueConfig,
  slugifyAgentProfileName,
} = await import('../dist/agent-config.js');
const { createServer } = await import('../dist/server.js');
const { buildAgentLaunchPlan, resolveExecutable } = await import('../dist/agent-launch.js');
const { setAgentRailApiKey } = await import('../dist/config.js');

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentrail-agent-config-'));
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DASHBOARD_PARTIAL_RE = /<!--\s*partial:([a-z0-9-]+)\s*-->/gi;

async function readComposedDashboardHtml() {
  const templatesRoot = path.join(packageRoot, 'src', 'web', 'templates');
  const shell = await readFile(path.join(templatesRoot, 'dashboard.html'), 'utf8');
  const partialNames = Array.from(shell.matchAll(DASHBOARD_PARTIAL_RE), (match) => match[1]);
  const uniquePartialNames = [...new Set(partialNames)];

  if (!uniquePartialNames.length) {
    return shell;
  }

  const partialEntries = await Promise.all(
    uniquePartialNames.map(async (partialName) => {
      const partialPath = path.join(templatesRoot, 'partials', `${partialName}.html`);
      const partialContent = await readFile(partialPath, 'utf8');
      return [partialName, partialContent];
    }),
  );

  const partialMap = new Map(partialEntries);
  return shell.replace(DASHBOARD_PARTIAL_RE, (_match, partialName) => partialMap.get(partialName) ?? '');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

try {
  await setAgentRailApiKey('');
  assert.equal(slugifyAgentProfileName('agentrail/auto'), 'auto');
  assert.equal(slugifyAgentProfileName('OpenAI GPT-5.1'), 'openai-gpt-5-1');

  const duplicateSlugs = ['foo/bar', 'foo-bar', 'foo_bar'].map((value) => slugifyAgentProfileName(value));
  assert.deepEqual(duplicateSlugs, ['foo-bar', 'foo-bar', 'foo-bar']);

  const claudeSettings = JSON.parse(buildClaudeProfileSettings('agentrail/auto', 'http://localhost:42424'));
  assert.equal(claudeSettings.model, 'agentrail/auto');
  assert.equal(claudeSettings.env.ANTHROPIC_BASE_URL, 'http://localhost:42424');
  assert.equal(claudeSettings.env.ANTHROPIC_MODEL, 'agentrail/auto');
  assert.equal(claudeSettings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  assert.equal('ANTHROPIC_AUTH_TOKEN' in claudeSettings.env, false);

  const clineState = buildClineGlobalState({ existing: true }, {
    baseUrl: 'http://localhost:42424',
    model: 'agentrail/auto',
  });
  assert.equal(clineState.actModeApiProvider, 'openai');
  assert.equal(clineState.planModeApiProvider, 'openai');
  assert.equal(clineState.openAiBaseUrl, 'http://localhost:42424');
  assert.equal(clineState.openAiModelId, 'agentrail/auto');
  assert.equal(clineState.planModeOpenAiModelId, 'agentrail/auto');
  assert.equal(clineState.existing, true);

  const codexToml = buildCodexProfileToml('provider/model-name');
  assert.match(codexToml, /model_provider\s+= "agentrail"/);
  assert.match(codexToml, /model\s+= "provider\/model-name"/);

  const continueModels = buildContinueModels(
    ['agentrail/auto', 'provider/model-name'],
    'http://localhost:42424/v1',
  );
  assert.equal(continueModels.length, 2);
  assert.equal(continueModels[0].provider, 'openai');
  assert.equal(continueModels[0].apiBase, 'http://localhost:42424/v1');
  assert.equal(continueModels[0].apiKey, '${{ secrets.AGENTRAIL_API_KEY }}');

  const mergedContinue = mergeContinueConfig({
    name: 'Existing',
    models: [
      { name: 'Keep me', provider: 'openai', apiBase: 'https://example.com/v1', model: 'keep/model' },
      { name: 'AgentRail: old', provider: 'openai', apiBase: 'http://localhost:42424/v1', model: 'old/model' },
    ],
  }, continueModels, 'http://localhost:42424/v1');
  assert.equal(mergedContinue.models.length, 3);
  assert.equal(mergedContinue.models.some((entry) => entry.name === 'Keep me'), true);
  assert.equal(mergedContinue.models.some((entry) => entry.model === 'old/model'), false);

  const rooImport = buildRooImport({
    baseUrl: 'http://localhost:42424/v1',
    model: 'agentrail/auto',
  });
  assert.equal(rooImport.providerProfiles.currentApiConfigName, 'AgentRail');
  assert.equal(rooImport.providerProfiles.apiConfigs.AgentRail.openAiBaseUrl, 'http://localhost:42424/v1');
  assert.equal('openAiApiKey' in rooImport.providerProfiles.apiConfigs.AgentRail, false);

  const kiloSettings = buildKiloVscodeSettings({}, {
    baseUrl: 'http://localhost:42424/v1',
    model: 'agentrail/auto',
  });
  assert.equal(kiloSettings['kilocode.customProvider'].baseURL, 'http://localhost:42424/v1');
  assert.equal(kiloSettings['kilocode.defaultModel'], 'agentrail/auto');
  assert.equal('apiKey' in kiloSettings['kilocode.customProvider'], false);

  const merged = mergeCodexProviderConfig(
    'model = "existing"\n[model_providers.other]\nname = "Other"\n',
    'http://localhost:42424/v1',
  );
  assert.match(merged, /\[model_providers\.other\]/);
  assert.match(merged, /\[model_providers\.agentrail\]/);
  assert.match(merged, /wire_api\s+= "responses"/);
  assert.match(merged, /env_key\s+= "AGENTRAIL_API_KEY"/);

  const claudeResult = await configureClaudeAgentProfiles({
    homeDir: tempRoot,
    baseUrl: 'http://localhost:42424',
    models: [
      { id: 'agentrail/auto' },
      { id: 'foo/bar' },
      { id: 'foo-bar' },
    ],
  });
  assert.equal(claudeResult.ok, true);
  assert.equal(claudeResult.target, 'claude');
  assert.equal(claudeResult.mode, 'configured');
  assert.equal(claudeResult.written, 3);
  assert.equal(claudeResult.defaultProfile, 'agentrail-auto');
  assert.equal(Array.isArray(claudeResult.files), true);
  assert.equal(typeof claudeResult.primarySelection?.name, 'string');
  assert.equal(typeof claudeResult.env.CLAUDE_CONFIG_DIR, 'string');
  assert.equal(typeof claudeResult.env.ANTHROPIC_AUTH_TOKEN, 'string');
  assert.equal(typeof claudeResult.env.ANTHROPIC_BASE_URL, 'string');
  assert.equal(claudeResult.errors.length, 0);

  const codexResult = await configureCodexAgentProfiles({
    homeDir: tempRoot,
    baseUrl: 'http://localhost:42424',
    models: [
      { id: 'agentrail/auto' },
      { id: 'foo/bar' },
      { id: 'foo-bar' },
    ],
  });
  assert.equal(codexResult.ok, true);
  assert.equal(codexResult.target, 'codex');
  assert.equal(codexResult.mode, 'configured');
  assert.equal(codexResult.written, 3);
  assert.equal(codexResult.defaultProfile, 'agentrail-auto');
  assert.equal(codexResult.providerConfig, 'created');
  assert.equal(Array.isArray(codexResult.files), true);
  assert.equal(typeof codexResult.primarySelection?.name, 'string');
  assert.equal(typeof codexResult.env.AGENTRAIL_API_KEY, 'string');
  assert.equal(codexResult.errors.length, 0);

  const codexConfigPath = path.join(tempRoot, '.codex', 'config.toml');
  const codexConfig = await readFile(codexConfigPath, 'utf8');
  assert.match(codexConfig, /\[model_providers\.agentrail\]/);

  const firstProfile = await readFile(path.join(tempRoot, '.codex', 'agentrail-foo-bar.config.toml'), 'utf8');
  const secondProfile = await readFile(path.join(tempRoot, '.codex', 'agentrail-foo-bar-2.config.toml'), 'utf8');
  assert.notEqual(firstProfile, '');
  assert.notEqual(secondProfile, '');

  const rerun = await configureCodexAgentProfiles({
    homeDir: tempRoot,
    baseUrl: 'http://localhost:42424',
    models: [
      { id: 'agentrail/auto' },
      { id: 'foo/bar' },
      { id: 'foo-bar' },
    ],
  });
  assert.equal(rerun.providerConfig, 'unchanged');

  const customConfig = 'model = "existing"\n[model_providers.other]\nname = "Other"\n';
  await rm(codexConfigPath, { force: true });
  await configureCodexAgentProfiles({
    homeDir: tempRoot,
    baseUrl: 'http://localhost:42424',
    models: [{ id: 'agentrail/auto' }],
    existingCodexConfig: customConfig,
  });
  const mergedConfig = await readFile(codexConfigPath, 'utf8');
  assert.match(mergedConfig, /\[model_providers\.other\]/);
  assert.match(mergedConfig, /\[model_providers\.agentrail\]/);

  const continueResult = await configureContinueAgent({
    homeDir: tempRoot,
    baseUrl: 'http://localhost:42424',
    models: [
      { id: 'agentrail/auto' },
      { id: 'provider/model-name' },
    ],
  });
  assert.equal(continueResult.ok, true);
  assert.equal(continueResult.target, 'continue');
  assert.equal(continueResult.mode, 'configured');
  assert.equal(continueResult.written, 1);
  assert.equal(typeof continueResult.env.AGENTRAIL_API_KEY, 'string');
  assert.equal(typeof continueResult.primarySelection?.name, 'string');
  assert.equal(continueResult.errors.length, 0);
  const continueConfig = await readFile(path.join(tempRoot, '.continue', 'config.yaml'), 'utf8');
  assert.match(continueConfig, /AgentRail: agentrail\/auto/);
  assert.match(continueConfig, /\$\{\{ secrets\.AGENTRAIL_API_KEY \}\}/);

  const clineHome = path.join(tempRoot, 'cline-home');
  const clineResult = await configureClineAgent({
    homeDir: clineHome,
    baseUrl: 'http://localhost:42424',
    models: [{ id: 'agentrail/auto' }],
  });
  assert.equal(clineResult.ok, true);
  assert.equal(clineResult.target, 'cline');
  assert.equal(clineResult.mode, 'assisted');
  assert.equal(clineResult.written, 1);
  assert.equal(typeof clineResult.primarySelection?.modelId, 'string');
  const clineGlobalState = JSON.parse(await readFile(path.join(clineHome, '.cline', 'data', 'globalState.json'), 'utf8'));
  assert.equal(clineGlobalState.openAiBaseUrl, 'http://localhost:42424');
  assert.equal(clineGlobalState.openAiModelId, 'agentrail/auto');
  await assert.rejects(readFile(path.join(clineHome, '.cline', 'data', 'secrets.json'), 'utf8'));

  const rooHome = path.join(tempRoot, 'roo-home');
  await mkdir(path.join(rooHome, 'AppData', 'Roaming', 'Code', 'User'), { recursive: true });
  const rooResult = await configureRooAgent({
    homeDir: rooHome,
    baseUrl: 'http://localhost:42424',
    models: [{ id: 'agentrail/auto' }],
  });
  assert.equal(rooResult.ok, true);
  assert.equal(rooResult.target, 'roo');
  assert.equal(rooResult.mode, 'assisted');
  assert.equal(rooResult.written >= 1, true);
  const rooImportPath = path.join(rooHome, '.agentrail', 'roo-settings.json');
  const rooImportFile = JSON.parse(await readFile(rooImportPath, 'utf8'));
  assert.equal(rooImportFile.providerProfiles.apiConfigs.AgentRail.openAiModelId, 'agentrail/auto');
  assert.equal('openAiApiKey' in rooImportFile.providerProfiles.apiConfigs.AgentRail, false);

  const kiloHome = path.join(tempRoot, 'kilo-home');
  await mkdir(path.join(kiloHome, 'AppData', 'Roaming', 'Code', 'User'), { recursive: true });
  const kiloResult = await configureKiloAgent({
    homeDir: kiloHome,
    baseUrl: 'http://localhost:42424',
    models: [{ id: 'agentrail/auto' }],
  });
  assert.equal(kiloResult.ok, true);
  assert.equal(kiloResult.target, 'kilo');
  assert.equal(kiloResult.mode, 'assisted');
  assert.equal(kiloResult.written >= 1, true);
  const kiloSettingsPath = path.join(kiloHome, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
  const kiloSettingsFile = JSON.parse(await readFile(kiloSettingsPath, 'utf8'));
  assert.equal(kiloSettingsFile['kilocode.defaultModel'], 'agentrail/auto');
  assert.equal('apiKey' in kiloSettingsFile['kilocode.customProvider'], false);

  const resolvedCodexPath = resolveExecutable('codex', {
    platform: 'win32',
    pathValue: 'C:\\Tools;D:\\Bin',
    spawnSyncImpl: () => ({ status: null, stdout: '', stderr: '', error: new Error('spawnSync where.exe EPERM') }),
    existsSyncImpl: (candidate) => candidate == 'D:\\Bin\\codex.cmd',
  });
  assert.equal(resolvedCodexPath, 'D:\\Bin\\codex.cmd');

  const claudeLaunchPlan = buildAgentLaunchPlan({
    target: 'claude',
    baseUrl: 'http://localhost:42424',
    gatewayKey: 'demo-key',
    profileName: 'agentrail-auto',
    modelId: 'agentrail/auto',
  });
  assert.equal(claudeLaunchPlan.env.ANTHROPIC_MODEL, 'agentrail/auto');
  assert.match(claudeLaunchPlan.commandPreview, /agentrail\/auto/);

  const dashboardHtml = await readComposedDashboardHtml();
  assert.match(dashboardHtml, /CLI/i);
  assert.match(dashboardHtml, /VS Code/i);
  assert.match(dashboardHtml, /JetBrains \/ Rider/i);
  assert.match(dashboardHtml, /Junie/i);
  assert.match(dashboardHtml, /Continue/i);

  const bootstrapJs = await readFile(path.join(packageRoot, 'src', 'web', 'app', 'bootstrap.js'), 'utf8');
  assert.doesNotMatch(bootstrapJs, /quick-connect\.js/);

  const quickConnectEntry = await readFile(path.join(packageRoot, 'src', 'web', 'app', 'features', 'quick-connect', 'entry.js'), 'utf8');
  assert.match(quickConnectEntry, /createQuickConnectFeature/);
  assert.match(quickConnectEntry, /data-agent-configure/);

  const quickConnectLegacy = await readFile(path.join(packageRoot, 'src', 'web', 'static', 'quick-connect.js'), 'utf8');
  assert.match(quickConnectLegacy, /Quick-connect runtime logic now lives/);
  assert.doesNotMatch(quickConnectLegacy, /AgentRailQuickConnectDeps/);

  const launchCalls = [];
  process.env.AGENTRAIL_AGENT_CONFIG_HOME = path.join(tempRoot, 'endpoint-home');
  const endpointServer = createServer({
    launchAgentTool: async (options) => {
      launchCalls.push(options);
      return {
        ok: true,
        target: options.target,
        launched: false,
        profileName: options.profileName ?? null,
        env: options.target === 'claude'
          ? { ANTHROPIC_AUTH_TOKEN: 'demo', ANTHROPIC_BASE_URL: options.baseUrl, ANTHROPIC_MODEL: options.modelId ?? '' }
          : { AGENTRAIL_API_KEY: 'demo' },
        commandPreview: options.target === 'claude' ? 'claude' : 'codex',
        warnings: [],
        errors: [],
      };
    },
  });
  const { server, baseUrl } = await listen(endpointServer);
  try {
    const claudeResponse = await fetch(`${baseUrl}/api/agents/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'claude' }),
    });
    assert.equal(claudeResponse.status, 200);
    const claudeBody = await claudeResponse.json();
    assert.equal(claudeBody.target, 'claude');
    assert.equal(typeof claudeBody.rootPath, 'string');
    assert.equal(claudeBody.mode, 'configured');
    assert.equal(typeof claudeBody.env?.CLAUDE_CONFIG_DIR, 'string');
    assert.equal(typeof claudeBody.env?.ANTHROPIC_AUTH_TOKEN, 'string');
    assert.equal(Array.isArray(claudeBody.files), true);
    assert.equal('providerConfig' in claudeBody, false);

    const codexResponse = await fetch(`${baseUrl}/api/agents/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'codex' }),
    });
    assert.equal(codexResponse.status, 200);
    const codexBody = await codexResponse.json();
    assert.equal(codexBody.target, 'codex');
    assert.equal(typeof codexBody.rootPath, 'string');
    assert.equal(codexBody.mode, 'configured');
    assert.equal(typeof codexBody.providerConfig, 'string');
    assert.equal(typeof codexBody.env?.AGENTRAIL_API_KEY, 'string');
    assert.equal(Array.isArray(codexBody.files), true);

    for (const target of ['continue', 'cline', 'roo', 'kilo']) {
      const response = await fetch(`${baseUrl}/api/agents/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.target, target);
      assert.equal(typeof body.rootPath, 'string');
      assert.equal(Array.isArray(body.files), true);
      assert.equal(Array.isArray(body.steps), true);
      assert.equal(body.primarySelection === null || typeof body.primarySelection?.modelId === 'string', true);
    }

    const launchResponse = await fetch(`${baseUrl}/api/agents/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'codex', modelId: 'agentrail/auto', profileName: 'agentrail-auto' }),
    });
    assert.equal(launchResponse.status, 200);
    const launchBody = await launchResponse.json();
    assert.equal(launchBody.target, 'codex');
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].modelId, 'agentrail/auto');
    assert.equal(launchCalls[0].profileName, 'agentrail-auto');

    const invalidResponse = await fetch(`${baseUrl}/api/agents/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'unknown' }),
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    await close(server);
    delete process.env.AGENTRAIL_AGENT_CONFIG_HOME;
  }

  console.log('agent config regression checks passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
