import assert from 'node:assert/strict';

const config = await import('../dist/config.js');

const allowed = new Set(['TEST_PROVIDER_API_KEY']);

config.setRuntimeApiKey('TEST_PROVIDER_API_KEY', [' first-key ', '', 'second-key', 'first-key']);

assert.deepEqual(
  config.getEffectiveApiKeys('TEST_PROVIDER_API_KEY'),
  ['first-key', 'second-key'],
  'runtime keys are trimmed, empty values are removed, and duplicates are ignored'
);

assert.equal(
  config.getEffectiveApiKey('TEST_PROVIDER_API_KEY'),
  'first-key',
  'legacy single-key API returns the first configured key'
);

assert.equal(config.getNextApiKey('TEST_PROVIDER_API_KEY'), 'first-key');
assert.equal(config.getNextApiKey('TEST_PROVIDER_API_KEY'), 'second-key');
assert.equal(config.getNextApiKey('TEST_PROVIDER_API_KEY'), 'first-key');

const summary = config.buildApiKeySummary('TEST_PROVIDER_API_KEY');
assert.equal(summary.configured, true);
assert.equal(summary.managedCount, 2);
assert.equal(summary.keys[0].source, 'managed');
assert.equal(summary.keys[0].preview.includes('first-key'), false, 'summary does not expose the full key');

config.addRuntimeApiKey('TEST_PROVIDER_API_KEY', 'third-key');
assert.deepEqual(
  config.getEffectiveApiKeys('TEST_PROVIDER_API_KEY'),
  ['first-key', 'second-key', 'third-key'],
  'incremental add appends to the managed key list'
);

const secondKey = config.buildApiKeySummary('TEST_PROVIDER_API_KEY').keys.find((key) => key.preview.startsWith('seco'));
assert.ok(secondKey, 'expected to find a masked second key');
assert.equal(config.removeRuntimeApiKeyByFingerprint('TEST_PROVIDER_API_KEY', secondKey.fingerprint), true);
assert.deepEqual(
  config.getEffectiveApiKeys('TEST_PROVIDER_API_KEY'),
  ['first-key', 'third-key'],
  'delete removes a managed key by fingerprint'
);

assert.deepEqual(
  config.exportConfigurableApiKeys(allowed),
  { TEST_PROVIDER_API_KEY: ['first-key', 'third-key'] },
  'exported config preserves all runtime keys'
);

config.setRuntimeApiKey('TEST_PROVIDER_API_KEY', '');
assert.deepEqual(config.getEffectiveApiKeys('TEST_PROVIDER_API_KEY'), []);
assert.equal(config.getEffectiveApiKey('TEST_PROVIDER_API_KEY'), undefined);
assert.equal(config.getNextApiKey('TEST_PROVIDER_API_KEY'), undefined);

console.log('multi-provider-key regression passed');
