import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ApiKey, AuditEvent, DailyUsage, SaasDatabaseSnapshot, SessionRecord, TierRecord, User } from './types.js';

interface SaasDatabase {
  users: User[];
  apiKeys: ApiKey[];
  sessions: SessionRecord[];
  usage: DailyUsage[];
  tiers: TierRecord[];
  auditEvents: AuditEvent[];
}
const SAAS_DIR = path.resolve(process.cwd(), '.agentrail', 'saas');
const DB_PATH = path.join(SAAS_DIR, 'db.json');

let db: SaasDatabase = { users: [], apiKeys: [], sessions: [], usage: [], tiers: [], auditEvents: [] };
let loaded = false;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function previewSecret(value: string): string {
  if (value.length <= 8) return `...${value.slice(-4)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function normalizeDb(raw: Partial<SaasDatabase> | undefined): SaasDatabase {
  return {
    users: Array.isArray(raw?.users) ? raw!.users : [],
    apiKeys: Array.isArray(raw?.apiKeys) ? raw!.apiKeys.map((key) => ({
      id: key.id,
      userId: key.userId,
      keyPreview: typeof (key as ApiKey & { key?: string }).keyPreview === 'string'
        ? (key as ApiKey & { key?: string }).keyPreview
        : previewSecret(typeof (key as ApiKey & { key?: string }).key === 'string' ? (key as ApiKey & { key?: string }).key as string : 'configured'),
      name: key.name,
      isActive: key.isActive,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt ?? null,
      scopes: Array.isArray(key.scopes) ? key.scopes.filter((scope): scope is string => typeof scope === 'string') : undefined,
    })) : [],
    sessions: Array.isArray(raw?.sessions) ? raw!.sessions : [],
    usage: Array.isArray(raw?.usage) ? raw!.usage : [],
    tiers: Array.isArray(raw?.tiers) ? raw!.tiers : [],
    auditEvents: Array.isArray(raw?.auditEvents) ? raw!.auditEvents : [],
  };
}

async function loadDB(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await readFile(DB_PATH, 'utf-8');
    db = normalizeDb(JSON.parse(raw) as Partial<SaasDatabase>);
  } catch {
    db = { users: [], apiKeys: [], sessions: [], usage: [], tiers: [], auditEvents: [] };
  }
  loaded = true;
}

async function saveDB(): Promise<void> {
  await mkdir(SAAS_DIR, { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export async function initDB(): Promise<void> {
  await loadDB();
  await pruneExpiredSessions();
  if (db.tiers.length === 0) {
    db.tiers = [
      { id: 'free', name: 'Free', requestsPerDay: 100, maxApiKeys: 3, maxTokensPerDay: 500_000, priceMonthly: 0, features: ['100 requests / day', '3 API keys', 'Basic model access', 'Community support'] },
      { id: 'pro', name: 'Pro', requestsPerDay: 1000, maxApiKeys: 10, maxTokensPerDay: 5_000_000, priceMonthly: 19, features: ['1,000 requests / day', '10 API keys', 'All models including premium', 'Priority routing', 'Email support'] },
      { id: 'enterprise', name: 'Enterprise', requestsPerDay: Infinity, maxApiKeys: 100, maxTokensPerDay: Infinity, priceMonthly: 99, features: ['Unlimited requests', '100 API keys', 'All models', 'Priority routing', 'Dedicated support', '99.9% SLA', 'Custom integrations'] },
    ];
    await saveDB();
  }
}

export async function createUser(user: User): Promise<void> {
  await loadDB();
  db.users.push(user);
  await saveDB();
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  await loadDB();
  return db.users.find(u => u.email === email);
}

export async function getUserById(id: string): Promise<User | undefined> {
  await loadDB();
  return db.users.find(u => u.id === id);
}

export async function listUsers(): Promise<User[]> {
  await loadDB();
  return [...db.users];
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
  await loadDB();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return undefined;
  db.users[idx] = { ...db.users[idx], ...updates };
  await saveDB();
  return db.users[idx];
}

export async function deleteUser(id: string): Promise<boolean> {
  await loadDB();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  db.users.splice(idx, 1);
  db.apiKeys = db.apiKeys.filter(k => k.userId !== id);
  db.sessions = db.sessions.filter(s => s.userId !== id);
  db.usage = db.usage.filter(u => u.userId !== id);
  await saveDB();
  return true;
}

export async function createApiKey(key: ApiKey): Promise<void> {
  await loadDB();
  db.apiKeys.push(key);
  await saveDB();
}

export async function getApiKeyById(id: string): Promise<ApiKey | undefined> {
  await loadDB();
  return db.apiKeys.find(k => k.id === id);
}

export async function listApiKeysForUser(userId: string): Promise<ApiKey[]> {
  await loadDB();
  return db.apiKeys.filter(k => k.userId === userId);
}

export async function revokeApiKey(id: string, userId: string): Promise<boolean> {
  await loadDB();
  const idx = db.apiKeys.findIndex(k => k.id === id && k.userId === userId);
  if (idx === -1) return false;
  db.apiKeys[idx].isActive = false;
  await saveDB();
  return true;
}

export async function touchApiKeyById(id: string): Promise<void> {
  await loadDB();
  const entry = db.apiKeys.find(k => k.id === id);
  if (entry) {
    entry.lastUsedAt = Date.now();
    await saveDB();
  }
}

export async function countActiveKeys(userId: string): Promise<number> {
  await loadDB();
  return db.apiKeys.filter(k => k.userId === userId && k.isActive).length;
}

export async function listLegacyApiKeySecrets(): Promise<Array<{ id: string; userId: string; key: string; keyPreview: string; isActive: boolean; createdAt: number; lastUsedAt: number | null }>> {
  try {
    const raw = JSON.parse(await readFile(DB_PATH, 'utf-8')) as { apiKeys?: Array<Record<string, unknown>> };
    const apiKeys = Array.isArray(raw.apiKeys) ? raw.apiKeys : [];
    return apiKeys
      .filter((entry): entry is Record<string, unknown> & { id: string; userId: string; key: string; isActive: boolean; createdAt: number; lastUsedAt?: number | null } =>
        typeof entry.id === 'string'
        && typeof entry.userId === 'string'
        && typeof entry.key === 'string'
        && typeof entry.isActive === 'boolean'
        && typeof entry.createdAt === 'number')
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        key: entry.key,
        keyPreview: typeof entry.keyPreview === 'string' ? entry.keyPreview : previewSecret(entry.key),
        isActive: entry.isActive,
        createdAt: entry.createdAt,
        lastUsedAt: typeof entry.lastUsedAt === 'number' ? entry.lastUsedAt : null,
      }));
  } catch {
    return [];
  }
}

export async function scrubLegacyApiKeySecrets(): Promise<void> {
  await loadDB();
  await saveDB();
}

export async function createSessionRecord(session: SessionRecord): Promise<void> {
  await loadDB();
  db.sessions.push(session);
  await saveDB();
}

export async function getSessionByHash(tokenHash: string): Promise<SessionRecord | undefined> {
  await loadDB();
  return db.sessions.find((session) => session.tokenHash === tokenHash);
}

export async function touchSessionByHash(tokenHash: string): Promise<void> {
  await loadDB();
  const session = db.sessions.find((entry) => entry.tokenHash === tokenHash);
  if (!session) return;
  session.lastUsedAt = Date.now();
  await saveDB();
}

export async function deleteSessionByHash(tokenHash: string): Promise<boolean> {
  await loadDB();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
  const changed = db.sessions.length !== before;
  if (changed) {
    await saveDB();
  }
  return changed;
}

export async function pruneExpiredSessions(): Promise<void> {
  await loadDB();
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => session.expiresAt > now);
  if (db.sessions.length !== before) {
    await saveDB();
  }
}

export async function createAuditEvent(event: AuditEvent): Promise<void> {
  await loadDB();
  db.auditEvents.unshift(event);
  db.auditEvents = db.auditEvents.slice(0, 500);
  await saveDB();
}

export async function listAuditEvents(limit = 100): Promise<AuditEvent[]> {
  await loadDB();
  return db.auditEvents.slice(0, limit);
}

export async function getDailyUsage(userId: string, date: string): Promise<DailyUsage | undefined> {
  await loadDB();
  return db.usage.find(u => u.userId === userId && u.date === date);
}

export async function recordUsage(userId: string, promptTokens: number, completionTokens: number): Promise<void> {
  await loadDB();
  const d = today();
  const existing = db.usage.find(u => u.userId === userId && u.date === d);
  if (existing) {
    existing.requests += 1;
    existing.promptTokens += promptTokens;
    existing.completionTokens += completionTokens;
  } else {
    db.usage.push({
      userId,
      date: d,
      requests: 1,
      promptTokens,
      completionTokens,
    });
  }
  await saveDB();
}

export async function getUserUsageHistory(userId: string, limit = 30): Promise<DailyUsage[]> {
  await loadDB();
  return db.usage
    .filter(u => u.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export async function getAllUsageHistory(limit = 100): Promise<DailyUsage[]> {
  await loadDB();
  return [...db.usage]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export async function listTiers(): Promise<TierRecord[]> {
  await loadDB();
  return [...db.tiers];
}

export async function getTierById(id: string): Promise<TierRecord | undefined> {
  await loadDB();
  return db.tiers.find(t => t.id === id);
}

export async function createTier(tier: TierRecord): Promise<void> {
  await loadDB();
  db.tiers.push(tier);
  await saveDB();
}

export async function updateTier(id: string, updates: Partial<TierRecord>): Promise<TierRecord | undefined> {
  await loadDB();
  const idx = db.tiers.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  db.tiers[idx] = { ...db.tiers[idx], ...updates };
  await saveDB();
  return db.tiers[idx];
}

export async function deleteTier(id: string): Promise<boolean> {
  await loadDB();
  const idx = db.tiers.findIndex(t => t.id === id);
  if (idx === -1) return false;
  db.tiers.splice(idx, 1);
  await saveDB();
  return true;
}

export function getLegacyDbPath(): string {
  return DB_PATH;
}

export async function readLegacyDatabaseSnapshot(): Promise<SaasDatabaseSnapshot | null> {
  try {
    const raw = await readFile(DB_PATH, 'utf-8');
    return normalizeDb(JSON.parse(raw) as Partial<SaasDatabaseSnapshot>);
  } catch {
    return null;
  }
}
