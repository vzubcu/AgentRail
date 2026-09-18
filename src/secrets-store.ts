import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { clearLegacyPersistedConfig, getPersistedConfigPath, loadLegacyPersistedConfig } from './config-store.js';
import { runDatabaseMigrations } from './persistence/migrations.js';
import { getPersistencePool } from './persistence/postgres-pool.js';
import { listLegacyApiKeySecrets, scrubLegacyApiKeySecrets } from './saas/legacy-db.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const CLOUDFLARE_CREDENTIAL_SEPARATOR = '::cf-account::';
const GATEWAY_SECRET_NAME = 'AGENTRAIL_API_KEY';
const DEFAULT_META_PATH = 'postgres://agentrail-secrets';
const providerTableName = 'agentrail_provider_secrets';
const gatewayTableName = 'agentrail_gateway_secrets';
const saasTableName = 'agentrail_saas_api_secrets';
const SAAS_KEY_SECRETS_JSON_PATH = path.resolve(process.cwd(), '.agentrail', 'saas-key-secrets.json');
let saasKeysJsonLoaded = false;

export interface SecretStoreMeta {
  backend: 'postgres' | 'legacy-json' | 'none';
  persistedPath: string | null;
  persistedUpdatedAt: number | null;
}

interface SecretEnvelope {
  iv: string;
  ciphertext: string;
  authTag: string;
}

interface ProviderSecretRow {
  env_var: string;
  fingerprint: string;
  ordinal: number;
  encrypted_iv: string;
  encrypted_value: string;
  encrypted_auth_tag: string;
  preview: string;
  secondary_label: string | null;
  secondary_preview: string | null;
  updated_at: number;
}

