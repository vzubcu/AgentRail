const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src', 'web', 'app', 'legacy-app.js');
let s = fs.readFileSync(file, 'utf8');

s = s.replace(
  "import { escapeHtml, formatTime, formatLatency, maskPlaceholder } from './lib/dom.js';",
  "import { escapeHtml, formatTime, formatLatency, formatNumber, copyText, maskPlaceholder } from './lib/dom.js';"
);

s = s.replace(
  "  getLatencyTone,\n  getProviderInitials,\n} from './lib/utils.js';",
  "  getLatencyTone,\n  getProviderInitials,\n  readOpenAIStreamEvents,\n} from './lib/utils.js';"
);

s = s.replace(
  "import { createKeysFeature } from './features/keys.js';\nimport { installQuickConnectDeps } from './compat/quick-connect-deps.js';",
  "import { createKeysFeature } from './features/keys.js';\nimport { createTestConsoleFeature } from './features/test-console.js';\nimport { createSaasShell } from './features/saas-shell.js';\nimport { createSaasAuthFeature } from './features/saas-auth.js';\nimport { createSaasDashboardFeature } from './features/saas-dashboard.js';\nimport { createSaasKeysFeature } from './features/saas-keys.js';\nimport { createSaasAdminFeature } from './features/saas-admin.js';\nimport { installQuickConnectDeps } from './compat/quick-connect-deps.js';"
);

s = s.replace(
  /const state = createAppState\(\);\r?\n\r?\nconst tabRouter = createTabRouter\([\s\S]*?\);\r?\n\r?\nlet activateTab = tabRouter\.activateTab;\r?\n\r?\nconst keysFeature = createKeysFeature\([\s\S]*?\);/,
`const state = createAppState();

let saasAuthFeature = null;
let saasDashboardFeature = null;
let saasKeysFeature = null;
let saasAdminFeature = null;

const tabRouter = createTabRouter({
  state,
  defaultTabId,
  tabPathMap,
  getProviderFromPath,
  providerPath,
  canActivateTab: (tabId, options) => saasAuthFeature ? saasAuthFeature.canActivateTab(tabId, options) : true,
  onProvidersActivated: () => {
    renderProviders();
  },
  onTabActivated: (tabId, options) => {
    if (!saasAuthFeature) return;
    if (tabId === 'saas-dashboard' && state.saasUser) {
      saasDashboardFeature?.loadSaasDashboard();
    } else if (tabId === 'saas-admin' && state.saasUser?.isAdmin) {
      saasAdminFeature?.loadSaasAdmin();
    } else if (tabId === 'saas-keys' && state.saasUser) {
      saasKeysFeature?.loadSaasKeys();
    }
  },
});

let activateTab = tabRouter.activateTab;

const keysFeature = createKeysFeature({
  state,
  fetchJSON,
  fetchJSONWithGatewayKey,
  getStoredGatewayKey,
  setStoredGatewayKey,
  isCloudflareProvider,
  escapeHtml,
  loadCatalog: async () => {
    await loadCatalog();
  },
});

const testConsoleFeature = createTestConsoleFeature({
  state,
  fetchJSON,
  withGatewayAuthHeaders,
  escapeHtml,
  formatBytes,
  getSortedProviderNames,
  formatNumber,
});

const saasShell = createSaasShell({ state });`
);

