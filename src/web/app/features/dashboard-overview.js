export function createDashboardOverviewFeature({
  state,
  healthLabels,
  getProviderHealthState,
  escapeHtml,
  formatLatency,
  formatTime,
  copyText,
  activateTab,
  providerPath,
}) {
  function renderControlRoomStatus() {
    const summary = state.healthSummary;
    const healthyProviders = document.getElementById('control-room-healthy-providers');
    const providerSummary = document.getElementById('control-room-provider-summary');
    const gatewayStatus = document.getElementById('control-room-gateway-status');
    const gatewayLabel = document.getElementById('control-room-gateway-label');
    const gatewaySummary = document.getElementById('control-room-gateway-summary');
    const topbarStatus = document.getElementById('control-room-topbar-status');
    const providerRows = document.getElementById('control-room-provider-rows');

    if (!healthyProviders && !providerSummary && !gatewayStatus && !gatewayLabel && !gatewaySummary && !topbarStatus && !providerRows) return;

    const healthy = summary?.healthy ?? 0;
    const configured = summary?.configured ?? 0;
    const missing = summary?.missing_key ?? 0;
    const unhealthy = summary?.unhealthy ?? 0;
    const total = summary?.total ?? state.providers.length ?? 0;
    const isLoading = !summary && total === 0;
    const needsAttention = unhealthy > 0 || missing > 0;
    const gatewayText = isLoading
      ? 'Checking Gateway'
      : needsAttention
        ? 'Providers Need Attention'
        : 'Gateway Online';
    const gatewayLabelText = isLoading
      ? 'Checking Status'
      : needsAttention
        ? 'Action Required'
        : 'Operational';
    const gatewaySummaryText = isLoading
      ? 'Loading provider health...'
      : total > 0
        ? `${healthy} healthy / ${configured} configured / ${unhealthy} failing / ${missing} missing`
        : 'Provider catalog has no entries yet.';

    if (healthyProviders) {
      healthyProviders.textContent = healthy === total && total > 0 ? 'All Healthy' : `${healthy} healthy`;
      healthyProviders.classList.toggle('healthy', healthy > 0);
      healthyProviders.classList.toggle('warning', healthy === 0 && configured > 0);
    }

    if (providerSummary) {
      providerSummary.textContent = total > 0
        ? `${healthy} healthy / ${configured} configured / ${unhealthy} failing / ${missing} missing`
        : 'Catalog loading';
    }

    if (gatewayStatus) gatewayStatus.textContent = gatewayText;
    if (gatewayLabel) gatewayLabel.textContent = gatewayLabelText;
    if (gatewaySummary) gatewaySummary.textContent = gatewaySummaryText;
    if (topbarStatus) topbarStatus.textContent = gatewayText;

    if (!providerRows) return;

    const rows = [...state.providers]
      .sort((a, b) => {
        const order = { healthy: 0, configured: 1, unhealthy: 2, missing_key: 3 };
        return (order[getProviderHealthState(a)] ?? 4) - (order[getProviderHealthState(b)] ?? 4)
          || String(a.name).localeCompare(String(b.name));
      })
      .slice(0, 6);

    if (rows.length === 0) {
      providerRows.innerHTML = '<tr><td colspan="7" class="empty">Loading providers...</td></tr>';
      return;
    }

    providerRows.innerHTML = rows.map(provider => {
      const healthState = getProviderHealthState(provider);
      const modelCount = state.models.filter(model => model.providers.some(item => item.name === provider.name)).length;
      const latency = provider.health?.latencyMs;
      const lastChecked = provider.health?.lastCheckedAt;
      const successRate = healthState === 'healthy'
        ? '100.00%'
        : healthState === 'configured'
          ? 'Ready'
          : healthState === 'unhealthy'
            ? 'Check'
            : 'No key';
      return `
        <tr>
          <td>${escapeHtml(provider.displayName || provider.name)}</td>
          <td><span class="provider-health-state ${healthState}"><span></span>${escapeHtml(healthLabels[healthState] || healthState)}</span></td>
          <td>${modelCount}</td>
          <td class="success-rate ${healthState}">${successRate}</td>
          <td>${formatLatency(latency)}</td>
          <td>${lastChecked ? formatTime(lastChecked) : 'Not checked'}</td>
          <td><button class="provider-row-link" type="button" data-provider-row="${escapeHtml(provider.name)}">›</button></td>
        </tr>
      `;
    }).join('');

    providerRows.querySelectorAll('[data-provider-row]').forEach(button => {
      button.addEventListener('click', () => {
        const providerName = button.getAttribute('data-provider-row');
        if (!providerName) return;
        window.history.pushState({ tabId: 'providers' }, '', `/providers/${encodeURIComponent(providerName)}`);
        activateTab('providers');
      });
    });
  }

  function renderHealthSummary() {
    const root = document.getElementById('health-summary');
    const summary = state.healthSummary;
    if (!root) return;
    if (!summary) {
      root.innerHTML = '';
      return;
    }

    root.innerHTML = `
      <div class="summary-card healthy">
        <div class="summary-title">Healthy</div>
        <div class="summary-value">${summary.healthy}</div>
      </div>
      <div class="summary-card unhealthy">
        <div class="summary-title">Unhealthy</div>
        <div class="summary-value">${summary.unhealthy}</div>
      </div>
      <div class="summary-card configured">
        <div class="summary-title">Configured</div>
        <div class="summary-value">${summary.configured}</div>
      </div>
      <div class="summary-card missing_key">
        <div class="summary-title">Missing key</div>
        <div class="summary-value">${summary.missing_key}</div>
      </div>
      <div class="summary-meta">Total: ${summary.total} · last check: ${formatTime(summary.lastCheckedAt)}</div>
    `;
  }

  function getConsoleEndpointUrls() {
    const origin = window.location.origin;
    return {
      origin,
      openai: `${origin}/v1`,
      anthropic: `${origin}/v1/messages`,
    };
  }

  function renderConsoleEndpointUrls(endpoints) {
    document.querySelectorAll('[data-endpoint-display]').forEach(element => {
      const key = element.getAttribute('data-endpoint-display');
      const endpoint = endpoints[key];
      if (endpoint) element.textContent = endpoint;
    });
  }

  function updateControlRoomClock() {
    const clock = document.getElementById('control-room-clock');
    const date = document.getElementById('control-room-date');
    if (!clock && !date) return;
    const now = new Date();
    if (clock) clock.textContent = now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' });
    if (date) date.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function bindTilt(selector, max = 4) {
    document.querySelectorAll(selector).forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', `${((px - 0.5) * max).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${((0.5 - py) * max).toFixed(2)}deg`);
      });
      el.addEventListener('mouseleave', () => {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  function bind() {
    const feedback = document.getElementById('endpoint-copy-feedback');
    const endpoints = getConsoleEndpointUrls();
    const buttons = document.querySelectorAll('[data-copy-endpoint-key]');
    let feedbackTimer = 0;

    renderConsoleEndpointUrls(endpoints);
    updateControlRoomClock();
    window.setInterval(updateControlRoomClock, 1000);

    bindTilt('.gateway-status-banner, .control-room-panel, .control-metric');

    document.querySelectorAll('[data-overview-target]').forEach(button => {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-overview-target');
        if (target) activateTab(target, { updateHistory: true });
      });
    });

    buttons.forEach(button => {
      button.addEventListener('click', async () => {
        const key = button.getAttribute('data-copy-endpoint-key');
        const endpoint = endpoints[key];
        if (!endpoint) return;

        const previousText = button.textContent.trim() || 'Copy';
        button.disabled = true;

        try {
          await copyText(endpoint);
          button.textContent = 'Copied';
          if (feedback) feedback.textContent = `Copied ${endpoint}`;
        } catch {
          button.textContent = 'Retry';
          if (feedback) feedback.textContent = 'Copy failed';
        } finally {
          window.clearTimeout(feedbackTimer);
          feedbackTimer = window.setTimeout(() => {
            if (feedback) feedback.textContent = '';
          }, 1400);

          window.setTimeout(() => {
            button.disabled = false;
            button.textContent = previousText;
          }, 1400);
        }
      });
    });
  }

  return {
    bind,
    renderControlRoomStatus,
    renderHealthSummary,
  };
}