interface LegacySaasApiKeySecret {
  id: string;
  userId: string;
  key: string;
  keyPreview: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

let migrationPromise: Promise<void> | null = null;
let meta: SecretStoreMeta = { backend: 'none', persistedPath: null, persistedUpdatedAt: null };
let inMemoryGatewayKeyHash: string | null = null;
const inMemorySaasApiKeys = new Map<string, { id: string; userId: string; keyHash: string; isActive: boolean; createdAt: number; lastUsedAt: number | null; keyPreview: string; keyValue: string | null }>();
async function loadSaasKeySecretsFromJson(): Promise<void> {
  if (saasKeysJsonLoaded) return;
  saasKeysJsonLoaded = true;
  try {
    const raw = await readFile(SAAS_KEY_SECRETS_JSON_PATH, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ id: string; userId: string; keyHash: string; isActive: boolean; createdAt: number; lastUsedAt: number | null; keyPreview: string; keyValue: string | null }>;
    for (const entry of entries) {
      inMemorySaasApiKeys.set(entry.id, entry);
    }
  } catch {
    // file doesn't exist yet
  }
}

async function saveSaasKeySecretsToJson(): Promise<void> {
  const entries = Array.from(inMemorySaasApiKeys.values());
  await mkdir(path.dirname(SAAS_KEY_SECRETS_JSON_PATH), { recursive: true });
  await writeFile(SAAS_KEY_SECRETS_JSON_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}


function getDatabaseUrl(): string {
  return process.env.AGENTRAIL_SECRETS_DATABASE_URL?.trim() || '';
}

function getEncryptionKeySource(): string {
  return process.env.AGENTRAIL_SECRET_ENCRYPTION_KEY?.trim() || '';
}

export function isSecretStoreConfigured(): boolean {
  return !!getDatabaseUrl() && !!getEncryptionKeySource();
}

function getPool() {
  if (!isSecretStoreConfigured()) {
    return null;
  }

  return getPersistencePool();
}

function deriveEncryptionKey(): Buffer {
  const source = getEncryptionKeySource();
  if (!source) {
    throw new Error('AGENTRAIL_SECRET_ENCRYPTION_KEY is required for managed secret storage');
  }
  return createHash('sha256').update(source).digest();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprint(value: string): string {
  return sha256(value).slice(0, 16);
}

function previewSecret(value: string): string {
  if (value.length <= 8) return `...${value.slice(-4)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseCloudflareCredential(value: string): { apiKey: string; accountId: string } | null {
  const separatorIndex = value.indexOf(CLOUDFLARE_CREDENTIAL_SEPARATOR);
  if (separatorIndex === -1) return null;

  const apiKey = value.slice(0, separatorIndex).trim();
  const accountId = value.slice(separatorIndex + CLOUDFLARE_CREDENTIAL_SEPARATOR.length).trim();
  if (!apiKey || !accountId) return null;

  return { apiKey, accountId };
}

function buildProviderMetadata(envVar: string, value: string): { preview: string; secondaryLabel: string | null; secondaryPreview: string | null } {
  if (envVar !== 'CLOUDFLARE_API_KEY') {
    return { preview: previewSecret(value), secondaryLabel: null, secondaryPreview: null };
  }

  const parsed = parseCloudflareCredential(value);
  if (!parsed) {
    return { preview: previewSecret(value), secondaryLabel: null, secondaryPreview: null };
  }

  return {
    preview: previewSecret(parsed.apiKey),
    secondaryLabel: 'Account ID',
    secondaryPreview: previewSecret(parsed.accountId),
  };
}

function encryptSecret(value: string): SecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptSecret(payload: SecretEnvelope): string {
  const decipher = createDecipheriv('aes-256-gcm', deriveEncryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

function getPersistedTarget(): string {
  try {
    const parsed = new URL(getDatabaseUrl());
    const dbName = parsed.pathname.replace(/^\//, '') || 'agentrail';
    return `postgres://${parsed.hostname}/${dbName}`;
  } catch {
    return DEFAULT_META_PATH;
  }
}

async function ensureSchema(): Promise<void> {
  const activePool = getPool();
  if (!activePool) {
    meta = { backend: 'none', persistedPath: null, persistedUpdatedAt: null };
    return;
  }

  await runDatabaseMigrations();
  meta = { backend: 'postgres', persistedPath: getPersistedTarget(), persistedUpdatedAt: null };
}

async function upsertProviderSecret(
  client: PoolClient,
  envVar: string,
  value: string,
  ordinal: number,
  updatedAt: number,
): Promise<void> {
  const encrypted = encryptSecret(value);
  const providerMeta = buildProviderMetadata(envVar, value);
  await client.query(
    `
      INSERT INTO ${providerTableName} (
        env_var,
        fingerprint,
        ordinal,
        encrypted_iv,
        encrypted_value,
        encrypted_auth_tag,
        preview,
        secondary_label,
        secondary_preview,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (env_var, fingerprint) DO UPDATE
      SET ordinal = EXCLUDED.ordinal,
          encrypted_iv = EXCLUDED.encrypted_iv,
          encrypted_value = EXCLUDED.encrypted_value,
          encrypted_auth_tag = EXCLUDED.encrypted_auth_tag,
          preview = EXCLUDED.preview,
          secondary_label = EXCLUDED.secondary_label,
          secondary_preview = EXCLUDED.secondary_preview,
          updated_at = EXCLUDED.updated_at
    `,
    [
      envVar,
      fingerprint(value),
      ordinal,
      encrypted.iv,
      encrypted.ciphertext,
      encrypted.authTag,
      providerMeta.preview,
      providerMeta.secondaryLabel,
      providerMeta.secondaryPreview,
      updatedAt,
      updatedAt,
    ],
  );
}

async function migrateLegacyProviderConfig(allowedEnvVars: Set<string>): Promise<void> {
  const legacy = await loadLegacyPersistedConfig(allowedEnvVars);
  if (!legacy || Object.keys(legacy.keys).length === 0) {
    return;
  }

  const activePool = getPool();
  if (!activePool) {
    return;
  }

  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    for (const [envVar, rawValue] of Object.entries(legacy.keys)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const [index, value] of values.entries()) {
        await upsertProviderSecret(client, envVar, value, index, legacy.updatedAt);
      }
    }
    await client.query('COMMIT');
    await clearLegacyPersistedConfig();
    meta = {
      backend: 'postgres',
      persistedPath: getPersistedTarget(),
      persistedUpdatedAt: legacy.updatedAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function migrateLegacySaasKeys(): Promise<void> {
  const activePool = getPool();
  if (!activePool) {
    return;
  }

  const legacyKeys = await listLegacyApiKeySecrets();
  if (legacyKeys.length === 0) {
    return;
  }

  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    for (const key of legacyKeys) {
      await client.query(
        `
          INSERT INTO ${saasTableName} (id, user_id, key_hash, key_preview, is_active, created_at, last_used_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              key_hash = EXCLUDED.key_hash,
              key_preview = EXCLUDED.key_preview,
              is_active = EXCLUDED.is_active,
              created_at = EXCLUDED.created_at,
              last_used_at = EXCLUDED.last_used_at
        `,
        [
          key.id,
          key.userId,
          sha256(key.key),
          key.keyPreview,
          key.isActive,
          key.createdAt,
          key.lastUsedAt,
        ],
      );
    }
    await client.query('COMMIT');
    await scrubLegacyApiKeySecrets();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeSecretStore(allowedEnvVars: Set<string>): Promise<SecretStoreMeta> {
  if (!isSecretStoreConfigured()) {
    meta = { backend: 'legacy-json', persistedPath: getPersistedConfigPath(), persistedUpdatedAt: null };
    return meta;
  }

  await ensureSchema();

  if (!migrationPromise) {
    migrationPromise = Promise.all([
      migrateLegacyProviderConfig(allowedEnvVars),
      migrateLegacySaasKeys(),
    ]).then(() => undefined);
  }

  await migrationPromise;
  return meta;
}

export function getSecretStoreMeta(): SecretStoreMeta {
  return meta;
}

export async function loadManagedProviderKeys(allowedEnvVars: Set<string>): Promise<Record<string, string[]>> {
  const activePool = getPool();
  if (!activePool) {
    return {};
  }

  await ensureSchema();
  const envVars = [...allowedEnvVars];
  if (envVars.length === 0) {
    return {};
  }

  const result = await activePool.query<ProviderSecretRow>(
    `
      SELECT env_var, fingerprint, ordinal, encrypted_iv, encrypted_value, encrypted_auth_tag, preview, secondary_label, secondary_preview, updated_at
      FROM ${providerTableName}
      WHERE env_var = ANY($1::text[])
      ORDER BY env_var ASC, ordinal ASC, updated_at ASC
    `,
    [envVars],
  );

  const grouped: Record<string, string[]> = {};
  let latestUpdatedAt: number | null = null;
  for (const row of result.rows) {
    const value = decryptSecret({
      iv: row.encrypted_iv,
      ciphertext: row.encrypted_value,
      authTag: row.encrypted_auth_tag,
    });
    grouped[row.env_var] ??= [];
    grouped[row.env_var].push(value);
    latestUpdatedAt = latestUpdatedAt === null ? row.updated_at : Math.max(latestUpdatedAt, row.updated_at);
  }

  meta = {
    backend: 'postgres',
    persistedPath: getPersistedTarget(),
    persistedUpdatedAt: latestUpdatedAt,
  };

  return grouped;
}

export async function saveManagedProviderKeys(allowedEnvVars: Set<string>, keys: Record<string, string | string[]>): Promise<SecretStoreMeta> {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('Managed secret storage is unavailable. Configure AGENTRAIL_SECRETS_DATABASE_URL and AGENTRAIL_SECRET_ENCRYPTION_KEY.');
  }

  await ensureSchema();

  const client = await activePool.connect();
  const updatedAt = Date.now();
  try {
    await client.query('BEGIN');
    const envVars = [...allowedEnvVars];
    if (envVars.length > 0) {
      await client.query(`DELETE FROM ${providerTableName} WHERE env_var = ANY($1::text[])`, [envVars]);
    }

    for (const envVar of envVars) {
      const rawValues = keys[envVar];
      const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];
      for (const [index, value] of values.entries()) {
        if (!value.trim()) continue;
        await upsertProviderSecret(client, envVar, value, index, updatedAt);
      }
    }

    await client.query('COMMIT');
    meta = {
      backend: 'postgres',
      persistedPath: getPersistedTarget(),
      persistedUpdatedAt: updatedAt,
    };
    return meta;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function hasManagedGatewayApiKey(): Promise<boolean> {
  const activePool = getPool();
  if (!activePool) {
    return inMemoryGatewayKeyHash !== null;
  }

  await ensureSchema();
  const result = await activePool.query(`SELECT 1 FROM ${gatewayTableName} WHERE name = $1`, [GATEWAY_SECRET_NAME]);
  return result.rows.length > 0;
}

export async function validateManagedGatewayApiKey(candidate: string): Promise<boolean> {
  const activePool = getPool();
  if (!activePool) {
    return inMemoryGatewayKeyHash === sha256(candidate);
  }

  await ensureSchema();
  const result = await activePool.query<{ key_hash: string }>(
    `SELECT key_hash FROM ${gatewayTableName} WHERE name = $1`,
    [GATEWAY_SECRET_NAME],
  );
  if (result.rows.length === 0) {
    return false;
  }
  return result.rows[0].key_hash === sha256(candidate);
}

export async function setManagedGatewayApiKey(value: string): Promise<void> {
  const activePool = getPool();
  const trimmed = value.trim();
  if (!activePool) {
    inMemoryGatewayKeyHash = trimmed ? sha256(trimmed) : null;
    return;
  }

  await ensureSchema();
  if (!trimmed) {
    await activePool.query(`DELETE FROM ${gatewayTableName} WHERE name = $1`, [GATEWAY_SECRET_NAME]);
    return;
  }

  await activePool.query(
    `
      INSERT INTO ${gatewayTableName} (name, key_hash, preview, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (name) DO UPDATE
      SET key_hash = EXCLUDED.key_hash,
          preview = EXCLUDED.preview,
          updated_at = EXCLUDED.updated_at
    `,
    [GATEWAY_SECRET_NAME, sha256(trimmed), previewSecret(trimmed), Date.now()],
  );
}

export async function createManagedSaasApiKeySecret(input: {
  id: string;
  userId: string;
  plaintextKey: string;
  keyPreview: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}): Promise<void> {
  const activePool = getPool();
  if (!activePool) {
    await loadSaasKeySecretsFromJson();
    inMemorySaasApiKeys.set(input.id, {
      id: input.id,
      userId: input.userId,
      keyHash: sha256(input.plaintextKey),
      keyPreview: input.keyPreview,
      isActive: input.isActive,
      createdAt: input.createdAt,
      lastUsedAt: input.lastUsedAt,
      keyValue: input.plaintextKey,
    });
    await saveSaasKeySecretsToJson();
    return;
  }

  await ensureSchema();
  const encrypted = encryptSecret(input.plaintextKey);
  await activePool.query(
    `
      INSERT INTO ${saasTableName} (id, user_id, key_hash, key_preview, is_active, created_at, last_used_at, key_value, key_value_iv, key_value_auth_tag)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          key_hash = EXCLUDED.key_hash,
          key_preview = EXCLUDED.key_preview,
          is_active = EXCLUDED.is_active,
          created_at = EXCLUDED.created_at,
          last_used_at = EXCLUDED.last_used_at,
          key_value = EXCLUDED.key_value,
          key_value_iv = EXCLUDED.key_value_iv,
          key_value_auth_tag = EXCLUDED.key_value_auth_tag
    `,
    [input.id, input.userId, sha256(input.plaintextKey), input.keyPreview, input.isActive, input.createdAt, input.lastUsedAt, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
  );
}

export async function findManagedSaasApiKeySecret(plaintextKey: string): Promise<{ id: string; userId: string; isActive: boolean } | undefined> {
  const activePool = getPool();
  if (!activePool) {
    await loadSaasKeySecretsFromJson();
    const keyHash = sha256(plaintextKey);
    for (const entry of inMemorySaasApiKeys.values()) {
      if (entry.keyHash === keyHash) {
        return { id: entry.id, userId: entry.userId, isActive: entry.isActive };
      }
    }
    return undefined;
  }

  await ensureSchema();
  const result = await activePool.query<{ id: string; user_id: string; is_active: boolean }>(
    `
      SELECT id, user_id, is_active
      FROM ${saasTableName}
      WHERE key_hash = $1
      LIMIT 1
    `,
    [sha256(plaintextKey)],
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  return {
    id: result.rows[0].id,
    userId: result.rows[0].user_id,
    isActive: result.rows[0].is_active,
  };
}

export async function getManagedSaasApiKeyPlaintext(id: string): Promise<string | null> {
  const activePool = getPool();
  if (!activePool) {
    await loadSaasKeySecretsFromJson();
    const entry = inMemorySaasApiKeys.get(id);
    return entry?.keyValue ?? null;
  }

  await ensureSchema();
  const result = await activePool.query<{ key_value: string | null; key_value_iv: string | null; key_value_auth_tag: string | null }>(
    `SELECT key_value, key_value_iv, key_value_auth_tag FROM ${saasTableName} WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  const ciphertext = row?.key_value;
  const iv = row?.key_value_iv;
  const authTag = row?.key_value_auth_tag;
  if (!ciphertext || !iv || !authTag) return null;

  return decryptSecret({ ciphertext, iv, authTag });
}

export async function touchManagedSaasApiKeySecret(id: string, lastUsedAt: number): Promise<void> {
  const activePool = getPool();
  if (!activePool) {
    await loadSaasKeySecretsFromJson();
    const entry = inMemorySaasApiKeys.get(id);
    if (entry) entry.lastUsedAt = lastUsedAt;
    await saveSaasKeySecretsToJson();
    return;
  }

  await ensureSchema();
  await activePool.query(`UPDATE ${saasTableName} SET last_used_at = $2 WHERE id = $1`, [id, lastUsedAt]);
}

export async function revokeManagedSaasApiKeySecret(id: string): Promise<void> {
  const activePool = getPool();
  if (!activePool) {
    await loadSaasKeySecretsFromJson();
    const entry = inMemorySaasApiKeys.get(id);
    if (entry) entry.isActive = false;
    await saveSaasKeySecretsToJson();
    return;
  }

  await ensureSchema();
  await activePool.query(`UPDATE ${saasTableName} SET is_active = FALSE WHERE id = $1`, [id]);
}

