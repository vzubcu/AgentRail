export function createAdminUsageFeature({ saasFetch, formatNumber }) {
  async function loadAdminUsage() {
    const usageData = await saasFetch('/api/saas/admin/usage');
    const usageTbody = document.getElementById('saas-admin-usage-list');
    const usage = usageData.usage || [];
    if (usage.length === 0) {
      usageTbody.innerHTML = '<tr><td colspan="5" class="empty">No usage recorded.</td></tr>';
      return;
    }

    usageTbody.innerHTML = usage.map(row => `
      <tr>
        <td><code>${row.userId?.slice(0, 8)}...</code></td>
        <td>${row.date}</td>
        <td class="numeric">${row.requests}</td>
        <td class="numeric">${formatNumber(row.promptTokens)}</td>
        <td class="numeric">${formatNumber(row.completionTokens)}</td>
      </tr>
    `).join('');
  }

  function bindSectionSwitcher() {
    const adminSectionSelect = document.getElementById('saas-admin-section-select');
    if (!adminSectionSelect) return;

    adminSectionSelect.addEventListener('change', () => {
      const val = adminSectionSelect.value;
      const users = document.getElementById('saas-admin-users');
      const plans = document.getElementById('saas-admin-plans');
      const usage = document.getElementById('saas-admin-usage');
      if (users) users.style.display = val === 'users' ? 'block' : 'none';
      if (plans) plans.style.display = val === 'plans' ? 'block' : 'none';
      if (usage) usage.style.display = val === 'usage' ? 'block' : 'none';
    });
  }

  return {
    loadAdminUsage,
    bindSectionSwitcher,
  };
}
