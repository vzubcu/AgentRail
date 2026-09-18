export function createSaasAuthFeature({
  state,
  defaultTabId,
  getTabIdFromPath,
  activateTab,
  loadCatalog,
  loadUsage,
  shell,
}) {
  async function saasAuthFetch(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    if (data.csrfToken) {
      state.saasCsrfToken = data.csrfToken;
    }
    return data;
  }

  async function saasFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    const method = (options.method || 'GET').toUpperCase();
    if (state.saasCsrfToken && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      headers.set('x-csrf-token', state.saasCsrfToken);
    }

    const response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    if (response.status === 401) {
      state.saasUser = null;
      shell.updateSaasUI();
      shell.showAuthModal();
      if (shell.isDashboardPage()) {
        shell.redirectToPublicHome();
      }
      throw new Error('Session expired. Please sign in again.');
    }

    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function canActivateTab(tabId) {
    if (!state.saasUser && tabId !== 'public') {
      return false;
    }
    if (tabId === 'saas-admin' && !state.saasUser?.isAdmin) {
      return false;
    }
    return true;
  }

  async function loadAuthenticatedDashboard() {
    if (!shell.isDashboardPage()) return;
    await loadCatalog();
    await loadUsage();
    const currentTab = getTabIdFromPath(window.location.pathname);
    const nextTab = currentTab === defaultTabId || document.getElementById(currentTab)
      ? currentTab
      : defaultTabId;
    activateTab(nextTab, { updateHistory: true, replaceHistory: true });
  }

  async function checkSaasAuth() {
    try {
      const data = await saasFetch('/api/saas/auth/me');
      state.saasUser = data.user;
      state.saasCsrfToken = data.csrfToken || '';
    } catch {
      state.saasUser = null;
      state.saasCsrfToken = '';
    }

    shell.updateSaasUI();
    if (state.saasUser) {
      if (shell.isPublicPage() && !shell.isDashboardPage()) {
        shell.redirectToDashboard();
        return;
      }
      await loadAuthenticatedDashboard();
    } else if (shell.isDashboardPage()) {
      shell.redirectToPublicHome();
    }
  }

  function bind({ onLoggedIn, onLoggedOut }) {
    const loginForm = document.getElementById('auth-login-form');
    const loginBtn = document.getElementById('auth-login-btn');

    const handleLogin = async event => {
      event?.preventDefault();
      const email = document.getElementById('auth-email')?.value ?? '';
      const password = document.getElementById('auth-password')?.value ?? '';
      const errEl = document.getElementById('auth-error');
      try {
        if (loginBtn) loginBtn.disabled = true;
        const result = await saasAuthFetch('/api/saas/auth/login', { email, password });
        state.saasUser = result.user;
        state.saasCsrfToken = result.csrfToken || '';
        shell.updateSaasUI();
        shell.hideAuthModal();
        await onLoggedIn?.();
        if (!shell.isDashboardPage()) {
          shell.redirectToDashboard();
          return;
        }
        await loadAuthenticatedDashboard();
      } catch (error) {
        if (errEl) {
          errEl.textContent = error.message;
          errEl.style.display = 'block';
        } else {
          alert(error.message);
        }
      } finally {
        if (loginBtn) loginBtn.disabled = false;
      }
    };

    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    } else if (loginBtn) {
      loginBtn.addEventListener('click', handleLogin);
    }

    document.getElementById('saas-logout-btn')?.addEventListener('click', async () => {
      if (!confirm('Sign out?')) return;
      await saasFetch('/api/saas/auth/logout', { method: 'POST' });
      state.saasUser = null;
      state.saasCsrfToken = '';
      shell.updateSaasUI();
      await onLoggedOut?.();
      shell.redirectToPublicHome();
    });
  }

  return {
    bind,
    canActivateTab,
    checkSaasAuth,
    loadAuthenticatedDashboard,
    saasAuthFetch,
    saasFetch,
  };
}
