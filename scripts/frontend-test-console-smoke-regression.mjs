import assert from 'node:assert/strict';

class FakeElement {
  constructor({ id = '', value = '', checked = false } = {}) {
    this.id = id;
    this.value = value;
    this.checked = checked;
    this.innerHTML = '';
    this.textContent = '';
    this.listeners = new Map();
  }
  addEventListener(event, handler) { this.listeners.set(event, handler); }
  querySelectorAll(selector) {
    if (selector === '[data-remove-test-attachment]') return this.removeButtons || [];
    return [];
  }
}

function makeRemoveButton(id) {
  return {
    getAttribute(name) { return name === 'data-remove-test-attachment' ? id : ''; },
    addEventListener(event, handler) { this.click = handler; },
  };
}

const queue = new FakeElement({ id: 'test-attachment-queue' });
const thread = new FakeElement({ id: 'test-thread' });
const providerFilter = new FakeElement({ id: 'test-provider-filter', value: 'all' });
const modelSelect = new FakeElement({ id: 'test-model', value: '' });
const resultContent = new FakeElement({ id: 'result-content' });
const routeInfo = new FakeElement({ id: 'route-info' });
const messageInput = new FakeElement({ id: 'test-message', value: '' });
const streamInput = new FakeElement({ id: 'test-stream', checked: true });
const tempInput = new FakeElement({ id: 'test-temp', value: '0.7' });
const maxTokensInput = new FakeElement({ id: 'test-max-tokens', value: '256' });
const attachmentsInput = new FakeElement({ id: 'test-attachments' });
const clearThread = new FakeElement({ id: 'test-clear-thread' });
const sendTest = new FakeElement({ id: 'send-test' });
const elementById = new Map([
  ['test-attachment-queue', queue],
  ['test-thread', thread],
  ['test-provider-filter', providerFilter],
  ['test-model', modelSelect],
  ['result-content', resultContent],
  ['route-info', routeInfo],
  ['test-message', messageInput],
  ['test-stream', streamInput],
  ['test-temp', tempInput],
  ['test-max-tokens', maxTokensInput],
  ['test-attachments', attachmentsInput],
  ['test-clear-thread', clearThread],
  ['send-test', sendTest],
]);

globalThis.document = {
  getElementById(id) { return elementById.get(id) ?? null; },
};

globalThis.window = { setTimeout(fn) { fn(); return 0; } };
globalThis.URL = { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} };
globalThis.alert = () => {};

const { createTestConsoleFeature } = await import('../src/web/app/features/test-console.js');

const state = {
  providers: [
    { name: 'alpha', health: { state: 'healthy' } },
    { name: 'beta', health: { state: 'unhealthy' } },
    { name: 'gamma', health: { state: 'configured' } },
  ],
  models: [
    { id: 'vision-model', capabilities: ['chat', 'vision'], providers: [{ name: 'alpha' }] },
    { id: 'custom/router', isVirtual: true, capabilities: ['chat'], providers: [{ name: 'alpha' }, { name: 'beta' }] },
  ],
  queuedTestAttachments: [],
  testConversation: [],
};

const feature = createTestConsoleFeature({
  state,
  fetchJSON: async () => ({}),
  withGatewayAuthHeaders(headers) { return headers; },
  escapeHtml(value) { return String(value); },
  formatBytes(value) { return `${value} B`; },
  getSortedProviderNames() { return ['alpha', 'beta', 'gamma']; },
  formatNumber(value) { return String(value); },
});

feature.renderProviderFilter();
assert.match(providerFilter.innerHTML, /All providers/);
assert.match(providerFilter.innerHTML, /<option value="alpha">alpha<\/option>/);
assert.match(providerFilter.innerHTML, /<option value="beta" disabled>beta \(Unhealthy\)<\/option>/);
assert.match(providerFilter.innerHTML, /<option value="gamma" disabled>gamma \(Configured\)<\/option>/);
assert.match(providerFilter.innerHTML, /<option value="agentrail">agentrail<\/option>/);
feature.renderModelOptions();
assert.match(modelSelect.innerHTML, /alpha \/ vision-model/);
assert.match(modelSelect.innerHTML, /agentrail \/ custom\/router/);
assert.doesNotMatch(modelSelect.innerHTML, /beta/);

state.queuedTestAttachments = [{ id: 'a1', name: 'proof.pdf', size: 42, status: 'Ready', previewUrl: '', kind: 'pdf' }];
queue.removeButtons = [makeRemoveButton('a1')];
feature.renderAttachmentQueue();
assert.match(queue.innerHTML, /proof.pdf/);
queue.removeButtons[0].click();
assert.equal(state.queuedTestAttachments.length, 0);

state.testConversation = [{ role: 'user', requestedModel: 'alpha/vision-model', routeModel: 'alpha/vision-model', text: 'Hello', attachments: [] }];
feature.renderThread();
assert.match(thread.innerHTML, /Hello/);
feature.clearConversation();
assert.equal(state.testConversation.length, 0);
assert.match(thread.innerHTML, /thread is empty/i);

console.log('frontend test console smoke regression passed');