s = s.replace(/function renderTestProviderFilter\(\) \{[\s\S]*?\n\}/, `function renderTestProviderFilter() {\n  testConsoleFeature.renderProviderFilter();\n}`);
s = s.replace(/function renderTestModelOptions\(\) \{[\s\S]*?\n\}/, `function renderTestModelOptions() {\n  testConsoleFeature.renderModelOptions();\n}`);
s = s.replace(/function renderTestAttachmentQueue\(\) \{[\s\S]*?async function configureAgentCli\(target\) \{/, `function renderTestAttachmentQueue() {\n  testConsoleFeature.renderAttachmentQueue();\n}\n\nfunction renderTestThread() {\n  testConsoleFeature.renderThread();\n}\n\nasync function handleTestAttachmentSelection(event) {\n  await testConsoleFeature.handleAttachmentSelection(event);\n}\n\nasync function sendTestRequest() {\n  await testConsoleFeature.sendTestRequest();\n}\n\nfunction clearTestConversation() {\n  testConsoleFeature.clearConversation();\n}\n\nasync function configureAgentCli(target) {`);
s = s.replace(/function formatNumber\(value\) \{[\s\S]*?async function configureAgentCli\(target\) \{/, `async function configureAgentCli(target) {`);

s = s.replace(/function bindEvents\(\) \{[\s\S]*?const clearUsageBtn = document\.getElementById\('clear-usage'\);[\s\S]*?\n\}/, `function bindEvents() {\n  setupEndpointCopyButtons();\n  updateControlRoomClock();\n  window.setInterval(updateControlRoomClock, 1000);\n  const gatewayInput = document.getElementById('gateway-key');\n  if (gatewayInput) {\n    gatewayInput.value = getStoredGatewayKey();\n  }\n  document.getElementById('model-search')?.addEventListener('input', renderModels);\n  document.getElementById('model-provider-filter')?.addEventListener('change', renderModels);\n  document.getElementById('model-sort')?.addEventListener('change', renderModels);\n  document.getElementById('provider-search')?.addEventListener('input', renderProviders);\n  document.getElementById('provider-state-filter')?.addEventListener('change', renderProviders);\n  document.getElementById('save-keys')?.addEventListener('click', saveKeys);\n  document.getElementById('provider-key-modal-form')?.addEventListener('submit', addProviderKeyFromModal);\n  document.getElementById('provider-key-modal-close')?.addEventListener('click', closeProviderKeyModal);\n  document.getElementById('provider-key-modal-cancel')?.addEventListener('click', closeProviderKeyModal);\n  document.getElementById('provider-key-modal')?.addEventListener('click', event => {\n    if (event.target?.id === 'provider-key-modal') closeProviderKeyModal();\n  });\n  document.querySelectorAll('[data-agent-model-target]').forEach(select => {\n    select.addEventListener('change', () => {\n      const target = select.getAttribute('data-agent-model-target');\n      const role = select.getAttribute('data-agent-model-role') || 'setup';\n      const values = Array.from(select.selectedOptions || []).map(option => option.value).filter(Boolean);\n      state.quickConnectSelections[\`${'${target}:${role}'}\`] = role === 'launch' ? values.slice(0, 1) : values;\n    });\n  });\n  document.querySelectorAll('[data-agent-configure]').forEach(button => {\n    button.addEventListener('click', () => window.AgentRailQuickConnect?.configureAgentTool(button.getAttribute('data-agent-configure'), button.getAttribute('data-agent-result-id'), button));\n  });\n  document.querySelectorAll('[data-agent-launch]').forEach(button => {\n    button.addEventListener('click', () => window.AgentRailQuickConnect?.launchAgentToolFromDashboard(button.getAttribute('data-agent-launch'), button.getAttribute('data-agent-result-id'), button));\n  });\n  document.querySelectorAll('[data-agent-guide]').forEach(button => {\n    button.addEventListener('click', () => window.AgentRailQuickConnect?.showAgentGuide(button.getAttribute('data-agent-guide'), button.getAttribute('data-agent-result-id')));\n  });\n  testConsoleFeature.bind();\n\n  document.getElementById('check-all-health')?.addEventListener('click', async event => {\n    const button = event.currentTarget;\n    try {\n      button.disabled = true;\n      button.textContent = 'Testing all...';\n      await fetchJSON('/api/health/check-all', { method: 'POST' });\n      await loadCatalog();\n    } catch (error) {\n      alert(error.message);\n    } finally {\n      button.disabled = false;\n      button.textContent = 'Test All Providers';\n    }\n  });\n\n  document.getElementById('refresh-models')?.addEventListener('click', async event => {\n    const button = event.currentTarget;\n    try {\n      button.disabled = true;\n      button.textContent = 'Syncing...';\n      state.lastRefreshResult = await fetchJSON('/api/models/refresh', { method: 'POST' });\n      await loadCatalog();\n    } catch (error) {\n      alert(error.message);\n    } finally {\n      button.disabled = false;\n      button.textContent = 'Refresh All Models';\n    }\n  });\n\n  const clearUsageBtn = document.getElementById('clear-usage');\n  if (clearUsageBtn) {\n    clearUsageBtn.addEventListener('click', clearUsage);\n  }\n}`);

s = s.replace(/\/\* ── SaaS Auth ── \*\/[\s\S]*?export async function initLegacyApp\(\) \{[\s\S]*?\n\}/, `const saasKeysFormatCapabilityLabel = (capability) => formatCapabilityLabel(capability);\n\nsaasAuthFeature = createSaasAuthFeature({\n  state,\n  defaultTabId,\n  getTabIdFromPath,\n  activateTab: (...args) => activateTab(...args),\n  loadCatalog,\n  loadUsage,\n  shell: saasShell,\n});\n\nsaasDashboardFeature = createSaasDashboardFeature({\n  state,\n  saasFetch: (...args) => saasAuthFeature.saasFetch(...args),\n  formatNumber,\n});\n\nsaasKeysFeature = createSaasKeysFeature({\n  state,\n  saasFetch: (...args) => saasAuthFeature.saasFetch(...args),\n  formatTime,\n  escapeHtml,\n  formatCapabilityLabel: saasKeysFormatCapabilityLabel,\n  copyText,\n});\n\nsaasAdminFeature = createSaasAdminFeature({\n  state,\n  saasFetch: (...args) => saasAuthFeature.saasFetch(...args),\n  formatTime,\n  formatNumber,\n  escapeHtml,\n});\n\nexport async function initLegacyApp() {\n  setupTabs();\n  bindEvents();\n\n  try {\n    saasKeysFeature.bind();\n    saasAdminFeature.bind();\n    saasAuthFeature.bind({\n      onLoggedIn: async () => {\n        await saasDashboardFeature.loadSaasDashboard();\n        await saasKeysFeature.loadSaasKeys();\n        await saasAdminFeature.loadSaasAdmin();\n      },\n      onLoggedOut: async () => {\n        state.testConversation = [];\n        state.queuedTestAttachments = [];\n        testConsoleFeature.renderAttachmentQueue();\n        testConsoleFeature.renderThread();\n      },\n    });\n    await saasAuthFeature.checkSaasAuth();\n  } catch {\n    state.saasUser = null;\n    saasShell.updateSaasUI();\n  }\n}`);

s = s.replace(/init\(\)\.catch\([\s\S]*?\);\s*$/m, '');
fs.writeFileSync(file, s);
