import { createAdminPlansFeature } from './plans.js';
import { createAdminUsersFeature } from './users.js';
import { createAdminUsageFeature } from './usage.js';

export function createSaasAdminFeature({ state, saasFetch, formatTime, formatNumber, escapeHtml }) {
  const plansFeature = createAdminPlansFeature({ state, saasFetch, escapeHtml });
  const usersFeature = createAdminUsersFeature({ state, saasFetch, formatTime, escapeHtml });
  const usageFeature = createAdminUsageFeature({ saasFetch, formatNumber });

  async function loadSaasAdmin() {
    if (!state.saasUser?.isAdmin) return;

    try {
      await plansFeature.loadAdminPlans();
      await usersFeature.loadAdminUsers();
      await usageFeature.loadAdminUsage();
    } catch (error) {
      console.error('Failed to load admin:', error);
    }
  }

  function bind() {
    usageFeature.bindSectionSwitcher();
    usersFeature.bindCreateUser();
    plansFeature.bindCreatePlan();
  }

  return {
    bind,
    loadSaasAdmin,
    loadAdminPlans: plansFeature.loadAdminPlans,
    loadAdminUsers: usersFeature.loadAdminUsers,
    loadAdminUsage: usageFeature.loadAdminUsage,
  };
}
