const OAUTH_PROVIDERS = new Set(['claude', 'codex', 'gemini']);

export function renderProvidersList({
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
}) {
  const grid = document.getElementById('providers-grid');
  const searchInput = document.getElementById('provider-search');
  const stateFilterInput = document.getElementById('provider-state-filter');
  if (!grid || !searchInput || !stateFilterInput) return;

  const search = searchInput.value.trim().toLowerCase();
  const stateFilter = stateFilterInput.value;

  const filteredProviders = state.providers.filter(provider => {
    const stateKey = getProviderHealthState(provider);
    const matchesSearch = !search || provider.name.toLowerCase().includes(search) || provider.baseURL.toLowerCase().includes(search) || provider.apiKeyEnvVar.toLowerCase().includes(search);
    const matchesState = stateFilter === 'all' || stateKey === stateFilter;
    return matchesSearch && matchesState;
  });

  if (filteredProviders.length === 0 && !state.catalogLoaded) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">⌁</div>
        <div class="empty-state-title">Loading providers...</div>
        <div class="empty-state-desc">Fetching live provider routes from the AgentRail catalog.</div>
      </div>
    `;
    return;
  }

  if (filteredProviders.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">⌁</div>
        <div class="empty-state-title">No providers found</div>
        <div class="empty-state-desc">Try changing the search query or provider state filter.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredProviders.map(provider => {
    const stateKey = getProviderHealthState(provider);
    const statusText = healthLabels[stateKey] ?? stateKey;
    const routeMeta = getRouteMeta(stateKey);
    const message = provider.health?.message ?? routeMeta.description;
    const providerModels = state.models
      .filter(model => model.providers.some(p => p.name === provider.name))
      .map(model => ({ id: model.id, actualId: model.providers.find(x => x.name === provider.name)?.providerModelId ?? model.id }));
    const modelCount = provider.modelCount ?? providerModels.length;
    const visibleModels = providerModels.slice(0, 36);
    const hiddenModelCount = Math.max(0, providerModels.length - visibleModels.length);
    const modelListHtml = providerModels.length > 0
      ? `<div class="model-list route-model-list">${visibleModels.map(model => `<div class="model-tag route-model-tag" title="Provider model: ${escapeHtml(model.actualId)}">${escapeHtml(model.id)}</div>`).join('')}${hiddenModelCount > 0 ? `<div class="model-tag route-model-tag muted">+${hiddenModelCount} more</div>` : ''}</div>`
      : '<div class="model-list-empty">No models found for this provider.</div>';
    const isOAuth = OAUTH_PROVIDERS.has(provider.name);
    const oauthStatus = state.oauthStatus?.[provider.name];
    const oauthConfigured = oauthStatus?.configured;
    const websiteLink = provider.website ? `<a class="route-link" href="${escapeHtml(provider.website)}" target="_blank" rel="noopener noreferrer">Provider site ↗</a>` : '';
    const latency = provider.health?.latencyMs ?? null;
    const latencyTone = getLatencyTone(latency);
    const lastStatus = provider.health?.lastStatusCode ?? '—';
    const lastSuccess = provider.health?.lastSuccessAt ?? null;
    const checkedAt = provider.health?.checkedAt ?? null;

    return `
      <article class="provider-card route-health-card ${stateKey}">
        <div class="route-card-topline"></div>
        <div class="route-card-header">
          <div class="route-provider-main">
            <div class="route-provider-icon ${stateKey}">${escapeHtml(getProviderInitials(provider.name))}</div>
            <div class="route-provider-title">
              <div class="route-provider-name">${escapeHtml(provider.name)}</div>
              <div class="route-provider-role">${escapeHtml(routeMeta.role)}</div>
            </div>
          </div>
          <span class="provider-status route-status ${stateKey}">${escapeHtml(statusText)}</span>
        </div>
        <div class="route-lane ${stateKey}">
          <div class="route-lane-node source"><span>AgentRail</span><strong>localhost</strong></div>
          <div class="route-lane-line"><span></span><span></span><span></span></div>
          <div class="route-lane-node target"><span>Provider</span><strong>${escapeHtml(provider.name)}</strong></div>
          <div class="route-lane-result ${stateKey}">${escapeHtml(routeMeta.laneStatus)}</div>
        </div>
        <div class="route-health-copy route-detail-block">
          <div class="route-health-headline">${escapeHtml(routeMeta.headline)}</div>
          <div class="route-health-message">${escapeHtml(message)}</div>
        </div>
        <div class="route-metrics">
          <div class="route-metric"><span>Latency</span><strong class="latency-${latencyTone}">${formatLatency(latency)}</strong></div>
          <div class="route-metric"><span>Status</span><strong>${escapeHtml(lastStatus)}</strong></div>
          <div class="route-metric"><span>Models</span><strong>${escapeHtml(modelCount)}</strong></div>
          <div class="route-metric wide"><span>Last success</span><strong>${escapeHtml(formatTime(lastSuccess))}</strong></div>
        </div>
        <div class="route-detail-block route-config">
          <div class="route-config-row"><span>Base URL</span><code title="${escapeHtml(provider.baseURL)}">${escapeHtml(provider.baseURL)}</code></div>
          <div class="route-config-row"><span>Env</span><code>${escapeHtml(provider.apiKeyEnvVar)}</code></div>
          ${websiteLink ? `<div class="route-config-row route-config-link"><span>Docs</span>${websiteLink}</div>` : ''}
        </div>
        <div class="provider-models route-models">
          <div class="provider-models-header route-models-header">
            <button class="provider-model-toggle route-model-toggle" type="button" data-toggle-models aria-expanded="false"><span>${escapeHtml(modelCount)} models available</span><span class="provider-model-toggle-icon">▾</span></button>
            <button class="btn-secondary route-details-btn" type="button" data-toggle-details aria-expanded="false">Details</button>
            <button class="btn-secondary route-test-btn" data-check-provider="${escapeHtml(provider.name)}">Test route</button>
            ${isOAuth
              ? `<button class="btn-primary route-keys-btn" type="button" data-oauth-connect-card="${escapeHtml(provider.name)}">${oauthConfigured ? 'Reconnect OAuth' : 'Connect OAuth'}</button>`
              : `<button class="btn-primary route-keys-btn" type="button" data-manage-provider-keys="${escapeHtml(provider.name)}">Manage keys</button>`}
          </div>
          <div class="route-check-meta route-detail-block">Last checked: ${escapeHtml(formatTime(checkedAt))}</div>
          <div class="provider-model-list-wrapper route-model-list-wrapper route-detail-block">${modelListHtml}</div>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-toggle-models]').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('.provider-card');
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      const nextOpen = !isOpen;
      button.setAttribute('aria-expanded', String(nextOpen));
      card.classList.toggle('models-open', nextOpen);
    });
  });

  grid.querySelectorAll('[data-toggle-details]').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('.provider-card');
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      const nextOpen = !isOpen;
      button.setAttribute('aria-expanded', String(nextOpen));
      button.textContent = nextOpen ? 'Hide details' : 'Details';
      card.classList.toggle('details-open', nextOpen);
    });
  });

  grid.querySelectorAll('[data-check-provider]').forEach(button => {
    button.addEventListener('click', async () => {
      const provider = button.getAttribute('data-check-provider');
      try {
        button.disabled = true;
        button.textContent = 'Testing...';
        await actions.runProviderHealthCheck(provider);
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = 'Test route';
      }
    });
  });

  grid.querySelectorAll('[data-manage-provider-keys]').forEach(button => {
    button.addEventListener('click', () => {
      const provider = button.getAttribute('data-manage-provider-keys');
      if (provider) actions.openProviderDetail(provider);
    });
  });

  grid.querySelectorAll('[data-oauth-connect-card]').forEach(button => {
    button.addEventListener('click', () => {
      const provider = button.getAttribute('data-oauth-connect-card');
      if (provider) actions.openProviderDetail(provider);
    });
  });
}
