import type { PoolClient } from 'pg';
import { runDatabaseMigrations } from '../persistence/migrations.js';
import { getPersistencePool } from '../persistence/postgres-pool.js';
import { readLegacyDatabaseSnapshot } from './legacy-db.js';
import type { ApiKey, AuditEvent, DailyUsage, SessionRecord, TierRecord, User } from './types.js';

const DEFAULT_TIERS: TierRecord[] = [
  {
    id: 'free',
    name: 'Free',
    requestsPerDay: 100,
    maxApiKeys: 3,
    maxTokensPerDay: 500_000,
    priceMonthly: 0,
    features: ['100 requests / day', '3 API keys', 'Basic model access', 'Community support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    requestsPerDay: 1000,
    maxApiKeys: 10,
    maxTokensPerDay: 5_000_000,
    priceMonthly: 19,
    features: ['1,000 requests / day', '10 API keys', 'All models including premium', 'Priority routing', 'Email support'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    requestsPerDay: null,
    maxApiKeys: 100,
    maxTokensPerDay: null,
    priceMonthly: 99,
    features: ['Unlimited requests', '100 API keys', 'All models', 'Priority routing', 'Dedicated support', '99.9% SLA', 'Custom integrations'],
  },
];

let initialized = false;
let initPromise: Promise<void> | null = null;

function requirePool() {
  const pool = getPersistencePool();
  if (!pool) {
    throw new Error('Postgres persistence is not configured');
  }
  return pool;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    passwordHash: String(row.password_hash),
    tier: String(row.tier),
    isAdmin: Boolean(row.is_admin),
    isActive: Boolean(row.is_active),
    createdAt: toNumber(row.created_at) ?? 0,
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    keyPreview: String(row.key_preview),
    name: String(row.name),
    isActive: Boolean(row.is_active),
    createdAt: toNumber(row.created_at) ?? 0,
    lastUsedAt: toNumber(row.last_used_at),
    scopes: toStringArray(row.scopes),
  };
}

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    csrfToken: String(row.csrf_token),
    createdAt: toNumber(row.created_at) ?? 0,
    expiresAt: toNumber(row.expires_at) ?? 0,
    lastUsedAt: toNumber(row.last_used_at) ?? 0,
  };
}

function mapUsage(row: Record<string, unknown>): DailyUsage {
  return {
    userId: String(row.user_id),
    date: String(row.date),
    requests: Number(row.requests ?? 0),
    promptTokens: toNumber(row.prompt_tokens) ?? 0,
    completionTokens: toNumber(row.completion_tokens) ?? 0,
  };
}

function mapTier(row: Record<string, unknown>): TierRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    requestsPerDay: toNumber(row.requests_per_day),
    maxApiKeys: Number(row.max_api_keys ?? 0),
    maxTokensPerDay: toNumber(row.max_tokens_per_day),
    priceMonthly: Number(row.price_monthly ?? 0),
    features: toStringArray(row.features),
  };
}

function mapAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    type: String(row.type),
    userId: typeof row.user_id === 'string' ? row.user_id : undefined,
    ip: typeof row.ip === 'string' ? row.ip : undefined,
    metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata as Record<string, unknown> : undefined,
    createdAt: toNumber(row.created_at) ?? 0,
  };
}

