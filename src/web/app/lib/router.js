import { pathTabMap } from '../state.js';

const tabChrome = {
  'saas-dashboard': { section: 'Workspace', label: 'Overview' },
  providers: { section: 'AI Infrastructure', label: 'Providers & BYOK', showByokAction: true },
  models: { section: 'AI Infrastructure', label: 'Model Catalog' },
  'system-prompts': { section: 'AI Infrastructure', label: 'System Prompts' },
  'virtual-models': { section: 'AI Infrastructure', label: 'Virtual Models' },
  'mcp-servers': { section: 'AI Infrastructure', label: 'MCP Servers' },
  keys: { section: 'Usage & Access', label: 'Provider BYOK Keys', showByokAction: true },
  usage: { section: 'Usage & Access', label: 'Token Analytics' },
  'quick-connect': { section: 'Usage & Access', label: 'Quick Connect' },
  quota: { section: 'Usage & Access', label: 'Quota Management' },
  compression: { section: 'Usage & Access', label: 'Compression' },
  settings: { section: 'Administration', label: 'Gateway Settings' },
  'saas-admin': { section: 'Administration', label: 'Admin Panel' },
  skills: { section: 'Administration', label: 'Skills' },
  memory: { section: 'Administration', label: 'Memory' },
  test: { section: 'Administration', label: 'Test Console' },
  'saas-keys': { section: 'Account', label: 'AgentRail API Keys' },
};

function updateTopbarChrome(tabId) {
  const chrome = tabChrome[tabId] || tabChrome['saas-dashboard'];
  const breadcrumbSection = document.getElementById('breadcrumb-section');
  const breadcrumbCurrent = document.getElementById('breadcrumb-current');
  const byokButton = document.getElementById('add-byok-btn');

  if (breadcrumbSection) breadcrumbSection.textContent = chrome.section;
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = chrome.label;
  if (byokButton) byokButton.style.display = chrome.showByokAction ? '' : 'none';
}

export function createTabRouter({
  state,
  defaultTabId,
  tabPathMap,
  getProviderFromPath,
  providerPath,
  canActivateTab,
  onProvidersActivated,
  onSystemPromptsActivated,
  onVirtualModelsActivated,
  onTabActivated,
}) {
  function getTabIdFromPath(pathname) {
    if (pathname.startsWith('/providers/')) return 'providers';
    if (pathname === '/virtual-models/new' || /^\/virtual-models\/edit\/.+$/.test(pathname)) return 'virtual-models';
    return pathTabMap[pathname] || defaultTabId;
  }

  function activateTab(tabId, options = {}) {
    const { updateHistory = false, replaceHistory = false } = options;
    const nextTabId = tabId || defaultTabId;

    if (canActivateTab && canActivateTab(nextTabId, options) === false) {
      return false;
    }

    const buttons = document.querySelectorAll('.tab-btn');
    const tabs = document.querySelectorAll('.tab-content');
    const targetButton = document.querySelector(`.tab-btn[data-tab="${nextTabId}"]`);
    const targetTab = document.getElementById(nextTabId);

    if (!targetButton || !targetTab) {
      if (nextTabId === defaultTabId) {
        return false;
      }
      return activateTab(defaultTabId, updateHistory ? { ...options, replaceHistory: true } : options);
    }

    buttons.forEach(item => item.classList.remove('active'));
    tabs.forEach(item => item.classList.remove('active'));
    targetButton.classList.add('active');
    targetTab.classList.add('active');
    updateTopbarChrome(nextTabId);

    if (nextTabId === 'providers') {
      state.selectedProviderName = getProviderFromPath();
      onProvidersActivated?.();
    } else if (nextTabId === 'system-prompts') {
      onSystemPromptsActivated?.();
    } else if (nextTabId === 'virtual-models') {
      onVirtualModelsActivated?.();
    } else {
      state.selectedProviderName = null;
    }

    if (updateHistory) {
      const nextPath = nextTabId === 'providers' && state.selectedProviderName
        ? providerPath(state.selectedProviderName)
        : tabPathMap[nextTabId]
          || document.querySelector(`.tab-btn[data-tab="${nextTabId}"]`)?.dataset.path
          || tabPathMap[defaultTabId];
      const currentPath = window.location.pathname;
      if (currentPath !== nextPath) {
        const historyMethod = replaceHistory ? 'replaceState' : 'pushState';
        window.history[historyMethod]({ tabId: nextTabId }, '', nextPath);
      }
    }

    onTabActivated?.(nextTabId, options);
    return true;
  }

  function setupTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(button => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        activateTab(button.dataset.tab, { updateHistory: true });
      });
    });

    window.addEventListener('popstate', () => {
      activateTab(getTabIdFromPath(window.location.pathname));
    });

    activateTab(getTabIdFromPath(window.location.pathname), { updateHistory: true, replaceHistory: true });
  }

  return {
    getTabIdFromPath,
    activateTab,
    setupTabs,
  };
}
