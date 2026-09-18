import { toStatusEvent } from './lib/request-status.js';
import { HEALTH_CHECK_POLLING, REQUEST_TIMEOUTS } from './lib/timeouts.js';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollAllProviderHealthCheck({ button, catalogFeature, fetchJSON, reportStatus }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_CHECK_POLLING.maxDurationMs) {
    await wait(HEALTH_CHECK_POLLING.intervalMs);

    const status = await fetchJSON('/api/health/check-all/status', {
      timeoutMs: HEALTH_CHECK_POLLING.requestTimeoutMs,
    });
    const job = status?.job ?? {};
    await catalogFeature.loadCatalog();

    if (button && job.total) {
      button.textContent = `Testing ${job.completed}/${job.total}...`;
    }

    reportStatus(toStatusEvent({
      level: 'info',
      message: `Testing providers: ${job.completed ?? 0}/${job.total ?? 0} completed.`,
    }));

    if (job.state === 'completed') {
      return job;
    }

    if (job.state === 'failed') {
      throw new Error(job.error || 'Provider health check failed.');
    }
  }

  throw new Error('Provider health checks are still running after the UI polling timeout. Refresh the catalog in a few moments.');
}

export function bindDashboardEvents({
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
  reportStatus = () => {},
  mcpServersFeature,
  saasDashboardFeature,
}) {
  dashboardOverviewFeature.bind();
  saasDashboardFeature?.bindEndpointCopy();

  const gatewayInput = document.getElementById('gateway-key');
  if (gatewayInput) {
    gatewayInput.value = getStoredGatewayKey();
  }

  // Sidebar navigation handling
  document.querySelectorAll('aside a[data-view]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const tabId = link.getAttribute('data-tab') || link.getAttribute('data-view');
      const path = link.getAttribute('href');

      // Update active state
      document.querySelectorAll('aside a[data-view]').forEach(l => {
        l.classList.remove('bg-indigo-50/80', 'dark:bg-indigo-600/10', 'text-indigo-600', 'dark:text-indigo-400', 'font-semibold', 'border', 'border-indigo-100', 'dark:border-indigo-500/20', 'shadow-sm');
        l.classList.add('text-slate-600', 'dark:text-slate-400');
      });
      link.classList.remove('text-slate-600', 'dark:text-slate-400');
      link.classList.add('bg-indigo-50/80', 'dark:bg-indigo-600/10', 'text-indigo-600', 'dark:text-indigo-400', 'font-semibold', 'border', 'border-indigo-100', 'dark:border-indigo-500/20', 'shadow-sm');

      // Navigate via router contract when possible, fallback to history only for non-tab routes.
      if (tabId && document.getElementById(tabId)) {
        const target = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (target && path && target.dataset.path == null) {
          target.dataset.path = path;
        }
        target?.click();
        return;
      }

      if (path && path !== window.location.pathname) {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });
  });

  document.getElementById('model-search')?.addEventListener('input', () => modelsFeature.renderModels());
  document.getElementById('model-provider-filter')?.addEventListener('change', () => modelsFeature.renderModels());
  document.getElementById('model-tier-filter')?.addEventListener('change', () => modelsFeature.renderModels());
  document.getElementById('model-sort')?.addEventListener('change', () => modelsFeature.renderModels());
  document.getElementById('provider-search')?.addEventListener('input', () => providersFeature.renderProviders());
  document.getElementById('provider-state-filter')?.addEventListener('change', () => providersFeature.renderProviders());

  document.getElementById('save-keys')?.addEventListener('click', () => keysFeature.saveKeys());
  document.getElementById('add-byok-btn')?.addEventListener('click', () => {
    const selectedProvider = state.selectedProviderName
      ? state.providers.find(provider => provider.name === state.selectedProviderName)
      : null;

    if (selectedProvider?.apiKeyEnvVar) {
      keysFeature.openProviderKeyModal(selectedProvider.name, selectedProvider.apiKeyEnvVar, 'add');
      return;
    }

    document.querySelector('.tab-btn[data-tab="keys"]')?.click();
  });
  document.getElementById('provider-key-modal-form')?.addEventListener('submit', event => keysFeature.addProviderKeyFromModal(event));
  document.getElementById('provider-key-modal-close')?.addEventListener('click', () => keysFeature.closeProviderKeyModal());
  document.getElementById('provider-key-modal-cancel')?.addEventListener('click', () => keysFeature.closeProviderKeyModal());
  document.getElementById('provider-key-modal')?.addEventListener('click', event => {
    if (event.target?.id === 'provider-key-modal') {
      keysFeature.closeProviderKeyModal();
    }
  });

  quickConnectFeature.bind();
  testConsoleFeature.bind();
  mcpServersFeature?.bind();

  document.getElementById('check-all-health')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = 'Starting tests...';
      await fetchJSON('/api/health/check-all?async=1', { method: 'POST', timeoutMs: REQUEST_TIMEOUTS.short });
      reportStatus(toStatusEvent({ level: 'info', message: 'Started provider health checks.' }));
      await pollAllProviderHealthCheck({ button, catalogFeature, fetchJSON, reportStatus });
      await catalogFeature.loadCatalog();
      reportStatus(toStatusEvent({ level: 'success', message: 'Completed provider health checks.' }));
    } catch (error) {
      reportStatus(toStatusEvent(error));
    } finally {
      button.disabled = false;
      button.textContent = 'Test All Providers';
    }
  });

  document.querySelectorAll('[data-refresh-models]').forEach(button => {
    const defaultLabel = button.getAttribute('data-refresh-label') || button.textContent.trim() || 'Refresh Models';
    button.addEventListener('click', async event => {
      const clickedButton = event.currentTarget;
      try {
        clickedButton.disabled = true;
        clickedButton.textContent = 'Syncing...';
        state.lastRefreshResult = await fetchJSON('/api/models/refresh', { method: 'POST', timeoutMs: REQUEST_TIMEOUTS.standard });
        await catalogFeature.loadCatalog();
        reportStatus(toStatusEvent({
          level: 'success',
          message: 'Model refresh completed.',
          details: {
            refreshed: state.lastRefreshResult?.refreshed?.join(', ') || 'none',
            failed: state.lastRefreshResult?.failed?.join(', ') || 'none',
            skipped: state.lastRefreshResult?.skipped?.join(', ') || 'none',
          },
        }));
      } catch (error) {
        reportStatus(toStatusEvent(error));
      } finally {
        clickedButton.disabled = false;
        clickedButton.textContent = defaultLabel;
      }
    });
  });

  document.getElementById('clear-usage')?.addEventListener('click', () => usageFeature.clearUsage());
}
