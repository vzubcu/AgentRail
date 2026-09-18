import { usageTracker } from './usage-tracker.js';
import { initializePersistedApiKeys } from './config.js';
import { loadAllModelCaches, refreshConfiguredProviders, type RefreshConfiguredProvidersResult } from './providers/index.js';
import {
  checkAllProvidersHealth,
  getAllProviderHealth,
  loadPersistedProviderHealthSnapshot,
  persistProviderHealthSnapshot,
  type ProviderHealth,
} from './health.js';
import { runDatabaseMigrations } from './persistence/migrations.js';
import { isPostgresPersistenceEnabled } from './persistence/postgres-pool.js';
import { initDB } from './saas/db.js';
import { ensureAdminUserFromEnv } from './saas/auth.js';
import { reconcileVirtualModelOperationalState, reloadVirtualModels } from './virtual-models.js';

interface StartupProbeDeps {
  refreshConfiguredProviders: () => Promise<RefreshConfiguredProvidersResult>;
}

let startupProbeDeps: StartupProbeDeps = {
  refreshConfiguredProviders,
};

export async function prepareRuntimeForStartup(options: {
  allowedEnvVars: Set<string>;
  saasMode: boolean;
}): Promise<void> {
  if (isPostgresPersistenceEnabled()) {
    await runDatabaseMigrations();
  }

  await initializePersistedApiKeys(options.allowedEnvVars);
  await usageTracker.init();

  if (options.saasMode) {
    await initDB();
    await ensureAdminUserFromEnv();
    console.log('[SaaS] Multi-tenant mode enabled - user auth, rate limiting, and tier management active');
  }

  // Load virtual models from DB (falls back to defaults if unavailable)
  await reloadVirtualModels();
  await reconcileVirtualModelOperationalState();

  await loadAllModelCaches();
  await loadPersistedProviderHealthSnapshot();
}

export async function runStartupProviderProbe(): Promise<{
  refresh: RefreshConfiguredProvidersResult;
  health: ProviderHealth[];
}> {
  const refresh = await startupProbeDeps.refreshConfiguredProviders();
  const health = await checkAllProvidersHealth();
  await reconcileVirtualModelOperationalState();
  await persistProviderHealthSnapshot(getAllProviderHealth());
  return { refresh, health };
}

export function setStartupProbeDepsForTests(nextDeps: StartupProbeDeps | null): void {
  startupProbeDeps = nextDeps ?? { refreshConfiguredProviders };
}

export function startBackgroundModelRefresh(): void {
  runStartupProviderProbe().then((result) => {
    console.log(`[Sync] Refreshed configured providers: ${result.refresh.refreshed.join(', ') || 'none'}`);
    if (result.refresh.failed.length) {
      console.warn(`[Sync] Failed configured providers: ${result.refresh.failed.join(', ')}`);
    }
    if (result.refresh.skipped.length) {
      console.log(`[Sync] Skipped unconfigured providers: ${result.refresh.skipped.join(', ')}`);
    }

    const healthy = result.health.filter((entry) => entry.state === 'healthy').map((entry) => entry.provider);
    const unhealthy = result.health.filter((entry) => entry.state === 'unhealthy').map((entry) => entry.provider);
    console.log(`[Health] Healthy providers after startup probe: ${healthy.join(', ') || 'none'}`);
    if (unhealthy.length) {
      console.warn(`[Health] Unhealthy providers after startup probe: ${unhealthy.join(', ')}`);
    }
  }).catch((err) => {
    console.error('[Sync] Background startup probe failed:', err instanceof Error ? err.message : String(err));
  });
}

export function logStartupRoutes(options: { host: string; port: number; saasMode: boolean }): void {
  console.log(`AgentRail running on http://${options.host}:${options.port}`);
  console.log(`  Mode: ${options.saasMode ? 'SaaS (multi-tenant)' : 'Local (single-user)'}`);
  console.log('  GET  /');
  console.log('  GET  /api/catalog');
  console.log('  GET  /api/models/active');
  console.log('  GET  /api/usage');
  console.log('  POST /api/health/check/:provider');
  console.log('  POST /api/health/check-all');
  console.log('  POST /api/config/keys');
  console.log('  POST /api/models/refresh');
  console.log('  POST /v1/chat/completions');
  console.log('  GET  /v1/models');
  console.log('  POST /v1/messages');
  console.log('  GET  /health');
  if (options.saasMode) {
    console.log('  SaaS routes:');
    console.log('  POST /api/saas/auth/register');
    console.log('  POST /api/saas/auth/login');
    console.log('  POST /api/saas/auth/logout');
    console.log('  GET  /api/saas/auth/me');
    console.log('  GET  /api/saas/keys');
    console.log('  POST /api/saas/keys');
    console.log('  DELETE /api/saas/keys/:id');
    console.log('  GET  /api/saas/usage');
    console.log('  GET  /api/saas/account');
    console.log('  GET  /api/saas/admin/users');
    console.log('  GET  /api/saas/admin/usage');
  }
}
