import { createDashboardRenderer } from './dashboard-render.js';
import { bindDashboardEvents } from './dashboard-bindings.js';
import { createAppState, healthLabels, defaultTabId, tabPathMap } from './state.js';
import { getStoredGatewayKey, setStoredGatewayKey, withGatewayAuthHeaders, fetchJSON, fetchJSONWithGatewayKey } from './lib/http.js';
import { escapeHtml, formatTime, formatNumber, formatBytes, copyText } from './lib/dom.js';
import { createTabRouter } from './lib/router.js';
import { createRequestStatusReporter } from './lib/request-status.js';
import {
  getProviderHealthState,
  isCloudflareProvider,
  getProviderFromPath,
  providerPath,
  getRouteMeta,
  getLatencyTone,
  getProviderInitials,
} from './lib/utils.js';
import { createKeysFeature } from './features/keys.js';
import { createTestConsoleFeature } from './features/test-console.js';
import { createSaasShell } from './features/saas-shell.js';
import { createSaasAuthFeature } from './features/saas-auth.js';
import { createSaasDashboardFeature } from './features/saas-dashboard.js';
import { createSaasKeysFeature } from './features/saas-keys.js';
import { createSaasAdminFeature } from './features/saas-admin.js';
import { createDashboardOverviewFeature } from './features/dashboard-overview.js';
import { createModelsFeature, formatCapabilityLabel } from './features/models.js';
import { createUsageFeature } from './features/usage.js';
import { createCatalogFeature } from './features/catalog.js';
import { createProvidersFeature } from './features/providers.js';
import { createQuickConnectFeature } from './features/quick-connect/entry.js';
import { createSystemPromptsFeature } from './features/system-prompts.js';
import { createVirtualModelsFeature } from './features/virtual-models.js';
import { createMcpServersFeature } from './features/mcp-servers.js';
import { createQuotaFeature } from './features/quota.js';

