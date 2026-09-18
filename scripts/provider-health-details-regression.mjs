import assert from 'node:assert/strict';

process.env.KIMI_API_KEY = 'first-test-key,second-test-key';

const health = await import('../dist/health.js');
const providerIndex = await import('../dist/providers/index.js');

const provider = providerIndex.providers.find((entry) => entry.name === 'kimi');

assert.ok(provider, 'expected kimi provider to exist');

let requestCount = 0;
provider.chatCompletion = async () => {
  requestCount += 1;
  return {
    ok: false,
    status: 429,
    text: async () => `rate limited on attempt ${requestCount}`,
  };
};

const result = await health.checkProviderHealth('kimi');

assert.equal(result.state, 'unhealthy');
assert.equal(result.lastStatusCode, 429);
assert.equal(result.failureReason, 'http_error', 'unhealthy provider should expose a machine-readable reason');
assert.ok(result.failureContext, 'unhealthy provider should expose structured failure context');
assert.equal(result.failureContext.provider, 'kimi');
assert.equal(result.failureContext.envVar, 'KIMI_API_KEY');
assert.equal(result.failureContext.keyFingerprint?.length, 16, 'unhealthy provider should expose the fingerprint of the failing key');
assert.equal(result.failureContext.attemptedKeyOrder?.length, 2, 'provider health should report all configured keys that were attempted');
assert.equal(result.failureContext.unhealthyKeyFingerprint, result.failureContext.keyFingerprint, 'primary failure key should be identified explicitly');
assert.ok(Number.isFinite(result.failureContext.checkedAt), 'failure context should include timestamp details');
assert.match(result.failureContext.lastError ?? '', /rate limited/i, 'failure context should preserve the provider error');

console.log('provider health details regression passed');
