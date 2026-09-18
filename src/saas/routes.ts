import type http from 'http';
import {
  changeUserTier,
  createNewApiKey,
  getAuthenticatedSession,
  listKeys,
  login,
  logout,
  makeUserAdmin,
  register,
  revokeKey,
  setUserActive,
  setUserAdmin,
  validateCsrfToken,
} from './auth.js';
import { getAllUsageHistory, getUserById, getUserUsageHistory, listUsers, updateUser } from './db.js';
import { getTier, getAllTiers, normalizeTierRecord } from './tiers.js';
import type { TierRecord } from './types.js';
import { getUsagePercentages } from './rates.js';

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function readOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function serializeTierForAdmin(tier: TierRecord): TierRecord {
  return normalizeTierRecord(tier);
}

/* ── Session helpers ── */

function getSessionToken(req: http.IncomingMessage): string | undefined {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/fw_session=([^;]+)/);
  if (match) return match[1];

  const auth = req.headers.authorization ?? '';
  const bearerMatch = auth.match(/^Bearer\s+(fw_session_.+)$/);
  if (bearerMatch) return bearerMatch[1];

  return undefined;
}

async function requireUser(req: http.IncomingMessage, res: http.ServerResponse): Promise<{ id: string; isAdmin: boolean } | null> {
  const token = getSessionToken(req);
  if (!token) {
    json(res, 401, { error: 'Not authenticated' });
    return null;
  }

  const session = await getAuthenticatedSession(token);
  if (!session) {
    json(res, 401, { error: 'Session expired' });
    return null;
  }

  return { id: session.user.id, isAdmin: session.user.isAdmin };
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

async function requireCsrfForSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const token = getSessionToken(req);
  if (!token) {
    json(res, 401, { error: 'Not authenticated' });
    return false;
  }
  const csrfToken = typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : undefined;
  const ok = await validateCsrfToken(token, csrfToken);
  if (!ok) {
    json(res, 403, { error: 'Invalid CSRF token' });
    return false;
  }
  return true;
}

/* ── Route handler ── */

