export function createUsageFeature({ state, fetchJSON, escapeHtml, formatNumber, formatTime }) {
  function getVirtualModelRouteRows(statsRecords) {
    return (Array.isArray(statsRecords) ? statsRecords : []).flatMap((record) => {
      const routeHits = Array.isArray(record?.routeHits) ? record.routeHits : [];
      return routeHits.map((hit) => ({
        virtualModelId: String(record?.id ?? ''),
        providerName: String(hit?.provider ?? ''),
        modelId: String(hit?.modelId ?? ''),
        callCount: toUsageNumber(hit?.count),
        lastUsedAt: record?.lastUsedAt ?? null,
      }));
    }).sort((left, right) => right.callCount - left.callCount || String(right.lastUsedAt ?? 0).localeCompare(String(left.lastUsedAt ?? 0)));
  }

  function toUsageNumber(value) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  function getUsageTotals(records) {
    return (Array.isArray(records) ? records : []).reduce((totals, record) => {
      const promptTokens = toUsageNumber(record.promptTokens);
      const completionTokens = toUsageNumber(record.completionTokens);

      totals.callCount += toUsageNumber(record.callCount);
      totals.promptTokens += promptTokens;
      totals.completionTokens += completionTokens;
      totals.totalTokens += toUsageNumber(record.totalTokens ?? promptTokens + completionTokens);
      return totals;
    }, {
      callCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  }

  function setTextContent(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function renderUsageSummary() {
    const totals = getUsageTotals(state.usageRecords);
    setTextContent('usage-total-calls', formatNumber(totals.callCount));
    setTextContent('usage-total-prompt-tokens', formatNumber(totals.promptTokens));
    setTextContent('usage-total-completion-tokens', formatNumber(totals.completionTokens));
    setTextContent('usage-total-tokens', formatNumber(totals.totalTokens));
  }

  function renderUsage() {
    renderUsageSummary();
    const tbody = document.getElementById('usage-table-body');
    const virtualModelsBody = document.getElementById('usage-virtual-models-body');
    if (!tbody) return;
    const records = state.usageRecords;
    if (!records || records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No usage recorded yet.</td></tr>';
    } else {
      tbody.innerHTML = records.map(r => `
        <tr>
          <td><code>${escapeHtml(r.modelId)}</code></td>
          <td><span class="provider-badge">${escapeHtml(r.providerName)}</span></td>
          <td class="numeric">${formatNumber(r.callCount)}</td>
          <td class="numeric">${formatNumber(r.promptTokens)}</td>
          <td class="numeric">${formatNumber(r.completionTokens)}</td>
          <td class="numeric"><strong>${formatNumber(r.totalTokens)}</strong></td>
          <td>${formatTime(r.lastUsedAt)}</td>
        </tr>
      `).join('');
    }

    if (!virtualModelsBody) return;

    const virtualModelRouteRows = getVirtualModelRouteRows(state.virtualModelStats);
    if (virtualModelRouteRows.length === 0) {
      virtualModelsBody.innerHTML = '<tr><td colspan="5" class="empty">No virtual model route usage recorded yet.</td></tr>';
      return;
    }

    virtualModelsBody.innerHTML = virtualModelRouteRows.map(row => `
      <tr>
        <td><code>${escapeHtml(row.virtualModelId)}</code></td>
        <td><span class="provider-badge">${escapeHtml(row.providerName)}</span></td>
        <td><code>${escapeHtml(row.modelId)}</code></td>
        <td class="numeric">${formatNumber(row.callCount)}</td>
        <td>${row.lastUsedAt == null ? '—' : formatTime(row.lastUsedAt)}</td>
      </tr>
    `).join('');
  }

  function renderSyncMeta() {
    const root = document.getElementById('sync-meta');
    if (!root) return;
    const metas = state.syncMetas;
    const entries = Object.entries(metas);
    const refreshResult = state.lastRefreshResult;
    const refreshSummary = refreshResult
      ? `Last refresh: ${refreshResult.refreshed?.length ?? 0} refreshed, ${refreshResult.skipped?.length ?? 0} skipped, ${refreshResult.failed?.length ?? 0} failed`
      : '';

    const details = refreshResult && ((refreshResult.skipped?.length ?? 0) > 0 || (refreshResult.failed?.length ?? 0) > 0)
      ? `Skipped: ${(refreshResult.skipped || []).join(', ') || 'none'} · Failed: ${(refreshResult.failed || []).join(', ') || 'none'}`
      : '';

    const prefix = [refreshSummary, details].filter(Boolean).join(' · ');
    if (entries.length === 0) {
      root.textContent = [prefix, 'Models: using built-in lists'].filter(Boolean).join(' · ');
      return;
    }

    const metaHtml = entries.map(([name, meta]) => {
      const sourceLabel = meta.source === 'api' ? 'live' : 'cached';
      return `<span>${name}: ${sourceLabel} @ ${formatTime(meta.updatedAt)}</span>`;
    }).join(' · ');
    root.innerHTML = [prefix ? `<span>${escapeHtml(prefix)}</span>` : '', metaHtml].filter(Boolean).join(' · ');
  }

  async function loadUsage() {
    try {
      const data = await fetchJSON('/api/usage');
      state.usageRecords = data.records ?? [];
      state.virtualModelStats = data.virtualModelStats ?? [];
      renderUsage();
    } catch {
      // ignore usage fetch errors
    }
  }

  async function clearUsage() {
    if (!state.usageRecords || state.usageRecords.length === 0) {
      alert('No usage records to clear.');
      return;
    }
    if (!confirm('Are you sure you want to clear all usage records? This action cannot be undone.')) return;
    try {
      const button = document.getElementById('clear-usage');
      button.disabled = true;
      button.textContent = 'Clearing...';
      await fetchJSON('/api/usage', { method: 'DELETE' });
      state.usageRecords = [];
      renderUsage();
    } catch (error) {
      alert(error.message);
    } finally {
      const button = document.getElementById('clear-usage');
      button.disabled = false;
      button.textContent = 'Clear Usage';
    }
  }

  return {
    renderUsageSummary,
    renderUsage,
    renderSyncMeta,
    loadUsage,
    clearUsage,
  };
}
