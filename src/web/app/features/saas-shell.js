export function createSaasShell({ state }) {
  function showDashboardShell(dashboardShell) {
    if (!dashboardShell) return;
    dashboardShell.style.display = dashboardShell.classList.contains('agentrail-shell') ? 'flex' : 'block';
  }

  function isDashboardPage() {
    return Boolean(document.getElementById('dashboard-shell'));
  }

  function isPublicPage() {
    return Boolean(document.getElementById('public-shell'));
  }

  function redirectToDashboard() {
    if (window.location.pathname !== '/dashboard') {
      window.location.assign('/dashboard');
    }
  }

  function redirectToPublicHome() {
    if (window.location.pathname !== '/') {
      window.location.replace('/');
    }
  }

  function showAuthModal() {
    const publicShell = document.getElementById('public-shell');
    const dashboardShell = document.getElementById('dashboard-shell');
    const error = document.getElementById('auth-error');
    if (publicShell) publicShell.style.display = 'block';
    if (dashboardShell) dashboardShell.style.display = 'none';
    if (error) error.style.display = 'none';
    document.getElementById('auth-email')?.focus();
  }

  function hideAuthModal() {
    const publicShell = document.getElementById('public-shell');
    const dashboardShell = document.getElementById('dashboard-shell');
    if (publicShell) publicShell.style.display = 'none';
    showDashboardShell(dashboardShell);
  }

  function updateSaasUI() {
    const publicShell = document.getElementById('public-shell');
    const dashboardShell = document.getElementById('dashboard-shell');
    const userBtn = document.getElementById('saas-user-btn');
    const logoutBtn = document.getElementById('saas-logout-btn');
    const userName = document.getElementById('saas-user-name');
    const userEmail = document.getElementById('saas-user-email');
    const userRole = document.getElementById('saas-user-role');
    const adminBtn = document.getElementById('saas-admin-btn');
    const accountKeysBtn = document.getElementById('saas-keys-link')
      || document.getElementById('saas-keys-btn');

    if (state.saasUser) {
      if (publicShell) publicShell.style.display = 'none';
      showDashboardShell(dashboardShell);
      if (userBtn) userBtn.style.display = 'flex';
      if (logoutBtn) logoutBtn.style.display = 'inline-flex';
      if (userName) userName.textContent = state.saasUser.name || state.saasUser.email;
      if (userEmail) userEmail.textContent = state.saasUser.email || '';
      if (userRole) userRole.textContent = state.saasUser.isAdmin ? 'Admin' : 'User';
      if (adminBtn) adminBtn.style.display = state.saasUser.isAdmin ? 'flex' : 'none';
      if (accountKeysBtn) accountKeysBtn.style.display = 'flex';
      return;
    }

    if (publicShell) publicShell.style.display = 'block';
    if (dashboardShell) dashboardShell.style.display = 'none';
    if (userBtn) userBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userName) userName.textContent = 'Account';
    if (userEmail) userEmail.textContent = '';
    if (userRole) userRole.textContent = 'User';
    if (adminBtn) adminBtn.style.display = 'none';
    if (accountKeysBtn) accountKeysBtn.style.display = 'none';
  }

  return {
    isDashboardPage,
    isPublicPage,
    redirectToDashboard,
    redirectToPublicHome,
    showAuthModal,
    hideAuthModal,
    updateSaasUI,
  };
}
