import { createHash, randomBytes } from 'crypto';
import {
  type ApiKey,
  type SessionRecord,
  type User,
  countActiveKeys,
  createAuditEvent,
  createApiKey,
  createSessionRecord,
  createUser,
  deleteSessionByHash,
  getApiKeyById,
  getSessionByHash,
  getUserByEmail,
  getUserById,
  listApiKeysForUser,
  pruneExpiredSessions,
  revokeApiKey,
  touchSessionByHash,
  touchApiKeyById,
  updateUser,
} from './db.js';
import { getTier } from './tiers.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { normalizeCapabilities, type ModelCapability } from '../models/capabilities.js';
import {
  createManagedSaasApiKeySecret,
  findManagedSaasApiKeySecret,
  getManagedSaasApiKeyPlaintext,
  revokeManagedSaasApiKeySecret,
  touchManagedSaasApiKeySecret,
} from '../secrets-store.js';

function generateSessionToken(): string {
  return `fw_session_${randomBytes(24).toString('base64url')}`;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; windowStartedAt: number; blockedUntil?: number }>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateCsrfToken(): string {
  return randomBytes(18).toString('base64url');
}

function generateApiKeyValue(): string {
  return `fw_${randomBytes(24).toString('base64url')}`;
}

function previewApiKey(value: string): string {
  if (value.length <= 8) return `...${value.slice(-4)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function writeAuditEvent(
  type: string,
  options: { userId?: string; ip?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await createAuditEvent({
    id: randomBytes(8).toString('hex'),
    type,
    userId: options.userId,
    ip: options.ip,
    metadata: options.metadata,
    createdAt: Date.now(),
  });
}

function getLoginThrottleKey(email: string, ip?: string): string {
  return `${email.toLowerCase()}::${ip || 'unknown'}`;
}

function getThrottleState(email: string, ip?: string) {
  const key = getLoginThrottleKey(email, ip);
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state) {
    return { key, state: null as null | { count: number; windowStartedAt: number; blockedUntil?: number }, now };
  }
  if (state.blockedUntil && state.blockedUntil > now) {
    return { key, state, now };
  }
  if (now - state.windowStartedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return { key, state: null, now };
  }
  return { key, state, now };
}

function canAttemptLogin(email: string, ip?: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const { state, now } = getThrottleState(email, ip);
  if (state?.blockedUntil && state.blockedUntil > now) {
    return { ok: false, retryAfterMs: state.blockedUntil - now };
  }
  return { ok: true };
}

function recordLoginFailure(email: string, ip?: string): void {
  const { key, state, now } = getThrottleState(email, ip);
  const next = state ?? { count: 0, windowStartedAt: now };
  next.count += 1;
  if (next.count >= LOGIN_MAX_ATTEMPTS) {
    next.blockedUntil = now + LOGIN_LOCKOUT_MS;
  }
  loginAttempts.set(key, next);
}

function clearLoginFailures(email: string, ip?: string): void {
  loginAttempts.delete(getLoginThrottleKey(email, ip));
}

async function createSession(userId: string): Promise<{ token: string; csrfToken: string }> {
  const token = generateSessionToken();
  const csrfToken = generateCsrfToken();
  const now = Date.now();
  const session: SessionRecord = {
    id: randomBytes(8).toString('hex'),
    userId,
    tokenHash: hashToken(token),
    csrfToken,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastUsedAt: now,
  };
  await createSessionRecord(session);
  return { token, csrfToken };
}

async function getSessionState(token: string): Promise<{ user: User; session: SessionRecord } | undefined> {
  await pruneExpiredSessions();
  const session = await getSessionByHash(hashToken(token));
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    await deleteSessionByHash(session.tokenHash);
    return undefined;
  }
  const user = await getUserById(session.userId);
  if (!user) {
    await deleteSessionByHash(session.tokenHash);
    return undefined;
  }
  await touchSessionByHash(session.tokenHash);
  return { user, session };
}

async function deleteSession(token: string): Promise<void> {
  await deleteSessionByHash(hashToken(token));
}

export interface AuthResult {
  ok: true;
  user: User;
  token: string;
  csrfToken: string;
}

export interface AuthError {
  ok: false;
  error: string;
}

export interface KeyValidationResult {
  ok: true;
  user: User;
  apiKey: ApiKey;
}

export interface KeyValidationError {
  ok: false;
  error: string;
  status: number;
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<AuthResult | AuthError> {
  if (!email || !password || !name) {
    return { ok: false, error: 'Email, password, and name are required' };
  }

  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters' };
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return { ok: false, error: 'Email already registered' };
  }

  const user: User = {
    id: randomBytes(12).toString('hex'),
    email,
    name,
    passwordHash: hashPassword(password),
    tier: 'free',
    isAdmin: false,
    isActive: true,
    createdAt: Date.now(),
  };

  await createUser(user);
  const session = await createSession(user.id);

  return {
    ok: true,
    user: stripSensitive(user),
    token: session.token,
    csrfToken: session.csrfToken,
  };
}

export async function login(
  email: string,
  password: string,
  ip?: string,
): Promise<AuthResult | AuthError> {
  if (!email || !password) {
    return { ok: false, error: 'Email and password are required' };
  }

  const throttle = canAttemptLogin(email, ip);
  if (!throttle.ok) {
    return { ok: false, error: 'Too many login attempts. Try again later.' };
  }

  const user = await getUserByEmail(email);
  if (!user) {
    recordLoginFailure(email, ip);
    await writeAuditEvent('auth.login_failed', { ip, metadata: { email } });
    return { ok: false, error: 'Invalid email or password' };
  }

  if (!user.isActive) {
    await writeAuditEvent('auth.login_blocked_inactive', { userId: user.id, ip, metadata: { email } });
    return { ok: false, error: 'Account is disabled' };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(email, ip);
    await writeAuditEvent('auth.login_failed', { userId: user.id, ip, metadata: { email } });
    return { ok: false, error: 'Invalid email or password' };
  }
  clearLoginFailures(email, ip);
  const session = await createSession(user.id);
  await writeAuditEvent('auth.login_succeeded', { userId: user.id, ip });

  return {
    ok: true,
    user: stripSensitive(user),
    token: session.token,
    csrfToken: session.csrfToken,
  };
}

export async function authenticateSession(token: string): Promise<User | undefined> {
  const state = await getSessionState(token);
  return state ? stripSensitive(state.user) : undefined;
}

export async function getAuthenticatedSession(token: string): Promise<{ user: User; csrfToken: string; expiresAt: number } | undefined> {
  const state = await getSessionState(token);
  if (!state) return undefined;
  return {
    user: stripSensitive(state.user),
    csrfToken: state.session.csrfToken,
    expiresAt: state.session.expiresAt,
  };
}

export async function logout(token: string): Promise<void> {
  const session = await getSessionState(token);
  await deleteSession(token);
  if (session) {
    await writeAuditEvent('auth.logout', { userId: session.user.id });
  }
}

export async function createNewApiKey(
  userId: string,
  name: string,
  scopes?: string[],
): Promise<{ ok: true; key: ApiKey & { key: string } } | { ok: false; error: string }> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found' };
  const requestedScopes = (scopes ?? []).map((scope) => scope.trim()).filter(Boolean);
  const normalizedScopes = normalizeCapabilities(requestedScopes);

  if (requestedScopes.length > 0 && (!normalizedScopes || normalizedScopes.length !== new Set(requestedScopes).size)) {
    return { ok: false, error: 'Invalid API key scopes. Use canonical capability ids such as chat, vision, embeddings, or image_generation.' };
  }

  const tier = await getTier(user.tier);
  const activeCount = await countActiveKeys(userId);

  if (activeCount >= tier.maxApiKeys) {
    return {
      ok: false,
      error: `API key limit reached (${tier.maxApiKeys}) for your ${tier.name} plan. Upgrade to create more keys.`,
    };
  }

  const plaintextKey = generateApiKeyValue();
  const apiKey: ApiKey = {
    id: randomBytes(8).toString('hex'),
    userId,
    keyPreview: previewApiKey(plaintextKey),
    name: name || `Key ${activeCount + 1}`,
    isActive: true,
    createdAt: Date.now(),
    lastUsedAt: null,
    scopes: normalizedScopes,
  };

  await createApiKey(apiKey);
  await createManagedSaasApiKeySecret({
    id: apiKey.id,
    userId,
    plaintextKey,
    keyPreview: apiKey.keyPreview,
    isActive: apiKey.isActive,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
  });
  await writeAuditEvent('api_key.created', { userId, metadata: { keyId: apiKey.id, scopes: apiKey.scopes ?? [] } });

  return { ok: true, key: { ...apiKey, key: plaintextKey } };
}

export async function listKeys(userId: string): Promise<ApiKey[]> {
  const keys = await listApiKeysForUser(userId);
  const enriched = await Promise.all(keys.map(async (k) => {
    const plaintext = await getManagedSaasApiKeyPlaintext(k.id);
    return plaintext ? { ...k, key: plaintext } : k;
  }));
  return enriched;
}

export async function revokeKey(keyId: string, userId: string): Promise<boolean> {
  const result = await revokeApiKey(keyId, userId);
  if (result) {
    await revokeManagedSaasApiKeySecret(keyId);
    await writeAuditEvent('api_key.revoked', { userId, metadata: { keyId } });
  }
  return result;
}

export async function validateApiKey(
  key: string,
  options: {
    skipRateLimit?: boolean;
    requiredCapability?: ModelCapability | string;
  } = {},
): Promise<KeyValidationResult | KeyValidationError> {
  const secret = await findManagedSaasApiKeySecret(key);
  if (!secret || !secret.isActive) {
    return { ok: false, error: 'Invalid API key', status: 401 };
  }

  const apiKey = await getApiKeyById(secret.id);
  if (!apiKey || !apiKey.isActive) {
    return { ok: false, error: 'Invalid API key', status: 401 };
  }

  const user = await getUserById(apiKey.userId);
  if (!user || !user.isActive) {
    return { ok: false, error: 'User account is disabled', status: 403 };
  }

  const requiredCapability = options.requiredCapability?.trim();
  if (requiredCapability && apiKey.scopes && apiKey.scopes.length > 0 && !apiKey.scopes.includes(requiredCapability)) {
    return { ok: false, error: `API key is not allowed to use ${requiredCapability}`, status: 403 };
  }

  if (!options.skipRateLimit) {
    const tier = await getTier(user.tier);
    const today = new Date().toISOString().slice(0, 10);

    const { getDailyUsage } = await import('./db.js');
    const daily = await getDailyUsage(user.id, today);

    if (daily) {
      const { checkUsageLimit } = await import('./rates.js');
      const limitCheck = checkUsageLimit(daily, tier);
      if (!limitCheck.ok) {
        return { ok: false, error: limitCheck.error, status: 429 };
      }
    }
  }

  const lastUsedAt = Date.now();
  await touchApiKeyById(apiKey.id);
  await touchManagedSaasApiKeySecret(apiKey.id, lastUsedAt);

  return { ok: true, user: stripSensitive(user), apiKey };
}

export async function makeUserAdmin(userId: string): Promise<boolean> {
  const user = await updateUser(userId, { isAdmin: true });
  return !!user;
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<boolean> {
  const user = await updateUser(userId, { isAdmin });
  return !!user;
}

export async function setUserActive(userId: string, isActive: boolean): Promise<boolean> {
  const user = await updateUser(userId, { isActive });
  return !!user;
}

export async function changeUserTier(userId: string, tier: string): Promise<boolean> {
  const { isValidTier } = await import('./tiers.js');
  if (!(await isValidTier(tier))) return false;
  const user = await updateUser(userId, { tier });
  return !!user;
}

export async function ensureAdminUserFromEnv(): Promise<User | null> {
  const email = process.env.AGENTRAIL_ADMIN_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || '';
  const password = process.env.AGENTRAIL_ADMIN_PASSWORD?.trim() || process.env.ADMIN_PASSWORD?.trim() || '';
  const name = process.env.AGENTRAIL_ADMIN_NAME?.trim() || process.env.ADMIN_NAME?.trim() || 'Admin';

  if (!email || !password) {
    return null;
  }

  const existing = await getUserByEmail(email);
  const passwordHash = hashPassword(password);

  if (existing) {
    const updated = await updateUser(existing.id, {
      name,
      passwordHash,
      isAdmin: true,
      isActive: true,
    });
    return updated ?? existing;
  }

  const user: User = {
    id: randomBytes(12).toString('hex'),
    email,
    name,
    passwordHash,
    tier: 'enterprise',
    isAdmin: true,
    isActive: true,
    createdAt: Date.now(),
  };
  await createUser(user);
  return user;
}

function stripSensitive(user: User): User {
  return {
    ...user,
    passwordHash: '',
  };
}

export async function validateCsrfToken(token: string, csrfToken: string | undefined): Promise<boolean> {
  if (!csrfToken) return false;
  const session = await getAuthenticatedSession(token);
  return session?.csrfToken === csrfToken;
}

export { stripSensitive };
