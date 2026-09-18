export function createAdminPlansFeature({ state, saasFetch, escapeHtml }) {
  function formatLimitValue(value) {
    return value == null ? '' : String(value);
  }

  function parseOptionalNumber(value) {
    const trimmed = value.trim();
    return trimmed === '' ? null : Number(trimmed);
  }

  async function loadAdminPlans() {
    const data = await saasFetch('/api/saas/admin/tiers');
    state.cachedTiers = data.tiers || [];
    const createSelect = document.getElementById('admin-create-tier');
    if (createSelect) {
      createSelect.innerHTML = state.cachedTiers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }
    const tbody = document.getElementById('saas-admin-plans-list');
    const tiers = state.cachedTiers;
    if (tiers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">No plans defined.</td></tr>';
    } else {
      tbody.innerHTML = tiers.map(t => {
        const isFree = t.id === 'free';
        return `<tr>
          <td><code>${escapeHtml(t.id)}</code></td>
          <td><input class="plan-edit" data-tier-id="${t.id}" data-field="name" value="${escapeHtml(t.name)}" style="width:100%;background:transparent;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0.25rem 0.4rem"></td>
          <td><input class="plan-edit" data-tier-id="${t.id}" data-field="priceMonthly" value="${t.priceMonthly}" type="number" min="0" style="width:70px;background:transparent;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0.25rem 0.4rem"></td>
          <td><input class="plan-edit" data-tier-id="${t.id}" data-field="requestsPerDay" value="${formatLimitValue(t.requestsPerDay)}" type="number" min="0" placeholder="Unlimited" style="width:80px;background:transparent;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0.25rem 0.4rem"></td>
          <td><input class="plan-edit" data-tier-id="${t.id}" data-field="maxTokensPerDay" value="${formatLimitValue(t.maxTokensPerDay)}" type="number" min="0" placeholder="Unlimited" style="width:100px;background:transparent;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0.25rem 0.4rem"></td>
          <td><input class="plan-edit" data-tier-id="${t.id}" data-field="maxApiKeys" value="${t.maxApiKeys}" type="number" min="0" style="width:60px;background:transparent;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0.25rem 0.4rem"></td>
          <td><input class="plan-edit" data-tier-id="${t.id}" data-field="features" value="${escapeHtml(t.features.join(', '))}" style="width:100%;background:transparent;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--text-primary);padding:0.25rem 0.4rem"></td>
          <td>${isFree ? '' : `<button class="btn-danger plan-delete" data-tier-id="${t.id}" data-tier-name="${escapeHtml(t.name)}">Delete</button>`}</td>
        </tr>`;
      }).join('');
    }

    tbody.querySelectorAll('.plan-edit').forEach(input => {
      input.addEventListener('blur', async () => {
        const tierId = input.getAttribute('data-tier-id');
        const field = input.getAttribute('data-field');
        let value = input.value.trim();
        if (field === 'features') value = value.split(',').map(s => s.trim()).filter(Boolean);
        if (['priceMonthly', 'requestsPerDay', 'maxTokensPerDay', 'maxApiKeys'].includes(field)) {
          value = parseOptionalNumber(value);
        }
        try {
          await saasFetch(`/api/saas/admin/tiers/${tierId}`, {
            method: 'PATCH',
            body: JSON.stringify({ [field]: value }),
          });
        } catch (error) {
          console.error('Failed to update plan:', error);
        }
      });
    });

    tbody.querySelectorAll('.plan-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tierId = btn.getAttribute('data-tier-id');
        const name = btn.getAttribute('data-tier-name');
        if (!confirm(`Delete plan "${name}"? Users on this plan will be moved to Free.`)) return;
        await saasFetch(`/api/saas/admin/tiers/${tierId}`, { method: 'DELETE' });
        await loadAdminPlans();
      });
    });
  }

  function bindCreatePlan() {
    document.getElementById('plan-create-btn')?.addEventListener('click', async () => {
      const idInput = document.getElementById('plan-create-id');
      const nameInput = document.getElementById('plan-create-name');
      const priceInput = document.getElementById('plan-create-price');
      const reqInput = document.getElementById('plan-create-req');
      const tokensInput = document.getElementById('plan-create-tokens');
      const keysInput = document.getElementById('plan-create-keys');
      const featuresInput = document.getElementById('plan-create-features');
      const id = idInput?.value.trim() || '';
      const name = nameInput?.value.trim() || '';
      const price = Number(priceInput?.value) || 0;
      const req = parseOptionalNumber(reqInput?.value || '');
      const tokens = parseOptionalNumber(tokensInput?.value || '');
      const keys = Number(keysInput?.value) || 0;
      const features = (featuresInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!id || !name) {
        alert('Plan ID and Name are required');
        return;
      }
      try {
        await saasFetch('/api/saas/admin/tiers', {
          method: 'POST',
          body: JSON.stringify({ id, name, priceMonthly: price, requestsPerDay: req, maxTokensPerDay: tokens, maxApiKeys: keys, features }),
        });
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (priceInput) priceInput.value = '';
        if (reqInput) reqInput.value = '';
        if (tokensInput) tokensInput.value = '';
        if (keysInput) keysInput.value = '';
        if (featuresInput) featuresInput.value = '';
        alert('Plan created!');
        await loadAdminPlans();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  return {
    loadAdminPlans,
    bindCreatePlan,
  };
}
