export function toPlainText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatRuntimeInstant(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Never';
  return new Date(numeric).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export function createRouteFormatters({ escapeHtml }) {
  function formatRouteLabel(route) {
    if (!route || !route.provider || !route.modelId) return 'None';
    return `${escapeHtml(route.provider)}/${escapeHtml(route.modelId)}`;
  }

  function renderReasonList(entries, emptyLabel) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return `<div class="muted">${escapeHtml(emptyLabel)}</div>`;
    }
    return entries.map(entry => {
      const label = `${escapeHtml(entry.provider || 'unknown')}/${escapeHtml(entry.modelId || 'unknown')}`;
      const reason = entry.reason ? escapeHtml(entry.reason) : 'No reason provided';
      return `<div class="vm-reason-list-item"><strong>${label}</strong><span>${reason}</span></div>`;
    }).join('');
  }

  function renderAttemptList(attempts) {
    if (!Array.isArray(attempts) || attempts.length === 0) {
      return '<div class="muted">No attempts recorded.</div>';
    }
    return attempts.map(attempt => {
      const route = `${escapeHtml(attempt.provider || 'unknown')}/${escapeHtml(attempt.modelId || 'unknown')}`;
      const outcome = escapeHtml(attempt.outcome || 'unknown');
      const fallbackBadge = attempt.phase === 'fallback' || attempt.fallbackOnly === true
        ? '<span class="vm-panel-chip vm-panel-chip-warn">Fallback path</span>'
        : '<span class="vm-panel-chip">Primary path</span>';
      return `<div class="vm-attempt-list-item"><div><strong>${route}</strong>${fallbackBadge}</div><span>${outcome}</span></div>`;
    }).join('');
  }

  return { formatRouteLabel, renderReasonList, renderAttemptList };
}
