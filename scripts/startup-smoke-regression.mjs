import assert from 'node:assert/strict';

process.env.AGENTRAIL_SECRETS_DATABASE_URL = 'postgres://agentrail:test@localhost:5432/agentrail';
process.env.HOST = '127.0.0.1';
process.env.AGENTRAIL_SAAS = '0';

const migrations = await import('../dist/persistence/migrations.js');
const pools = await import('../dist/persistence/postgres-pool.js');
const { prepareRuntimeForStartup } = await import('../dist/server-runtime.js');
const { createServer } = await import('../dist/server.js');

let migrationCalls = 0;
migrations.setMigrationRunnerForTests(async () => {
  migrationCalls += 1;
});
pools.setPersistencePoolForTests({
  async query() { return { rows: [], rowCount: 0 }; },
  async connect() { throw new Error('connect should not be called in startup smoke'); },
  async end() {},
});

const server = createServer({
  routeChatCompletion: async () => {
    throw new Error('chat routing should not be reached in startup smoke');
  },
});

try {
  await prepareRuntimeForStartup({
    allowedEnvVars: new Set(),
    saasMode: false,
  });
  assert.equal(migrationCalls, 1);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  pools.setPersistencePoolForTests(null);
  migrations.setMigrationRunnerForTests(null);
}

console.log('startup smoke regression passed');
