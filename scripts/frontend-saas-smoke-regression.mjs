import assert from 'node:assert/strict';
import fs from 'node:fs';

class FakeClassList {
  constructor(initial = []) { this.values = new Set(initial); }
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor({ id = '', classes = [], textContent = '', value = '' } = {}) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.textContent = textContent;
    this.value = value;
    this.style = { display: '' };
    this.listeners = new Map();
  }
  addEventListener(event, handler) { this.listeners.set(event, handler); }
}

const elementById = new Map([
  ['public-shell', new FakeElement({ id: 'public-shell' })],
  ['dashboard-shell', new FakeElement({ id: 'dashboard-shell' })],
  ['auth-error', new FakeElement({ id: 'auth-error' })],
  ['auth-email', new FakeElement({ id: 'auth-email' })],
  ['saas-user-btn', new FakeElement({ id: 'saas-user-btn' })],
  ['saas-logout-btn', new FakeElement({ id: 'saas-logout-btn' })],
  ['saas-user-name', new FakeElement({ id: 'saas-user-name' })],
  ['saas-user-email', new FakeElement({ id: 'saas-user-email' })],
  ['saas-user-role', new FakeElement({ id: 'saas-user-role' })],
  ['saas-admin-btn', new FakeElement({ id: 'saas-admin-btn' })],
  ['saas-keys-btn', new FakeElement({ id: 'saas-keys-btn' })],
  ['saas-dashboard', new FakeElement({ id: 'saas-dashboard', classes: ['tab-content'] })],
]);

const tabButtons = [
  new FakeElement({ classes: ['tab-btn'], textContent: 'Dashboard' }),
  new FakeElement({ classes: ['tab-btn'], textContent: 'Admin' }),
];
tabButtons[0].dataset = { tab: 'saas-dashboard' };
tabButtons[1].dataset = { tab: 'saas-admin' };
const tabPanels = [elementById.get('saas-dashboard'), new FakeElement({ id: 'saas-admin', classes: ['tab-content'] })];
elementById.set('saas-admin', tabPanels[1]);

const selectorMap = new Map([
  ['.tab-btn', tabButtons],
  ['.tab-content', tabPanels],
  ['.tab-btn[data-tab="saas-dashboard"]', tabButtons[0]],
  ['.tab-btn[data-tab="saas-admin"]', tabButtons[1]],
]);

const historyCalls = [];
globalThis.document = {
  getElementById(id) { return elementById.get(id) ?? null; },
  querySelector(selector) {
    const value = selectorMap.get(selector);
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  },
  querySelectorAll(selector) {
    const value = selectorMap.get(selector);
    return Array.isArray(value) ? value : value ? [value] : [];
  },
};

globalThis.window = {
  location: { pathname: '/dashboard' },
  history: {
    pushState(state, _title, path) { historyCalls.push({ method: 'pushState', path }); globalThis.window.location.pathname = path; },
    replaceState(state, _title, path) { historyCalls.push({ method: 'replaceState', path }); globalThis.window.location.pathname = path; },
  },
  addEventListener() {},
};

globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ user: { email: 'demo@example.com', name: 'Demo', isAdmin: true }, csrfToken: 'csrf' }) });

const { createSaasShell } = await import('../src/web/app/features/saas-shell.js');
const { createSaasAuthFeature } = await import('../src/web/app/features/saas-auth.js');
const { createTabRouter } = await import('../src/web/app/lib/router.js');

const saasDashboardTemplate = fs.readFileSync(new URL('../src/web/templates/partials/saas-dashboard.html', import.meta.url), 'utf8');
assert.match(saasDashboardTemplate, /id="saas-usage-history"/, 'expected SaaS dashboard template to include the usage history table body');

const state = { saasUser: null, saasCsrfToken: '' };
const shell = createSaasShell({ state });
let authFeature;
const router = createTabRouter({
  state,
  defaultTabId: 'saas-dashboard',
  tabPathMap: { 'saas-dashboard': '/dashboard', 'saas-admin': '/admin' },
  getProviderFromPath() { return null; },
  providerPath() { return '/providers'; },
  canActivateTab(tabId) { return authFeature.canActivateTab(tabId); },
});
authFeature = createSaasAuthFeature({
  state,
  defaultTabId: 'saas-dashboard',
  getTabIdFromPath: router.getTabIdFromPath,
  activateTab: router.activateTab,
  loadCatalog: async () => {},
  loadUsage: async () => {},
  shell,
});

shell.updateSaasUI();
assert.equal(elementById.get('public-shell').style.display, 'block');
assert.equal(authFeature.canActivateTab('saas-dashboard'), false);
assert.equal(router.activateTab('saas-dashboard', { updateHistory: true }), false);

state.saasUser = { email: 'demo@example.com', name: 'Demo', isAdmin: false };
shell.updateSaasUI();
assert.equal(elementById.get('dashboard-shell').style.display, 'block');
assert.equal(elementById.get('saas-user-name').textContent, 'Demo');
assert.equal(authFeature.canActivateTab('saas-dashboard'), true);
assert.equal(authFeature.canActivateTab('saas-admin'), false);

state.saasUser = { email: 'admin@example.com', name: 'Admin', isAdmin: true };
assert.equal(authFeature.canActivateTab('saas-admin'), true);
assert.equal(router.activateTab('saas-admin', { updateHistory: true }), true);
assert.equal(historyCalls.at(-1)?.path, '/admin');

console.log('frontend saas smoke regression passed');
