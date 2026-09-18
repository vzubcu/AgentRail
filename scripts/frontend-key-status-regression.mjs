import assert from 'node:assert/strict';

class FakeElement {
  constructor({ id = '', hidden = false, value = '', textContent = '' } = {}) {
    this.id = id;
    this.hidden = hidden;
    this.value = value;
    this.textContent = textContent;
    this.innerHTML = '';
    this.required = false;
    this.placeholder = '';
    this.focused = false;
    this.selectorMap = {};
  }

  focus() {
    this.focused = true;
  }

  querySelector(selector) {
    const value = this.selectorMap[selector];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }
}

const title = new FakeElement({ id: 'provider-key-modal-title' });
const primaryLabel = new FakeElement();
const primaryInput = new FakeElement({ id: 'provider-key-modal-input', value: 'bad-key' });
const secondaryGroup = new FakeElement({ id: 'provider-key-modal-secondary-group', hidden: true });
const secondaryLabel = new FakeElement();
const secondaryInput = new FakeElement({ id: 'provider-key-modal-secondary-input', value: '' });
const instructions = new FakeElement({ id: 'provider-key-modal-instructions', hidden: true });
const instructionsList = new FakeElement({ id: 'provider-key-modal-instructions-list' });
const submitButton = new FakeElement({ textContent: 'Add key' });
const modal = new FakeElement({ id: 'provider-key-modal', hidden: false });
modal.selectorMap['button[type="submit"]'] = submitButton;

const elementById = new Map([
  ['provider-key-modal', modal],
  ['provider-key-modal-title', title],
  ['provider-key-modal-input', primaryInput],
  ['provider-key-modal-secondary-group', secondaryGroup],
  ['provider-key-modal-secondary-input', secondaryInput],
  ['provider-key-modal-instructions', instructions],
  ['provider-key-modal-instructions-list', instructionsList],
]);

globalThis.document = {
  getElementById(id) {
    return elementById.get(id) ?? null;
  },
  querySelector(selector) {
    if (selector === 'label[for="provider-key-modal-input"]') return primaryLabel;
    if (selector === 'label[for="provider-key-modal-secondary-input"]') return secondaryLabel;
    return null;
  },
};

let alertCalls = 0;
globalThis.alert = () => {
  alertCalls += 1;
};

const statusEvents = [];

const { createKeysFeature } = await import('../src/web/app/features/keys.js');

const state = {
  providers: [
    {
      name: 'kimi',
      apiKeyEnvVar: 'KIMI_API_KEY',
      envVars: ['KIMI_API_KEY'],
      apiKeyInstructions: [],
    },
  ],
  keyModalProviderName: 'kimi',
  keyModalEnvVar: 'KIMI_API_KEY',
  keyModalMode: 'add',
};

const feature = createKeysFeature({
  state,
  fetchJSON: async () => {
    const error = new Error('Provider unavailable');
    error.status = 503;
    error.type = 'provider_unhealthy';
    error.details = {
      provider: 'kimi',
      keyFingerprint: 'abcd1234ef567890',
      checkedAt: 1721640000000,
      lastError: 'HTTP 429: rate limit exceeded',
    };
    throw error;
  },
  fetchJSONWithGatewayKey: async () => ({}),
  getStoredGatewayKey: () => '',
  setStoredGatewayKey() {},
  isCloudflareProvider: () => false,
  escapeHtml: (value) => String(value),
  loadCatalog: async () => {},
  reportStatus(event) {
    statusEvents.push(event);
  },
});

await feature.addProviderKeyFromModal({ preventDefault() {} });

assert.equal(alertCalls, 0, 'provider key failures should not use blocking alert dialogs');
assert.equal(statusEvents.length, 1, 'provider key failures should be reported through the shared status surface');
assert.equal(statusEvents[0].level, 'error');
assert.match(statusEvents[0].message, /provider unavailable/i);
assert.equal(statusEvents[0].details?.type, 'provider_unhealthy');
assert.equal(statusEvents[0].details?.status, 503);
assert.equal(statusEvents[0].details?.provider, 'kimi');
assert.equal(statusEvents[0].details?.keyFingerprint, 'abcd1234ef567890');

console.log('frontend key status regression passed');
