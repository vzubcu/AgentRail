import path from 'path';
import knex from 'knex';
import { getPersistenceDatabaseUrl, isPostgresPersistenceEnabled } from './postgres-pool.js';

let migrationPromise: Promise<void> | null = null;
let migrationRunnerOverride: (() => Promise<void>) | null = null;

async function executeDefaultMigrations(): Promise<void> {
  const db = knex({
    client: 'pg',
    connection: getPersistenceDatabaseUrl(),
    migrations: {
      directory: path.resolve(process.cwd(), 'migrations'),
      extension: 'cjs',
    },
  });

  try {
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }
}

export function setMigrationRunnerForTests(runner: (() => Promise<void>) | null): void {
  migrationRunnerOverride = runner;
  migrationPromise = null;
}

export async function runDatabaseMigrations(): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    return;
  }

  if (!migrationPromise) {
    migrationPromise = (migrationRunnerOverride ?? executeDefaultMigrations)();
  }

  await migrationPromise;
}
