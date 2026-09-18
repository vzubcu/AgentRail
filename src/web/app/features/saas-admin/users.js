export function createAdminUsersFeature({ state, saasFetch, formatTime, escapeHtml }) {
  async function loadAdminUsers() {
    const usersData = await saasFetch('/api/saas/admin/users');
    const tbody = document.getElementById('saas-admin-users-list');
    const users = usersData.users || [];
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">No users.</td></tr>';
    } else {
      tbody.innerHTML = users.map(u => {
        const tierOpts = state.cachedTiers.map(t => `<option value="${t.id}" ${u.tier === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
        return `<tr>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.name)}</td>
          <td><select class="admin-tier-select" data-user-tier="${u.id}">${tierOpts}</select></td>
          <td><button class="btn-secondary admin-toggle-admin" data-user-id="${u.id}" data-is-admin="${u.isAdmin}">${u.isAdmin ? 'Revoke' : 'Make Admin'}</button></td>
          <td><button class="btn-${u.isActive ? 'danger' : 'primary'} admin-toggle-active" data-user-id="${u.id}" data-is-active="${u.isActive}">${u.isActive ? 'Block' : 'Unblock'}</button></td>
          <td>${formatTime(u.createdAt)}</td>
          <td><button class="btn-secondary admin-show-keys" data-user-id="${u.id}">Keys</button></td>
          <td><button class="btn-danger admin-delete-user" data-user-id="${u.id}" data-user-email="${escapeHtml(u.email)}">Delete</button></td>
        </tr>`;
      }).join('');
    }

    tbody.querySelectorAll('.admin-tier-select').forEach(select => {
      select.addEventListener('change', async () => {
        const userId = select.getAttribute('data-user-tier');
        await saasFetch(`/api/saas/admin/users/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ tier: select.value }),
        });
        await loadAdminUsers();
      });
    });

    tbody.querySelectorAll('.admin-toggle-admin').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-user-id');
        const isAdmin = btn.getAttribute('data-is-admin') === 'true';
        await saasFetch(`/api/saas/admin/users/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ isAdmin: !isAdmin }),
        });
        await loadAdminUsers();
      });
    });

    tbody.querySelectorAll('.admin-toggle-active').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-user-id');
        const isActive = btn.getAttribute('data-is-active') === 'true';
        if (isActive && !confirm('Block this user? Their API keys will stop working.')) return;
        await saasFetch(`/api/saas/admin/users/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !isActive }),
        });
        await loadAdminUsers();
      });
    });

    tbody.querySelectorAll('.admin-show-keys').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-user-id');
        try {
          const data = await saasFetch(`/api/saas/admin/keys/${userId}`);
          const keys = data.keys || [];
          if (keys.length === 0) {
            alert('No API keys for this user.');
            return;
          }
          alert(keys.map(k => `${k.name}: ${k.keyPreview || 'Configured'} (${k.isActive ? 'Active' : 'Revoked'})`).join('\n'));
        } catch (error) {
          alert('Failed to load keys: ' + error.message);
        }
      });
    });

    tbody.querySelectorAll('.admin-delete-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.getAttribute('data-user-id');
        const email = btn.getAttribute('data-user-email');
        if (!confirm(`Permanently delete user "${email}"? This cannot be undone.`)) return;
        await saasFetch(`/api/saas/admin/users/${userId}`, { method: 'DELETE' });
        await loadAdminUsers();
      });
    });
  }

  function bindCreateUser() {
    document.getElementById('admin-create-user-btn')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('admin-create-name');
      const emailInput = document.getElementById('admin-create-email');
      const passwordInput = document.getElementById('admin-create-password');
      const tierInput = document.getElementById('admin-create-tier');
      const isAdminInput = document.getElementById('admin-create-is-admin');
      const name = nameInput?.value.trim() || '';
      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';
      const tier = tierInput?.value || 'free';
      const isAdmin = Boolean(isAdminInput?.checked);
      if (!name || !email || !password) {
        alert('Fill all fields');
        return;
      }
      try {
        await saasFetch('/api/saas/admin/users', {
          method: 'POST',
          body: JSON.stringify({ name, email, password, tier, isAdmin }),
        });
        if (nameInput) nameInput.value = '';
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        alert('User created!');
        await loadAdminUsers();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  return {
    loadAdminUsers,
    bindCreateUser,
  };
}
