import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) {
        this.values.delete(name);
        return false;
      }
      this.values.add(name);
      return true;
    }
    if (force) this.values.add(name);
    else this.values.delete(name);
    return force;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor({ id = '', classes = [], dataset = {}, selectorMap = {}, textContent = '', hidden = false } = {}) {
    this.id = id;
    this.dataset = { ...dataset };
    this.classList = new FakeClassList(classes);
    this.selectorMap = selectorMap;
    this.textContent = textContent;
    this.hidden = hidden;
    this.value = '';
    this.placeholder = '';
    this.required = false;
    this.focused = false;
    this.innerHTML = '';
  }

  focus() {
    this.focused = true;
  }

  querySelector(selector) {
    const value = this.selectorMap[selector];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  querySelectorAll(selector) {
    const value = this.selectorMap[selector];
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }
}

const title = new FakeElement({ id: 'provider-key-modal-title' });
const primaryLabel = new FakeElement();
const primaryInput = new FakeElement({ id: 'provider-key-modal-input' });
const secondaryGroup = new FakeElement({ id: 'provider-key-modal-secondary-group', hidden: true });
const secondaryLabel = new FakeElement();
const secondaryInput = new FakeElement({ id: 'provider-key-modal-secondary-input' });
const instructions = new FakeElement({ id: 'provider-key-modal-instructions', hidden: true });
const instructionsList = new FakeElement({ id: 'provider-key-modal-instructions-list' });
const submitButton = new FakeElement({ textContent: 'Add key' });
const modal = new FakeElement({
  id: 'provider-key-modal',
  hidden: true,
  selectorMap: {
    'button[type="submit"]': submitButton,
  },
});

const tabButtons = [
  new FakeElement({ classes: ['tab-btn', 'active'], dataset: { tab: 'saas-dashboard' } }),
  new FakeElement({ classes: ['tab-btn'], dataset: { tab: 'providers' } }),
  new FakeElement({ classes: ['tab-btn'], dataset: { tab: 'virtual-models' } }),
];
const tabPanels = [
  new FakeElement({ id: 'saas-dashboard', classes: ['tab-content', 'active'] }),
  new FakeElement({ id: 'providers', classes: ['tab-content'] }),
  new FakeElement({ id: 'virtual-models', classes: ['tab-content'] }),
];

const elementById = new Map([
  ['provider-key-modal', modal],
  ['provider-key-modal-title', title],
  ['provider-key-modal-input', primaryInput],
  ['provider-key-modal-secondary-group', secondaryGroup],
  ['provider-key-modal-secondary-input', secondaryInput],
  ['provider-key-modal-instructions', instructions],
  ['provider-key-modal-instructions-list', instructionsList],
  ['saas-dashboard', tabPanels[0]],
  ['providers', tabPanels[1]],
  ['virtual-models', tabPanels[2]],
]);

const queryMap = new Map([
  ['label[for="provider-key-modal-input"]', primaryLabel],
  ['label[for="provider-key-modal-secondary-input"]', secondaryLabel],
  ['.tab-btn', tabButtons],
  ['.tab-content', tabPanels],
  ['.tab-btn[data-tab="saas-dashboard"]', tabButtons[0]],
  ['.tab-btn[data-tab="providers"]', tabButtons[1]],
  ['.tab-btn[data-tab="virtual-models"]', tabButtons[2]],
]);

const historyCalls = [];
const popstateHandlers = [];

globalThis.document = {
  getElementById(id) {
    return elementById.get(id) ?? null;
  },
  querySelector(selector) {
    const value = queryMap.get(selector);
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  },
  querySelectorAll(selector) {
    const value = queryMap.get(selector);
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  },
};

globalThis.window = {
  location: { pathname: '/dashboard' },
  history: {
    pushState(state, _title, path) {
      historyCalls.push({ method: 'pushState', state, path });
      globalThis.window.location.pathname = path;
    },
    replaceState(state, _title, path) {
      historyCalls.push({ method: 'replaceState', state, path });
      globalThis.window.location.pathname = path;
    },
  },
  addEventListener(event, handler) {
    if (event === 'popstate') popstateHandlers.push(handler);
  },
};

const { createTabRouter } = await import('../src/web/app/lib/router.js');
const { createKeysFeature } = await import('../src/web/app/features/keys.js');
const { renderProviderDetailView } = await import('../src/web/app/features/providers/render-detail.js');

const keysTemplate = await readFile(new URL('../src/web/templates/partials/keys.html', import.meta.url), 'utf8');
assert.match(keysTemplate, /id="provider-key-modal-instructions"/);
assert.match(keysTemplate, /id="provider-key-modal-instructions-list"/);

