import assert from 'node:assert/strict';

const scheduledTimeouts = [];

globalThis.window = {
  localStorage: {
    getItem() { return ''; },
    setItem() {},
    removeItem() {},
  },
};

globalThis.Headers = class FakeHeaders {
  constructor(init = {}) {
    this.map = new Map();
    if (init instanceof FakeHeaders) {
      for (const [key, value] of init.map.entries()) {
        this.map.set(key.toLowerCase(), value);
      }
      return;
    }
    for (const [key, value] of Object.entries(init)) {
      this.map.set(String(key).toLowerCase(), String(value));
    }
  }
  has(name) {
    return this.map.has(String(name).toLowerCase());
  }
  set(name, value) {
    this.map.set(String(name).toLowerCase(), String(value));
  }
};

globalThis.AbortSignal = {
  timeout(ms) {
    scheduledTimeouts.push(ms);
    return { timeoutMs: ms };
  },
};

let fetchAttempts = 0;
globalThis.fetch = async () => {
  fetchAttempts += 1;
  if (fetchAttempts === 1) {
    return {
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          message: 'Provider unavailable',
          type: 'provider_unhealthy',
          details: {
            provider: 'kimi',
            keyFingerprint: 'abcd1234ef567890',
            checkedAt: 1721640000000,
            lastError: 'HTTP 429: rate limit exceeded',
          },
        },
      }),
    };
  }

  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  };
};

const { fetchJSON } = await import('../src/web/app/lib/http.js');

const payload = await fetchJSON('/api/health/check/kimi', {
  method: 'POST',
  retry: { retries: 1, retryStatuses: [503] },
  timeoutMs: 1500,
});

assert.deepEqual(payload, { ok: true }, 'request should succeed after a retry');
assert.equal(fetchAttempts, 2, 'fetchJSON should retry retryable HTTP failures');
assert.deepEqual(scheduledTimeouts, [1500, 1500], 'fetchJSON should apply AbortSignal.timeout to each attempt');

fetchAttempts = 0;
globalThis.fetch = async () => ({
  ok: false,
  status: 503,
  json: async () => ({
    error: {
      message: 'Provider unavailable',
      type: 'provider_unhealthy',
      details: {
        provider: 'kimi',
        keyFingerprint: 'abcd1234ef567890',
        checkedAt: 1721640000000,
        lastError: 'HTTP 429: rate limit exceeded',
      },
    },
  }),
});

await assert.rejects(
  () => fetchJSON('/api/health/check/kimi', { method: 'POST', timeoutMs: 900 }),
  (error) => {
    assert.equal(error.message, 'Provider unavailable');
    assert.equal(error.status, 503, 'structured HTTP errors should preserve status');
    assert.equal(error.type, 'provider_unhealthy', 'structured HTTP errors should preserve backend type');
    assert.deepEqual(
      error.details,
      {
        provider: 'kimi',
        keyFingerprint: 'abcd1234ef567890',
        checkedAt: 1721640000000,
        lastError: 'HTTP 429: rate limit exceeded',
      },
      'structured HTTP errors should preserve backend details',
    );
    assert.equal(error.retryable, true, '5xx responses should be marked retryable');
    return true;
  },
);

globalThis.fetch = async () => {
  const error = new TypeError('fetch failed');
  error.cause = { code: 'ECONNRESET' };
  throw error;
};

await assert.rejects(
  () => fetchJSON('/api/models/refresh', { method: 'POST', timeoutMs: 1200 }),
  (error) => {
    assert.match(error.message, /network request failed/i, 'network failures should get a user-facing message');
    assert.equal(error.type, 'network_error', 'network failures should be normalized');
    assert.equal(error.retryable, true, 'network failures should be marked retryable');
    assert.equal(error.status, null, 'network failures should not report an HTTP status');
    return true;
  },
);

console.log('frontend request errors regression passed');
