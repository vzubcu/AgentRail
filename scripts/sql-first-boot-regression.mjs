import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AGENTRAIL_SECRETS_DATABASE_URL = 'postgres://agentrail:test@localhost:5432/agentrail';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-sql-first-boot-'));
process.chdir(tempRoot);
fs.mkdirSync(path.join(tempRoot, '.agentrail', 'saas'), { recursive: true });
fs.writeFileSync(path.join(tempRoot, '.agentrail', 'saas', 'db.json'), JSON.stringify({
  users: [
    {
      id: 'user_1',
      email: 'admin@test.local',
      name: 'Admin',
      passwordHash: 'hash',
      tier: 'pro',
      isAdmin: true,
      isActive: true,
      createdAt: 1000,
    },
  ],
  apiKeys: [
    {
      id: 'key_1',
      userId: 'user_1',
      keyPreview: 'fw_...1234',
      name: 'CLI',
      isActive: true,
      createdAt: 2000,
      lastUsedAt: null,
      scopes: ['chat'],
    },
  ],
  sessions: [
    {
      id: 'sess_1',
      userId: 'user_1',
      tokenHash: 'token_hash',
      csrfToken: 'csrf',
      createdAt: 3000,
      expiresAt: Date.now() + 86400000,
      lastUsedAt: 3000,
    },
  ],
  usage: [
    {
      userId: 'user_1',
      date: '2026-07-07',
      requests: 2,
      promptTokens: 12,
      completionTokens: 8,
    },
  ],
  tiers: [
    {
      id: 'starter',
      name: 'Starter',
      requestsPerDay: 50,
      maxApiKeys: 2,
      maxTokensPerDay: 5000,
      priceMonthly: 5,
      features: ['starter'],
    },
  ],
  auditEvents: [
    {
      id: 'evt_1',
      type: 'login',
      userId: 'user_1',
      ip: '127.0.0.1',
      metadata: { source: 'test' },
      createdAt: 4000,
    },
  ],
}, null, 2));

const inserted = [];
const counts = new Map([
  ['SELECT COUNT(*)::int AS count FROM agentrail_saas_users', [{ count: 0 }]],
  ['SELECT id FROM agentrail_saas_tiers LIMIT 1', []],
]);

const fakeClient = {
  async query(sql, params) {
    const normalized = String(sql).trim().replace(/\s+/g, ' ');
    inserted.push({ sql: normalized, params });
    return { rows: [], rowCount: 1 };
  },
  release() {},
};

const fakePool = {
  async query(sql) {
    const normalized = String(sql).trim().replace(/\s+/g, ' ');
    const rows = counts.get(normalized) ?? [];
    return { rows, rowCount: rows.length };
  },
  async connect() {
    return fakeClient;
  },
  async end() {},
};

const migrations = await import('../dist/persistence/migrations.js');
const pools = await import('../dist/persistence/postgres-pool.js');
const postgresDb = await import('../dist/saas/postgres-db.js');

migrations.setMigrationRunnerForTests(async () => {});
pools.setPersistencePoolForTests(fakePool);
postgresDb.resetPostgresDbForTests();

try {
  await postgresDb.initDB();
} finally {
  postgresDb.resetPostgresDbForTests();
  pools.setPersistencePoolForTests(null);
  migrations.setMigrationRunnerForTests(null);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

assert.ok(inserted.some((entry) => entry.sql.includes('INSERT INTO agentrail_saas_users')));
assert.ok(inserted.some((entry) => entry.sql.includes('INSERT INTO agentrail_saas_api_keys_metadata')));
assert.ok(inserted.some((entry) => entry.sql.includes('INSERT INTO agentrail_saas_sessions')));
assert.ok(inserted.some((entry) => entry.sql.includes('INSERT INTO agentrail_saas_usage_daily')));
assert.ok(inserted.some((entry) => entry.sql.includes('INSERT INTO agentrail_saas_tiers')));
assert.ok(inserted.some((entry) => entry.sql.includes('INSERT INTO agentrail_saas_audit_events')));
assert.ok(inserted.some((entry) => entry.sql.includes('BEGIN')));
assert.ok(inserted.some((entry) => entry.sql.includes('COMMIT')));

console.log('sql first boot regression passed');
