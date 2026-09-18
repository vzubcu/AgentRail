function parseScopesInput(rawValue) {
  return rawValue
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

export function createSaasKeysFeature({ state, saasFetch, formatTime, escapeHtml, formatCapabilityLabel, copyText }) {
  async function loadSaasKeys() {
    if (!state.saasUser) return;

    try {
      const account = await saasFetch('/api/saas/account');
      document.getElementById('saas-plan-name-2').textContent = account.user?.tier || 'Free';

      const data = await saasFetch('/api/saas/keys');
      const tbody = document.getElementById('saas-keys-list');
      const keys = data.keys || [];
      if (keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No API keys yet. Create one above.</td></tr>';
      } else {
        tbody.innerHTML = keys.map(k => `
          <tr>
            <td>${escapeHtml(k.name)}</td>
            <td style="max-width:280px"><code class="key-reveal" style="font-size:0.65rem;word-break:break-all;display:inline-block;vertical-align:middle">${escapeHtml(k.keyPreview || 'Configured')}</code></td>
            <td>${(k.scopes || []).length ? k.scopes.map(scope => escapeHtml(formatCapabilityLabel(scope))).join(', ') : 'All'}</td>
            <td>${formatTime(k.createdAt)}</td>
            <td>${k.lastUsedAt ? formatTime(k.lastUsedAt) : 'Never'}</td>
            <td class="${k.isActive ? 'key-active' : 'key-inactive'}">${k.isActive ? 'Active' : 'Revoked'}</td>
            <td style="display:flex;gap:0.35rem;align-items:center">${k.isActive ? `<button class="btn-secondary" data-copy-key="${escapeHtml(k.key || k.keyPreview)}" title="Copy full key" style="font-size:0.7rem;padding:0.25rem 0.5rem">Copy</button><button class="btn-danger" data-revoke-key="${k.id}">Revoke</button>` : '—'}</td>
          </tr>
        `).join('');
      }

      tbody.querySelectorAll('[data-revoke-key]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Revoke this API key? This cannot be undone.')) return;
          await saasFetch(`/api/saas/keys/${btn.getAttribute('data-revoke-key')}`, { method: 'DELETE' });
          await loadSaasKeys();
        });
      });

      tbody.querySelectorAll('[data-copy-key]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const value = btn.getAttribute('data-copy-key') || '';
          try {
            await copyText(value);
            btn.textContent = 'Copied!';
          } catch {
            btn.textContent = 'Retry';
          } finally {
            window.setTimeout(() => {
              btn.textContent = 'Copy';
            }, 2000);
          }
        });
      });
    } catch (error) {
      console.error('Failed to load SaaS keys:', error);
    }
  }

  function bind() {
    const createKeyBtn = document.getElementById('saas-create-key');
    if (!createKeyBtn) return;

    createKeyBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('saas-new-key-name');
      const scopesInput = document.getElementById('saas-new-key-scopes');
      const name = nameInput?.value.trim() || 'default';
      const scopes = parseScopesInput(scopesInput?.value.trim() || '');
      try {
        await saasFetch('/api/saas/keys', {
          method: 'POST',
          body: JSON.stringify({ name, scopes }),
        });
        if (nameInput) nameInput.value = '';
        if (scopesInput) scopesInput.value = '';
        await loadSaasKeys();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  return {
    bind,
    loadSaasKeys,
  };
}
