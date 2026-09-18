export function createQuotaFeature({ fetchJSON, escapeHtml }) {
  async function load() {
    try {
      const res = await fetch('/api/quota');
      const data = await res.json();
      const grid = document.getElementById('quota-grid');
      const rows = document.getElementById('quota-rows');
      const form = document.getElementById('quota-form');
      const refreshBtn = document.getElementById('quota-refresh');
      if (!grid || !rows) return;

      function bar(pct, unlimited) {
        const width = unlimited ? 100 : pct;
        const cls = pct <= 20 ? 'danger' : pct <= 50 ? 'warn' : 'ok';
        return `<div class="quota-bar"><span class="quota-bar-fill ${cls}" style="width:${width}%"></span></div>`;
      }

      function card(h) {
        const el = document.createElement('div');
        el.className = 'quota-card';
        el.innerHTML = `
          <div class="quota-card-head">
            <strong>${escapeHtml(h.provider)}</strong>
            <span class="quota-badge ${h.unlimited ? 'unlimited' : 'capped'}">${h.unlimited ? 'Unlimited' : 'Capped'}</span>
          </div>
          <div class="quota-metric">
            <div class="quota-metric-label">Requests headroom</div>
            ${bar(h.requestHeadroomPct, h.unlimited)}
            <div class="quota-metric-val">${h.usedRequests} used · ${h.unlimited ? '∞' : h.remainingRequests + ' left'} (${h.requestHeadroomPct}%)</div>
          </div>
          <div class="quota-metric">
            <div class="quota-metric-label">Tokens headroom</div>
            ${bar(h.tokenHeadroomPct, h.unlimited)}
            <div class="quota-metric-val">${h.usedTokens} used · ${h.unlimited ? '∞' : h.remainingTokens + ' left'} (${h.tokenHeadroomPct}%)</div>
          </div>`;
        return el;
      }

      function row(provider, quota) {
        const el = document.createElement('div');
        el.className = 'quota-row';
        el.innerHTML = `
          <span class="quota-row-name">${escapeHtml(provider)}</span>
          <label>Requests <input type="number" min="0" step="1" data-provider="${escapeHtml(provider)}" data-field="requests" value="${quota?.requests ?? 0}" /></label>
          <label>Tokens <input type="number" min="0" step="1" data-provider="${escapeHtml(provider)}" data-field="tokens" value="${quota?.tokens ?? 0}" /></label>`;
        return el;
      }

      grid.innerHTML = '';
      (data.headroom || []).forEach((h) => grid.appendChild(card(h)));
      rows.innerHTML = '';
      (data.headroom || []).forEach((h) => rows.appendChild(row(h.provider, data.config?.[h.provider])));
      if (!(data.headroom || []).length) {
        grid.innerHTML = '<p class="empty">No providers tracked yet.</p>';
      }

      if (form && !form._bound) {
        form._bound = true;
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const config = {};
          rows.querySelectorAll('input[data-provider]').forEach((input) => {
            const provider = input.getAttribute('data-provider');
            const field = input.getAttribute('data-field');
            config[provider] = config[provider] || { requests: 0, tokens: 0 };
            config[provider][field] = Math.max(0, parseInt(input.value || '0', 10) || 0);
          });
          await fetch('/api/quota', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config }),
          });
          load();
        });
      }

      if (refreshBtn && !refreshBtn._bound) {
        refreshBtn._bound = true;
        refreshBtn.addEventListener('click', load);
      }
    } catch {
      const grid = document.getElementById('quota-grid');
      if (grid) grid.innerHTML = '<p class="empty">Failed to load quota.</p>';
    }
  }

  return { load };
}