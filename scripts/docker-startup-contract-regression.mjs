import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entrypoint = await readFile(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/server-runtime.ts', import.meta.url), 'utf8');

assert.match(runtime, /runDatabaseMigrations\(\)/, 'server-runtime should own runtime migration invocation');
assert.match(runtime, /ensureAdminUserFromEnv\(\)/, 'server-runtime should own admin-user bootstrap');

assert.doesNotMatch(
  entrypoint,
  /npm run migrate:latest/,
  'docker-entrypoint.sh should not invoke migrations directly when runtime startup already owns migration orchestration',
);

assert.doesNotMatch(
  entrypoint,
  /init-saas-admin\.mjs/,
  'docker-entrypoint.sh should not invoke init-saas-admin.mjs when runtime startup already owns admin bootstrap',
);

assert.doesNotMatch(
  entrypoint,
  /\r/,
  'docker-entrypoint.sh must use LF line endings so the shell does not append carriage returns to startup arguments',
);

console.log('docker startup contract regression passed');