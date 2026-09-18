import { createProviderActions } from './actions.js';
import { renderProviderDetailView } from './render-detail.js';
import { renderProvidersList } from './render-list.js';

export function createProvidersFeature({
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
  formatLatency,
  formatTime,
  loadCatalog,
  activateTab,
}) {
  const actions = createProviderActions({
    state,
    loadCatalog,
    providerPath,
    activateTab,
    reportStatus,
  });

  function renderProviders() {
    const listView = document.getElementById('provider-list-view');
    const detailView = document.getElementById('provider-detail-view');
    if (!listView || !detailView) return;

    const selectedProvider = state.selectedProviderName
      ? state.providers.find(provider => provider.name === state.selectedProviderName)
      : null;

    if (selectedProvider) {
      listView.hidden = true;
      detailView.hidden = false;
      renderProviderDetailView({
        provider: selectedProvider,
        state,
        keysFeature,
        getProviderHealthState,
        healthLabels,
        isCloudflareProvider,
        escapeHtml,
        getProviderInitials,
        formatTime,
        actions,
      });
      return;
    }

    listView.hidden = false;
    detailView.hidden = true;
    renderProvidersList({
      state,
      healthLabels,
      getProviderHealthState,
      getRouteMeta,
      getLatencyTone,
      getProviderInitials,
      escapeHtml,
      formatLatency,
      formatTime,
      actions,
    });
  }

  return {
    getSortedProviderNames: () => state.providers.map(provider => provider.name).slice().sort((a, b) => a.localeCompare(b)),
    renderProviders,
    openProviderDetail: actions.openProviderDetail,
    closeProviderDetail: actions.closeProviderDetail,
    runProviderHealthCheck: actions.runProviderHealthCheck,
    refreshProviderCatalog: actions.refreshProviderCatalog,
  };
}