export async function initDashboardApp() {
  const state = createAppState();
  const saasShell = createSaasShell({ state });

  let saasAuthFeature = null;
  let saasDashboardFeature = null;
  let saasKeysFeature = null;
  let saasAdminFeature = null;
  let providersFeature = null;
  let catalogFeature = null;
  let systemPromptsFeature = null;
  let virtualModelsFeature = null;
  let mcpServersFeature = null;

  function loadCatalogIfNeeded(message) {
    if (!state.catalogLoaded) {
      catalogFeature?.loadCatalog().catch(error => reportStatus({
        level: 'error',
        message,
        details: error.message,
      }));
    }
  }

  const tabRouter = createTabRouter({
    state,
    defaultTabId,
    tabPathMap,
    getProviderFromPath,
    providerPath,
    canActivateTab: (tabId, options) => saasAuthFeature ? saasAuthFeature.canActivateTab(tabId, options) : true,
    onProvidersActivated: () => {
      providersFeature?.renderProviders();
      loadCatalogIfNeeded('Failed to load provider catalog.');
    },
    onSystemPromptsActivated: () => {
      systemPromptsFeature?.loadSystemPrompts();
    },
    onVirtualModelsActivated: () => {
      virtualModelsFeature?.loadVirtualModels();
    },
    onMcpServersActivated: () => {
      mcpServersFeature?.refresh();
    },
    onTabActivated: (tabId) => {
      if (!saasAuthFeature) return;
      if (tabId === 'saas-dashboard' && state.saasUser) {
        saasDashboardFeature?.loadSaasDashboard();
      } else if (tabId === 'saas-admin' && state.saasUser?.isAdmin) {
        saasAdminFeature?.loadSaasAdmin();
      } else if (tabId === 'saas-keys' && state.saasUser) {
        saasKeysFeature?.loadSaasKeys();
      } else if (tabId === 'models') {
        loadCatalogIfNeeded('Failed to load model catalog.');
      } else if (tabId === 'system-prompts') {
        systemPromptsFeature?.loadSystemPrompts();
      } else if (tabId === 'virtual-models') {
        virtualModelsFeature?.loadVirtualModels();
      } else if (tabId === 'mcp-servers') {
        mcpServersFeature?.refresh();
      } else if (tabId === 'quota') {
        quotaFeature?.load();
      }
    },
  });

  const activateTab = (...args) => tabRouter.activateTab(...args);
  const getTabIdFromPath = pathname => tabRouter.getTabIdFromPath(pathname);
  const reportStatus = createRequestStatusReporter({ escapeHtml, formatTime });

  const keysFeature = createKeysFeature({
    state,
    fetchJSON,
    fetchJSONWithGatewayKey,
    getStoredGatewayKey,
    setStoredGatewayKey,
    isCloudflareProvider,
    escapeHtml,
    reportStatus,
    loadCatalog: async () => {
      await catalogFeature?.loadCatalog();
    },
  });

  const modelsFeature = createModelsFeature({
    state,
    escapeHtml,
    formatNumber,
    copyText,
  });

  const testConsoleFeature = createTestConsoleFeature({
    state,
    fetchJSON,
    withGatewayAuthHeaders,
    escapeHtml,
    formatBytes,
    getSortedProviderNames: () => modelsFeature.getSortedProviderNames(),
    formatNumber,
    reportStatus,
  });

  const usageFeature = createUsageFeature({
    state,
    fetchJSON,
    escapeHtml,
    formatNumber,
    formatTime,
  });

  systemPromptsFeature = createSystemPromptsFeature({
    state,
    fetchJSON,
    escapeHtml,
  });

  virtualModelsFeature = createVirtualModelsFeature({
    state,
    fetchJSON,
    escapeHtml,
    activateTab,
  });

  mcpServersFeature = createMcpServersFeature({
    state,
    fetchJSON,
    escapeHtml,
    reportStatus,
    activateTab,
    formatTime,
  });

  const quotaFeature = createQuotaFeature({ fetchJSON, escapeHtml });

  const dashboardOverviewFeature = createDashboardOverviewFeature({
    state,
    healthLabels,
    getProviderHealthState,
    escapeHtml,
    formatLatency: value => value == null ? '—' : `${Math.round(value)} ms`,
    formatTime,
    copyText,
    activateTab,
    providerPath,
  });

  const quickConnectFeature = createQuickConnectFeature({
    state,
    fetchJSON,
    fetchJSONWithGatewayKey,
    getStoredGatewayKey,
    setStoredGatewayKey,
    escapeHtml,
    copyText,
  });

  const renderer = createDashboardRenderer({
    dashboardOverviewFeature,
    getOpenProviderDetail: () => providerName => providersFeature?.openProviderDetail(providerName),
    getProvidersFeature: () => providersFeature,
    usageFeature,
    modelsFeature,
    keysFeature,
    testConsoleFeature,
    quickConnectFeature,
  });

  catalogFeature = createCatalogFeature({
    state,
    fetchJSON,
    getProviderFromPath,
    keysFeature,
    renderAll: () => renderer.renderAll(),
  });

  providersFeature = createProvidersFeature({
    state,
    healthLabels,
    keysFeature,
    reportStatus,
    getProviderHealthState,
    isCloudflareProvider,
    providerPath,
    getRouteMeta,
    getLatencyTone,
    getProviderInitials,
    escapeHtml,
    formatLatency: value => value == null ? '—' : `${Math.round(value)} ms`,
    formatTime,
    loadCatalog: async () => {
      await catalogFeature.loadCatalog();
    },
    activateTab,
  });

  saasAuthFeature = createSaasAuthFeature({
    state,
    defaultTabId,
    getTabIdFromPath,
    activateTab,
    loadCatalog: async () => {
      await catalogFeature.loadCatalog();
    },
    loadUsage: async () => {
      await usageFeature.loadUsage();
    },
    shell: saasShell,
  });

  saasDashboardFeature = createSaasDashboardFeature({
    state,
    saasFetch: (...args) => saasAuthFeature.saasFetch(...args),
    formatNumber,
    copyText,
  });

  saasKeysFeature = createSaasKeysFeature({
    state,
    saasFetch: (...args) => saasAuthFeature.saasFetch(...args),
    formatTime,
    escapeHtml,
    formatCapabilityLabel,
    copyText,
  });

  saasAdminFeature = createSaasAdminFeature({
    state,
    saasFetch: (...args) => saasAuthFeature.saasFetch(...args),
    formatTime,
    formatNumber,
    escapeHtml,
  });

  tabRouter.setupTabs();
  bindDashboardEvents({
    dashboardOverviewFeature,
    catalogFeature,
    getStoredGatewayKey,
    keysFeature,
    modelsFeature,
    providersFeature,
    quickConnectFeature,
    state,
    testConsoleFeature,
    usageFeature,
    fetchJSON,
    reportStatus,
    mcpServersFeature,
    saasDashboardFeature,
  });

  try {
    mcpServersFeature.bind();
    saasKeysFeature.bind();
    saasAdminFeature.bind();
    saasAuthFeature.bind({
      onLoggedIn: async () => {
        await saasDashboardFeature.loadSaasDashboard();
        await saasKeysFeature.loadSaasKeys();
        await saasAdminFeature.loadSaasAdmin();
      },
      onLoggedOut: async () => {
        state.testConversation = [];
        state.queuedTestAttachments = [];
        testConsoleFeature.renderAttachmentQueue();
        testConsoleFeature.renderThread();
      },
    });
    await saasAuthFeature.checkSaasAuth();
  } catch {
    state.saasUser = null;
    saasShell.updateSaasUI();
  }
}
