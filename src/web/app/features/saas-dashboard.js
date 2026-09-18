export function createSaasDashboardFeature({ state, saasFetch, formatNumber, copyText }) {
  function getConsoleEndpointUrls() {
    const origin = window.location.origin;
    return {
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

  function bindEndpointCopy() {
    const feedback = document.getElementById('endpoint-copy-feedback');
    const endpoints = getConsoleEndpointUrls();
    const buttons = document.querySelectorAll('[data-copy-endpoint-key]');
    let feedbackTimer = 0;

    renderConsoleEndpointUrls(endpoints);

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

  async function loadSaasDashboard() {
    if (!state.saasUser) return;

    try {
      const data = await saasFetch('/api/saas/usage');
      const daily = data.daily || {};
      const pcts = data.percentages || {};

      document.getElementById('saas-today-requests').textContent = daily.requests || 0;
      document.getElementById('saas-today-tokens').textContent = formatNumber((daily.promptTokens || 0) + (daily.completionTokens || 0));
      const planName = data.tier?.config?.name || 'Free';
      document.getElementById('saas-plan-name').textContent = planName;
      const controlRoomPlan = document.getElementById('control-room-plan-name');
      if (controlRoomPlan) controlRoomPlan.textContent = planName;
      document.getElementById('saas-requests-pct').textContent = `${pcts.requestsPct || 0}%`;

      const tbody = document.getElementById('saas-usage-history');
      const history = data.history || [];
      if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">No usage recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = history.map(row => `
        <tr>
          <td>${row.date}</td>
          <td class="numeric">${row.requests}</td>
          <td class="numeric">${formatNumber(row.promptTokens)}</td>
          <td class="numeric">${formatNumber(row.completionTokens)}</td>
          <td class="numeric">${formatNumber(row.promptTokens + row.completionTokens)}</td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Failed to load SaaS dashboard:', error);
    }
  }

  return {
    loadSaasDashboard,
    bindEndpointCopy,
  };
}
