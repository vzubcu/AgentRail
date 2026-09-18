#!/usr/bin/env node
// Creates the first SaaS admin user from environment variables
// Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secure123 node scripts/init-saas-admin.mjs

const { initDB, getUserByEmail } = await import('../dist/saas/db.js');
const { register, makeUserAdmin } = await import('../dist/saas/auth.js');

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.log('[SaaS Init] SKIP: ADMIN_EMAIL or ADMIN_PASSWORD not set');
  process.exit(0);
}

await initDB();

const existing = await getUserByEmail(email);
if (existing) {
  console.log(`[SaaS Init] Admin user "${email}" already exists`);
  process.exit(0);
}

const result = await register(email, password, 'Admin');
if (!result.ok) {
  console.error(`[SaaS Init] Failed: ${result.error}`);
  process.exit(1);
}

await makeUserAdmin(result.user.id);
console.log(`[SaaS Init] Admin user "${email}" created successfully`);