async function ensureDefaultTiers(): Promise<void> {
  const pool = requirePool();
  const existing = await pool.query('SELECT id FROM agentrail_saas_tiers LIMIT 1');
  if (existing.rows.length > 0) return;

  for (const tier of DEFAULT_TIERS) {
    await pool.query(
      `INSERT INTO agentrail_saas_tiers (id, name, requests_per_day, max_api_keys, max_tokens_per_day, price_monthly, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [tier.id, tier.name, tier.requestsPerDay, tier.maxApiKeys, tier.maxTokensPerDay, tier.priceMonthly, JSON.stringify(tier.features)],
    );
  }
}

async function importLegacyIfNeeded(): Promise<void> {
  const pool = requirePool();
  const usersResult = await pool.query('SELECT COUNT(*)::int AS count FROM agentrail_saas_users');
  const userCount = Number(usersResult.rows[0]?.count ?? 0);
  if (userCount > 0) return;

  const snapshot = await readLegacyDatabaseSnapshot();
  if (!snapshot) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const user of snapshot.users) {
      await client.query(
        `INSERT INTO agentrail_saas_users (id, email, name, password_hash, tier, is_admin, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.email, user.name, user.passwordHash, user.tier, user.isAdmin, user.isActive, user.createdAt],
      );
    }

    for (const key of snapshot.apiKeys) {
      await client.query(
        `INSERT INTO agentrail_saas_api_keys_metadata (id, user_id, key_preview, name, is_active, created_at, last_used_at, scopes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [key.id, key.userId, key.keyPreview, key.name, key.isActive, key.createdAt, key.lastUsedAt, JSON.stringify(key.scopes ?? [])],
      );
    }

    for (const session of snapshot.sessions) {
      await client.query(
        `INSERT INTO agentrail_saas_sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [session.id, session.userId, session.tokenHash, session.csrfToken, session.createdAt, session.expiresAt, session.lastUsedAt],
      );
    }

    for (const usage of snapshot.usage) {
      await client.query(
        `INSERT INTO agentrail_saas_usage_daily (user_id, date, requests, prompt_tokens, completion_tokens)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, date) DO NOTHING`,
        [usage.userId, usage.date, usage.requests, usage.promptTokens, usage.completionTokens],
      );
    }

    for (const tier of snapshot.tiers) {
      await client.query(
        `INSERT INTO agentrail_saas_tiers (id, name, requests_per_day, max_api_keys, max_tokens_per_day, price_monthly, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [tier.id, tier.name, tier.requestsPerDay, tier.maxApiKeys, tier.maxTokensPerDay, tier.priceMonthly, JSON.stringify(tier.features)],
      );
    }

    for (const event of snapshot.auditEvents) {
      await client.query(
        `INSERT INTO agentrail_saas_audit_events (id, type, user_id, ip, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type, event.userId ?? null, event.ip ?? null, JSON.stringify(event.metadata ?? null), event.createdAt],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function initDB(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      await runDatabaseMigrations();
      await importLegacyIfNeeded();
      await pruneExpiredSessions();
      await ensureDefaultTiers();
      initialized = true;
    })();
  }
  await initPromise;
}

export async function createUser(user: User): Promise<void> {
  const pool = requirePool();
  await pool.query(
    `INSERT INTO agentrail_saas_users (id, email, name, password_hash, tier, is_admin, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [user.id, user.email, user.name, user.passwordHash, user.tier, user.isAdmin, user.isActive, user.createdAt],
  );
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_users WHERE email = $1 LIMIT 1', [email]);
  return result.rows[0] ? mapUser(result.rows[0]) : undefined;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_users WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? mapUser(result.rows[0]) : undefined;
}

export async function listUsers(): Promise<User[]> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_users ORDER BY created_at ASC');
  return result.rows.map(mapUser);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
  const existing = await getUserById(id);
  if (!existing) return undefined;
  const next = { ...existing, ...updates };
  const pool = requirePool();
  await pool.query(
    `UPDATE agentrail_saas_users
     SET email = $2, name = $3, password_hash = $4, tier = $5, is_admin = $6, is_active = $7, created_at = $8
     WHERE id = $1`,
    [id, next.email, next.name, next.passwordHash, next.tier, next.isAdmin, next.isActive, next.createdAt],
  );
  return next;
}

export async function deleteUser(id: string): Promise<boolean> {
  const pool = requirePool();
  const result = await pool.query('DELETE FROM agentrail_saas_users WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function createApiKey(key: ApiKey): Promise<void> {
  const pool = requirePool();
  await pool.query(
    `INSERT INTO agentrail_saas_api_keys_metadata (id, user_id, key_preview, name, is_active, created_at, last_used_at, scopes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [key.id, key.userId, key.keyPreview, key.name, key.isActive, key.createdAt, key.lastUsedAt, JSON.stringify(key.scopes ?? [])],
  );
}

export async function getApiKeyById(id: string): Promise<ApiKey | undefined> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_api_keys_metadata WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? mapApiKey(result.rows[0]) : undefined;
}

export async function listApiKeysForUser(userId: string): Promise<ApiKey[]> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_api_keys_metadata WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
  return result.rows.map(mapApiKey);
}

