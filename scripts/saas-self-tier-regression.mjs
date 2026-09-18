import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AGENTRAIL_SAAS = '1';
process.env.HOST = '127.0.0.1';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-saas-self-tier-'));
process.chdir(tempRoot);

const { createServer } = await import('../dist/server.js');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

const server = createServer({
  routeChatCompletion: async () => {
    throw new Error('chat routing should not be reached in saas self-tier regression');
  },
});

const baseUrl = await listen(server);

try {
  const bootstrap = await request(baseUrl, '/api/saas/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@test.com',
      password: 'admin123',
      name: 'Admin',
    }),
  });

  assert.equal(bootstrap.response.status, 201);
  const adminId = bootstrap.data?.user?.id;
  assert.ok(adminId);

  const login = await request(baseUrl, '/api/saas/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@test.com',
      password: 'admin123',
    }),
  });

  assert.equal(login.response.status, 200);
  const token = login.data?.token;
  const csrfToken = login.data?.csrfToken;
  assert.ok(token);
  assert.ok(csrfToken);

  const update = await request(baseUrl, `/api/saas/admin/users/${adminId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ tier: 'pro' }),
  });

  assert.equal(update.response.status, 200);

  const account = await request(baseUrl, '/api/saas/account', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert.equal(account.response.status, 200);
  assert.equal(account.data?.user?.tier, 'pro');

  console.log('saas self tier regression passed');
} finally {
  await close(server);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