export async function handleSaasRoute(
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const method = req.method ?? 'GET';

  /* ── Bootstrap (first admin, no users exist yet) ── */

  if (pathname === '/api/saas/bootstrap' && method === 'POST') {
    const { listUsers } = await import('./db.js');
    const existing = await listUsers();
    if (existing.length > 0) {
      json(res, 400, { error: 'Bootstrap already done — users exist' });
      return true;
    }
    const body = JSON.parse(await parseBody(req));
    const result = await register(body.email, body.password, body.name);
    if (!result.ok) { json(res, 400, { error: result.error }); return true; }
    await makeUserAdmin(result.user.id);
    const user = await getUserById(result.user.id);
    json(res, 201, { user: { ...user, passwordHash: '' }, token: result.token });
    return true;
  }

  /* ── Auth routes (no session required) ── */

  if (pathname === '/api/saas/auth/register' && method === 'POST') {
    json(res, 403, { error: 'Public registration is disabled' });
    return true;
  }

  if (pathname === '/api/saas/auth/login' && method === 'POST') {
    const body = JSON.parse(await parseBody(req));
    const result = await login(body.email, body.password, getClientIp(req));
    if (!result.ok) {
      json(res, 401, { error: result.error });
      return true;
    }
    setSessionCookie(req, res, result.token);
    json(res, 200, { user: result.user, token: result.token, csrfToken: result.csrfToken });
    return true;
  }

  if (pathname === '/api/saas/auth/logout' && method === 'POST') {
    if (!(await requireCsrfForSession(req, res))) return true;
    const token = getSessionToken(req);
    if (token) await logout(token);
    clearSessionCookie(req, res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/api/saas/auth/me' && method === 'GET') {
    const token = getSessionToken(req);
    if (!token) {
      json(res, 200, { user: null });
      return true;
    }
    const session = await getAuthenticatedSession(token);
    json(res, 200, { user: session?.user ?? null, csrfToken: session?.csrfToken ?? null });
    return true;
  }

  /* ── Protected routes ── */

  const user = await requireUser(req, res);
  if (!user) return true;

  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    if (!(await requireCsrfForSession(req, res))) return true;
  }

  /* ── API Keys ── */

  if (pathname === '/api/saas/keys' && method === 'GET') {
    const keys = await listKeys(user.id);
    json(res, 200, { keys });
    return true;
  }

  if (pathname === '/api/saas/keys' && method === 'POST') {
    const body = JSON.parse(await parseBody(req));
    const result = await createNewApiKey(user.id, body.name ?? '', body.scopes);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 201, { key: result.key });
    return true;
  }

  if (pathname.startsWith('/api/saas/keys/') && method === 'DELETE') {
    const keyId = pathname.slice('/api/saas/keys/'.length);
    const ok = await revokeKey(keyId, user.id);
    if (!ok) {
      json(res, 404, { error: 'Key not found' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  /* ── Usage ── */

  if (pathname === '/api/saas/usage' && method === 'GET') {
    const history = await getUserUsageHistory(user.id);
    const currentUser = await getUserById(user.id);
    const tier = currentUser ? await getTier(currentUser.tier) : await getTier('free');
    const today = new Date().toISOString().slice(0, 10);
    const { getDailyUsage } = await import('./db.js');
    const daily = await getDailyUsage(user.id, today);

    json(res, 200, {
      daily,
      percentages: getUsagePercentages(daily ?? undefined, tier),
      tier: {
        id: currentUser?.tier ?? 'free',
        config: tier,
      },
      history,
    });
    return true;
  }

  /* ── Account ── */

  if (pathname === '/api/saas/account' && method === 'GET') {
    const u = await getUserById(user.id);
    if (!u) {
      json(res, 404, { error: 'User not found' });
      return true;
    }
    json(res, 200, {
      user: { ...u, passwordHash: '' },
      tiers: await getAllTiers(),
    });
    return true;
  }

  /* ── Admin routes ── */

  if (!user.isAdmin) return false;

  if (pathname === '/api/saas/admin/users' && method === 'GET') {
    const users = await listUsers();
    json(res, 200, {
      users: users.map(u => ({ ...u, passwordHash: '' })),
    });
    return true;
  }

  if (pathname === '/api/saas/admin/users' && method === 'POST') {
    const body = JSON.parse(await parseBody(req));
    const result = await register(body.email, body.password, body.name);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    const targetUser = await getUserById(result.user.id);
    if (!targetUser) { json(res, 500, { error: 'Failed to create user' }); return true; }
    if (body.tier) await changeUserTier(targetUser.id, body.tier);
    if (body.isAdmin) await makeUserAdmin(targetUser.id);
    json(res, 201, { user: { ...targetUser, passwordHash: '' } });
    return true;
  }

  if (pathname === '/api/saas/admin/usage' && method === 'GET') {
    const usage = await getAllUsageHistory();
    json(res, 200, { usage });
    return true;
  }

  if (pathname.startsWith('/api/saas/admin/users/') && method === 'PATCH') {
    const segments = pathname.split('/');
    const targetId = segments[segments.length - 1];
    const body = JSON.parse(await parseBody(req));

    if (targetId === user.id && (body.isAdmin !== undefined || body.isActive !== undefined)) {
      json(res, 400, { error: 'Cannot change your own admin or active status' });
      return true;
    }

    if (body.tier) {
      const changed = await changeUserTier(targetId, body.tier);
      if (!changed) {
        json(res, 400, { error: 'Invalid tier' });
        return true;
      }
    }
    if (body.isAdmin !== undefined) await setUserAdmin(targetId, body.isAdmin);
    if (body.isActive !== undefined) await setUserActive(targetId, body.isActive);
    if (body.name) await updateUser(targetId, { name: body.name });

    const updated = await getUserById(targetId);
    json(res, 200, { ok: true, user: updated ? { ...updated, passwordHash: '' } : undefined });
    return true;
  }

  if (pathname.startsWith('/api/saas/admin/users/') && method === 'DELETE') {
    const targetId = pathname.split('/').pop() ?? '';
    if (targetId === user.id) { json(res, 400, { error: 'Cannot delete yourself' }); return true; }
    const { deleteUser } = await import('./db.js');
    const ok = await deleteUser(targetId);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'User not found' });
    return true;
  }

  if (pathname.startsWith('/api/saas/admin/keys/') && method === 'GET') {
    const targetId = pathname.split('/').pop() ?? '';
    const { listApiKeysForUser } = await import('./db.js');
    const keys = await listApiKeysForUser(targetId);
    json(res, 200, { keys });
    return true;
  }

  /* ── Admin: Tier management ── */

  if (pathname === '/api/saas/admin/tiers' && method === 'GET') {
    const { listTiers } = await import('./db.js');
    const tiers = (await listTiers()).map(serializeTierForAdmin);
    json(res, 200, { tiers });
    return true;
  }

  if (pathname === '/api/saas/admin/tiers' && method === 'POST') {
    const body = JSON.parse(await parseBody(req));
    if (!body.id || !body.name) {
      json(res, 400, { error: 'id and name are required' });
      return true;
    }
    const { getTierById, createTier } = await import('./db.js');
    const existing = await getTierById(body.id);
    if (existing) {
      json(res, 400, { error: 'Tier already exists' });
      return true;
    }
    await createTier({
      id: body.id,
      name: body.name,
      requestsPerDay: readOptionalNumber(body.requestsPerDay) ?? null,
      maxApiKeys: readOptionalNumber(body.maxApiKeys) ?? 0,
      maxTokensPerDay: readOptionalNumber(body.maxTokensPerDay) ?? null,
      priceMonthly: readOptionalNumber(body.priceMonthly) ?? 0,
      features: body.features ?? [],
    });
    const tier = await getTierById(body.id);
    json(res, 201, { tier: tier ? serializeTierForAdmin(tier) : tier });
    return true;
  }

  if (pathname.startsWith('/api/saas/admin/tiers/') && method === 'PATCH') {
    const tierId = pathname.split('/').pop() ?? '';
    const body = JSON.parse(await parseBody(req));
    const { updateTier } = await import('./db.js');
    const updated = await updateTier(tierId, body);
    if (!updated) {
      json(res, 404, { error: 'Tier not found' });
      return true;
    }
    json(res, 200, { tier: serializeTierForAdmin(updated) });
    return true;
  }

  if (pathname.startsWith('/api/saas/admin/tiers/') && method === 'DELETE') {
    const tierId = pathname.split('/').pop() ?? '';
    if (tierId === 'free') {
      json(res, 400, { error: 'Cannot delete the default Free tier' });
      return true;
    }
    const { deleteTier, updateUser, listUsers } = await import('./db.js');
    const ok = await deleteTier(tierId);
    if (!ok) {
      json(res, 404, { error: 'Tier not found' });
      return true;
    }
    // Move users on deleted tier back to free
    const users = await listUsers();
    for (const u of users) {
      if (u.tier === tierId) {
        await updateUser(u.id, { tier: 'free' });
      }
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function isSecureRequest(req: http.IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const value = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return process.env.AGENTRAIL_SECURE_COOKIES === '1'
    || process.env.NODE_ENV === 'production'
    || value === 'https';
}

function setSessionCookie(req: http.IncomingMessage, res: http.ServerResponse, token: string) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `fw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}`);
}

function clearSessionCookie(req: http.IncomingMessage, res: http.ServerResponse) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `fw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
