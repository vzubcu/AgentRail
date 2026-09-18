import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

process.env.AGENTRAIL_SAAS = '1';
delete process.env.AGENTRAIL_ADMIN_EMAIL;
delete process.env.AGENTRAIL_ADMIN_PASSWORD;
delete process.env.AGENTRAIL_ADMIN_NAME;
process.env.ADMIN_EMAIL = 'admin-compat@example.com';
process.env.ADMIN_PASSWORD = 'compat-secret';

const { initDB, getUserByEmail } = await import('../dist/saas/db.js');
const { ensureAdminUserFromEnv, login } = await import('../dist/saas/auth.js');

const root = process.cwd();
const agentrailDir = path.join(root, '.agentrail');

await rm(agentrailDir, { recursive: true, force: true });
await mkdir(agentrailDir, { recursive: true });

try {
  await initDB();
  const user = await ensureAdminUserFromEnv();
  assert(user, 'expected admin bootstrap from legacy ADMIN_* env vars');
  assert.equal(user.email, 'admin-compat@example.com');
  assert.equal(user.isAdmin, true);

  const persisted = await getUserByEmail('admin-compat@example.com');
  assert(persisted, 'expected admin user to be persisted');

  const result = await login('admin-compat@example.com', 'compat-secret', '127.0.0.1');
  assert.equal(result.ok, true, 'expected login with legacy ADMIN_* credentials to succeed');

  console.log('admin env compatibility regression passed');
} finally {
  await rm(agentrailDir, { recursive: true, force: true });
}
