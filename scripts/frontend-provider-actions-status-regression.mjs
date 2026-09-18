import assert from 'node:assert/strict';

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  return {
    ok: false,
    status: 503,
    json: async () => ({
      error: {
        message: 'Provider route failed',
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
};

const statusEvents = [];
const { createProviderActions } = await import('../src/web/app/features/providers/actions.js');

const actions = createProviderActions({
  state: {},
  loadCatalog: async () => {},
  providerPath: (providerName) => `/providers/${providerName}`,
  activateTab() {},
  reportStatus(event) {
    statusEvents.push(event);
  },
});

await assert.rejects(() => actions.runProviderHealthCheck('kimi'));

assert.equal(fetchCalls, 1, 'provider action should issue one request when retries are not configured');
assert.equal(statusEvents.length, 1, 'provider action failures should emit a shared status event');
assert.equal(statusEvents[0].level, 'error');
assert.equal(statusEvents[0].message, 'Provider route failed');
assert.equal(statusEvents[0].details?.provider, 'kimi');
assert.equal(statusEvents[0].details?.keyFingerprint, 'abcd1234ef567890');
assert.equal(statusEvents[0].details?.status, 503);
assert.equal(statusEvents[0].details?.type, 'provider_unhealthy');

console.log('frontend provider actions status regression passed');
