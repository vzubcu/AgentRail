export function createAppState() {
  return {
    providers: [],
    models: [],
    catalogLoaded: false,
    systemPrompts: [],
    virtualModels: [],
    virtualModelsCandidates: [],
    healthSummary: null,
    syncMetas: {},
    usageRecords: [],
    virtualModelStats: [],
    lastRefreshResult: null,
    keySummaries: {},
    selectedProviderName: null,
    keyModalProviderName: null,
    keyModalEnvVar: null,
    keyModalMode: 'add',
    queuedTestAttachments: [],
    testConversation: [],
    lastAgentResults: {},
    quickConnectFilters: {},
    quickConnectSelections: {},
    saasUser: null,
    saasCsrfToken: '',
    cachedTiers: [],
  };
}

export const healthLabels = {
  missing_key: 'Missing key',
  configured: 'Configured (untested)',
  healthy: 'Healthy',
  unhealthy: 'Unhealthy',
};

export const defaultTabId = 'saas-dashboard';
export const tabPathMap = {
  'saas-dashboard': '/dashboard',
  providers: '/providers',
  models: '/models',
  'system-prompts': '/system-prompts',
  'virtual-models': '/virtual-models',
  usage: '/usage',
  keys: '/keys',
  'quick-connect': '/quick-connect',
  compression: '/compression',
  'mcp-servers': '/mcp-servers',
  skills: '/skills',
  memory: '/memory',
  quota: '/quota',
  test: '/test',
  'saas-admin': '/admin',
  'saas-keys': '/account/keys',
  'settings': '/settings',
};

export const pathTabMap = Object.fromEntries(
  Object.entries(tabPathMap).map(([tabId, routePath]) => [routePath, tabId])
);