const state = {
  providers: [
    {
      name: 'cloudflare',
      apiKeyEnvVar: 'CLOUDFLARE_API_KEY',
      envVars: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
    },
    {
      name: 'kimi',
      apiKeyEnvVar: 'KIMI_API_KEY',
      envVars: ['KIMI_API_KEY'],
      website: 'https://platform.moonshot.cn',
      baseURL: 'https://api.moonshot.cn/v1',
      health: {
        state: 'unhealthy',
        message: 'Provider unavailable',
        failureReason: 'http_error',
        failureContext: {
          provider: 'kimi',
          envVar: 'KIMI_API_KEY',
          keyFingerprint: 'abcd1234ef567890',
          unhealthyKeyFingerprint: 'abcd1234ef567890',
          attemptedKeyOrder: ['abcd1234ef567890', 'ffffeeee11112222'],
          checkedAt: 1721640000000,
          modelId: 'kimi-k2',
          statusCode: 429,
          lastError: 'HTTP 429: rate limit exceeded',
        },
      },
      apiKeyInstructions: [
        'Sign in to Moonshot AI Platform: https://platform.moonshot.cn.',
        'Open API Keys in the console: https://platform.moonshot.cn/console/api-keys.',
        'Create a new API key and copy it here.',
      ],
    },
  ],
  selectedProviderName: null,
  keyModalProviderName: null,
  keyModalEnvVar: null,
  keyModalMode: 'add',
};

const router = createTabRouter({
  state,
  defaultTabId: 'saas-dashboard',
  tabPathMap: {
    'saas-dashboard': '/dashboard',
    providers: '/providers',
    'virtual-models': '/virtual-models',
  },
  getProviderFromPath(pathname = globalThis.window.location.pathname) {
    const match = pathname.match(/^\/providers\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  },
  providerPath(providerName) {
    return `/providers/${encodeURIComponent(providerName)}`;
  },
  onProvidersActivated() {},
});

router.activateTab('providers', { updateHistory: true });
assert.equal(tabButtons[1].classList.contains('active'), true);
assert.equal(tabPanels[1].classList.contains('active'), true);
assert.equal(historyCalls.at(-1)?.path, '/providers');
assert.equal(router.getTabIdFromPath('/providers/cloudflare'), 'providers');
assert.equal(router.getTabIdFromPath('/virtual-models/new'), 'virtual-models');
assert.equal(router.getTabIdFromPath('/virtual-models/edit/custom%2Frouter'), 'virtual-models');

const keysFeature = createKeysFeature({
  state,
  isCloudflareProvider(provider) {
    return provider?.name === 'cloudflare' && provider?.apiKeyEnvVar === 'CLOUDFLARE_API_KEY';
  },
  escapeHtml(value) {
    return String(value);
  },
});

keysFeature.openProviderKeyModal('cloudflare', 'CLOUDFLARE_API_KEY', 'add');
assert.equal(modal.hidden, false);
assert.equal(title.textContent, 'Add credential for cloudflare');
assert.equal(secondaryGroup.hidden, false);
assert.equal(secondaryInput.required, true);
assert.equal(submitButton.textContent, 'Add credential');
assert.equal(primaryInput.focused, true);

keysFeature.closeProviderKeyModal();
assert.equal(modal.hidden, true);
assert.equal(state.keyModalProviderName, null);
assert.equal(secondaryGroup.hidden, true);
assert.equal(secondaryInput.required, false);

keysFeature.openProviderKeyModal('kimi', 'KIMI_API_KEY', 'add');
assert.equal(instructions.hidden, false);
assert.match(instructionsList.innerHTML, /Sign in to Moonshot AI Platform/i);
assert.match(instructionsList.innerHTML, /<a href="https:\/\/platform\.moonshot\.cn"/i);
assert.match(instructionsList.innerHTML, /Open API Keys in the console/i);
assert.match(instructionsList.innerHTML, /<a href="https:\/\/platform\.moonshot\.cn\/console\/api-keys"/i);
assert.match(instructionsList.innerHTML, /Create a new API key and copy it here/i);

const detail = new FakeElement({ id: 'provider-detail-view' });
elementById.set('provider-detail-view', detail);

renderProviderDetailView({
  provider: state.providers[1],
  state: {
    ...state,
    models: [],
  },
  keysFeature: {
    getProviderKeySummary() {
      return { keys: [], effectiveCount: 0, managedCount: 0, environmentCount: 0 };
    },
    getEnvVarSummary() {
      return { keys: [], configured: false, managedCount: 0 };
    },
    openProviderKeyModal() {},
    clearProviderKeys() {},
    deleteProviderKey() {},
    clearProviderEnvValue() {},
  },
  getProviderHealthState() {
    return 'ready';
  },
  healthLabels: { ready: 'Ready' },
  isCloudflareProvider() {
    return false;
  },
  escapeHtml(value) {
    return String(value);
  },
  getProviderInitials() {
    return 'KI';
  },
  formatTime() {
    return '—';
  },
  actions: {
    closeProviderDetail() {},
    refreshProviderCatalog: async () => {},
    runProviderHealthCheck: async () => {},
  },
});

assert.match(detail.innerHTML, /How to get this API key/);
assert.match(detail.innerHTML, /Sign in to Moonshot AI Platform/i);
assert.match(detail.innerHTML, /<a href="https:\/\/platform\.moonshot\.cn"/i);
assert.match(detail.innerHTML, /Open API Keys in the console/i);
assert.match(detail.innerHTML, /<a href="https:\/\/platform\.moonshot\.cn\/console\/api-keys"/i);
assert.match(detail.innerHTML, /Create a new API key and copy it here/i);
assert.match(detail.innerHTML, /Last request error/i);
assert.match(detail.innerHTML, /Provider unavailable/i);
assert.match(detail.innerHTML, /abcd1234ef567890/i);
assert.match(detail.innerHTML, /HTTP 429: rate limit exceeded/i);
assert.match(detail.innerHTML, /kimi-k2/i);

console.log('frontend dom smoke regression passed');

