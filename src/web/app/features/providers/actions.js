import { toStatusEvent } from '../../lib/request-status.js';
import { fetchJSON } from '../../lib/http.js';
import { REQUEST_TIMEOUTS } from '../../lib/timeouts.js';

export function createProviderActions({ state, loadCatalog, providerPath, activateTab, reportStatus = () => {} }) {
  async function runProviderHealthCheck(providerName) {
    try {
      await fetchJSON(`/api/health/check/${encodeURIComponent(providerName)}`, {
        method: 'POST',
        timeoutMs: REQUEST_TIMEOUTS.short,
      });
      await loadCatalog();
    } catch (error) {
      reportStatus(toStatusEvent(error));
      throw error;
    }
  }

  async function refreshProviderCatalog(providerName) {
    try {
      const payload = await fetchJSON(`/api/models/refresh/${encodeURIComponent(providerName)}`, {
        method: 'POST',
        timeoutMs: REQUEST_TIMEOUTS.short,
      });
      state.lastRefreshResult = payload;
      await loadCatalog();
      return payload;
    } catch (error) {
      reportStatus(toStatusEvent(error));
      throw error;
    }
  }

  function openProviderDetail(providerName) {
    window.history.pushState({ tabId: 'providers' }, '', providerPath(providerName));
    state.selectedProviderName = providerName;
    activateTab('providers');
  }

  function closeProviderDetail() {
    window.history.pushState({ tabId: 'providers' }, '', '/providers');
    state.selectedProviderName = null;
    activateTab('providers');
  }

  return {
    runProviderHealthCheck,
    refreshProviderCatalog,
    openProviderDetail,
    closeProviderDetail,
  };
}