export async function revokeApiKey(id: string, userId: string): Promise<boolean> {
  const pool = requirePool();
  const result = await pool.query(
    'UPDATE agentrail_saas_api_keys_metadata SET is_active = FALSE WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function touchApiKeyById(id: string): Promise<void> {
  const pool = requirePool();
  await pool.query('UPDATE agentrail_saas_api_keys_metadata SET last_used_at = $2 WHERE id = $1', [id, Date.now()]);
}

export async function countActiveKeys(userId: string): Promise<number> {
  const pool = requirePool();
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM agentrail_saas_api_keys_metadata WHERE user_id = $1 AND is_active = TRUE', [userId]);
  return Number(result.rows[0]?.count ?? 0);
}

export async function createSessionRecord(session: SessionRecord): Promise<void> {
  const pool = requirePool();
  await pool.query(
    `INSERT INTO agentrail_saas_sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [session.id, session.userId, session.tokenHash, session.csrfToken, session.createdAt, session.expiresAt, session.lastUsedAt],
  );
}

export async function getSessionByHash(tokenHash: string): Promise<SessionRecord | undefined> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_sessions WHERE token_hash = $1 LIMIT 1', [tokenHash]);
  return result.rows[0] ? mapSession(result.rows[0]) : undefined;
}

export async function touchSessionByHash(tokenHash: string): Promise<void> {
  const pool = requirePool();
  await pool.query('UPDATE agentrail_saas_sessions SET last_used_at = $2 WHERE token_hash = $1', [tokenHash, Date.now()]);
}

export async function deleteSessionByHash(tokenHash: string): Promise<boolean> {
  const pool = requirePool();
  const result = await pool.query('DELETE FROM agentrail_saas_sessions WHERE token_hash = $1', [tokenHash]);
  return (result.rowCount ?? 0) > 0;
}

export async function pruneExpiredSessions(): Promise<void> {
  const pool = requirePool();
  await pool.query('DELETE FROM agentrail_saas_sessions WHERE expires_at <= $1', [Date.now()]);
}

export async function createAuditEvent(event: AuditEvent): Promise<void> {
  const pool = requirePool();
  await pool.query(
    `INSERT INTO agentrail_saas_audit_events (id, type, user_id, ip, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [event.id, event.type, event.userId ?? null, event.ip ?? null, JSON.stringify(event.metadata ?? null), event.createdAt],
  );
}

export async function listAuditEvents(limit = 100): Promise<AuditEvent[]> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_audit_events ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map(mapAuditEvent);
}

export async function getDailyUsage(userId: string, date: string): Promise<DailyUsage | undefined> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_usage_daily WHERE user_id = $1 AND date = $2 LIMIT 1', [userId, date]);
  return result.rows[0] ? mapUsage(result.rows[0]) : undefined;
}

export async function recordUsage(userId: string, promptTokens: number, completionTokens: number): Promise<void> {
  const pool = requirePool();
  const date = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO agentrail_saas_usage_daily (user_id, date, requests, prompt_tokens, completion_tokens)
     VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT (user_id, date) DO UPDATE
     SET requests = agentrail_saas_usage_daily.requests + 1,
         prompt_tokens = agentrail_saas_usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = agentrail_saas_usage_daily.completion_tokens + EXCLUDED.completion_tokens`,
    [userId, date, promptTokens, completionTokens],
  );
}

export async function getUserUsageHistory(userId: string, limit = 30): Promise<DailyUsage[]> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_usage_daily WHERE user_id = $1 ORDER BY date DESC LIMIT $2', [userId, limit]);
  return result.rows.map(mapUsage);
}

export async function getAllUsageHistory(limit = 100): Promise<DailyUsage[]> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_usage_daily ORDER BY date DESC LIMIT $1', [limit]);
  return result.rows.map(mapUsage);
}

export async function listTiers(): Promise<TierRecord[]> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_tiers ORDER BY id ASC');
  return result.rows.map(mapTier);
}

export async function getTierById(id: string): Promise<TierRecord | undefined> {
  const pool = requirePool();
  const result = await pool.query('SELECT * FROM agentrail_saas_tiers WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? mapTier(result.rows[0]) : undefined;
}

export async function createTier(tier: TierRecord): Promise<void> {
  const pool = requirePool();
  await pool.query(
    `INSERT INTO agentrail_saas_tiers (id, name, requests_per_day, max_api_keys, max_tokens_per_day, price_monthly, features)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [tier.id, tier.name, tier.requestsPerDay, tier.maxApiKeys, tier.maxTokensPerDay, tier.priceMonthly, JSON.stringify(tier.features)],
  );
}

export async function updateTier(id: string, updates: Partial<TierRecord>): Promise<TierRecord | undefined> {
  const existing = await getTierById(id);
  if (!existing) return undefined;
  const next = { ...existing, ...updates };
  const pool = requirePool();
  await pool.query(
    `UPDATE agentrail_saas_tiers
     SET name = $2, requests_per_day = $3, max_api_keys = $4, max_tokens_per_day = $5, price_monthly = $6, features = $7::jsonb
     WHERE id = $1`,
    [id, next.name, next.requestsPerDay, next.maxApiKeys, next.maxTokensPerDay, next.priceMonthly, JSON.stringify(next.features)],
  );
  return next;
}

export async function deleteTier(id: string): Promise<boolean> {
  const pool = requirePool();
  const result = await pool.query('DELETE FROM agentrail_saas_tiers WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}


export function resetPostgresDbForTests(): void {
  initialized = false;
  initPromise = null;
}
