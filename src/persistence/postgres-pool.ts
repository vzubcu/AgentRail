import type { Pool, PoolClient } from 'pg';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

export type PersistencePoolLike = Pick<Pool, 'query' | 'connect' | 'end'>;

let pool: Pool | null = null;
let poolOverride: PersistencePoolLike | null = null;

export function getPersistenceDatabaseUrl(): string {
  return process.env.AGENTRAIL_SECRETS_DATABASE_URL?.trim() || '';
}

export function isPostgresPersistenceEnabled(): boolean {
  return !!getPersistenceDatabaseUrl();
}

export function getPersistencePool(): PersistencePoolLike | null {
  if (poolOverride) {
    return poolOverride;
  }

  if (!isPostgresPersistenceEnabled()) {
    return null;
  }

  if (!pool) {
    try {
      const { Pool: PGPool } = _require('pg') as typeof import('pg');
      pool = new PGPool({
        connectionString: getPersistenceDatabaseUrl(),
      });
    } catch {
      throw new Error(
        'pg module is not available. Install it with: npm install pg',
      );
    }
  }

  return pool;
}

export function setPersistencePoolForTests(nextPool: PersistencePoolLike | null): void {
  poolOverride = nextPool;
}

export async function closePersistencePool(): Promise<void> {
  if (poolOverride) {
    await poolOverride.end();
    poolOverride = null;
  }

  if (!pool) return;
  const active = pool;
  pool = null;
  await active.end();
}
