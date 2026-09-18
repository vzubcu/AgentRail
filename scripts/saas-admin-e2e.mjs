#!/usr/bin/env node
// E2E test: SaaS admin features
// Prerequisites: AGENTRAIL_SAAS=1 node dist/index.js (running), no existing .agentrail/saas/db.json

const BASE = 'http://127.0.0.1:42424';
let FAILED = 0;
let PASSED = 0;

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { raw: body }; }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

function assert(label, ok, detail) {
  if (ok) { PASSED++; console.log(`  ✓ ${label}`); }
  else { FAILED++; console.log(`  ✗ ${label}: ${detail || 'FAILED'}`); }
}

function assertEq(label, actual, expected) {
  if (actual === expected) { PASSED++; console.log(`  ✓ ${label}`); }
  else { FAILED++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

async function main() {
  console.log('\n=== SaaS Admin E2E Tests ===\n');

  // Ensure clean state
  const fs = await import('fs');
  try { fs.rmSync('.agentrail/saas', { recursive: true }); } catch {}

  // Wait for server to be ready
  for (let i = 0; i < 10; i++) {
    try { await req('/health'); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }

  // ─── Setup: Bootstrap admin ───
  console.log('── Setup: Bootstrap admin + register normal user ──');
  let r = await req('/api/saas/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@test.com', password: 'admin123', name: 'Admin' }),
  });
  assertEq('Bootstrap admin', r.status, 201);
  assert('Admin user returned', !!r.data.user);
  assert('Admin flag is true', r.data.user?.isAdmin === true);
  let ADMIN_TOKEN = r.data.token;

  // Register normal user
  r = await req('/api/saas/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'user123', name: 'Normal User' }),
  });
  assertEq('Normal user registered', r.status, 201);
  let USER_ID = r.data.user.id;
  let USER_TOKEN = r.data.token;

  // ─── Test 1: Admin can list users ───
  console.log('\n── Test 1: List users (admin) ──');
  r = await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  assertEq('Admin can list users', r.status, 200);
  assert('Has at least 2 users', r.data.users?.length >= 2, 'got ' + r.data.users?.length);

  // ─── Test 2: Non-admin cannot list users ───
  console.log('\n── Test 2: Non-admin cannot list users ──');
  r = await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
  assertEq('Non-admin gets 404', r.status, 404);

  // ─── Test 3: Admin can change user's tier ───
  console.log('\n── Test 3: Change user tier ──');
  r = await req(`/api/saas/admin/users/${USER_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ tier: 'pro' }),
  });
  assertEq('Tier updated', r.status, 200);

  r = await req('/api/saas/account', { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
  assertEq('User tier is now pro', r.data.user?.tier, 'pro');

  // ─── Test 4: Admin can block user ───
  console.log('\n── Test 4: Block/unblock user ──');
  r = await req(`/api/saas/admin/users/${USER_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ isActive: false }),
  });
  assertEq('Block returned 200', r.status, 200);

  r = await req('/api/saas/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'user123' }),
  });
  assertEq('Blocked user cannot login', r.status, 401);
  assert('Error mentions disabled', (r.data.error || '').toLowerCase().includes('disabled'), r.data.error);

  r = await req(`/api/saas/admin/users/${USER_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ isActive: true }),
  });
  assertEq('Unblock returned 200', r.status, 200);

  r = await req('/api/saas/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'user123' }),
  });
  assertEq('Unblocked user can login', r.status, 200);
  USER_TOKEN = r.data.token;

  // ─── Test 5: Admin can toggle admin role ───
  console.log('\n── Test 5: Toggle admin role ──');
  r = await req(`/api/saas/admin/users/${USER_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ isAdmin: true }),
  });
  assertEq('Made user admin', r.status, 200);

  r = await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
  assertEq('New admin can list users', r.status, 200);

  r = await req(`/api/saas/admin/users/${USER_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ isAdmin: false }),
  });
  assertEq('Revoked admin', r.status, 200);

  r = await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
  assertEq('Former admin gets 404', r.status, 404);

  // ─── Test 6: Admin cannot modify self ───
  console.log('\n── Test 6: Admin cannot modify self ──');
  const adminId = r.data?.users?.[0]?.id || (await (await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })).data.users?.[0]?.id);
  // Can't get admin ID unless we're admin, so use a different approach
  r = await req('/api/saas/account', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  const myId = r.data.user?.id;
  r = await req(`/api/saas/admin/users/${myId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ tier: 'enterprise' }),
  });
  assert('Cannot modify self via admin (400)', r.status === 400, `got ${r.status}`);

  // ─── Test 7: Admin can create users ───
  console.log('\n── Test 7: Admin creates user ──');
  r = await req('/api/saas/admin/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ email: 'created@test.com', password: 'pass123', name: 'Created User', tier: 'enterprise', isAdmin: true }),
  });
  assertEq('Admin created user', r.status, 201);
  const CREATED_ID = r.data.user?.id;
  assert('Created user has id', !!CREATED_ID, 'missing id');

  r = await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  const found = r.data.users?.find(u => u.id === CREATED_ID);
  assert('Created user in list', !!found, 'not found in users');
  assertEq('Created tier is enterprise', found?.tier, 'enterprise');
  assert('Created user is admin', found?.isAdmin === true, 'isAdmin=' + found?.isAdmin);

  // ─── Test 8: API key operations ───
  console.log('\n── Test 8: API key operations ──');
  r = await req('/api/saas/keys', {
    method: 'POST',
    headers: { Authorization: `Bearer ${USER_TOKEN}` },
    body: JSON.stringify({ name: 'test-key' }),
  });
  assertEq('Key created', r.status, 201);
  const API_KEY = r.data.key?.key;
  assert('Has fw_ prefix', API_KEY?.startsWith('fw_'), 'got ' + API_KEY?.slice(0, 8));

  r = await req('/v1/models', { headers: { Authorization: `Bearer ${API_KEY}` } });
  assert('API key auth works (' + r.status + ')', r.status === 200, 'auth failed: ' + (r.data.error || ''));

  // ─── Test 9: Delete user ───
  console.log('\n── Test 9: Delete user ──');
  r = await req(`/api/saas/admin/users/${USER_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assertEq('User deleted 200', r.status, 200);

  r = await req('/api/saas/admin/users', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  assert('Deleted user gone from list', !r.data.users?.some(u => u.id === USER_ID), 'still present');

  r = await req('/api/saas/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user@test.com', password: 'user123' }),
  });
  assert('Deleted user cannot login (' + r.status + ')', r.status === 401, 'login succeeded');

  // ─── Test 10: Admin cannot delete self ───
  console.log('\n── Test 10: Admin cannot delete self ──');
  r = await req(`/api/saas/admin/users/${myId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert('Cannot delete self (' + r.status + ')', r.status === 400, 'delete self succeeded');

  // ─── Test 11: Bootstrap only works once ───
  console.log('\n── Test 11: Bootstrap idempotency ──');
  r = await req('/api/saas/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin2@test.com', password: 'pass123', name: 'Admin2' }),
  });
  assert('Bootstrap fails if users exist (' + r.status + ')', r.status === 400, r.data.error);

  // ─── Summary ───
  console.log(`\n=== Results: ${PASSED} passed, ${FAILED} failed ===\n`);
  process.exit(FAILED > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
