import assert from 'node:assert/strict';

class FakeElement {
  constructor({ id = '' } = {}) {
    this.id = id;
    this.textContent = '';
    this._innerHTML = '';
    this.disabled = false;
  }

  set innerHTML(value) {
    this._innerHTML = value;
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

const elements = new Map([
  ['usage-total-calls', new FakeElement({ id: 'usage-total-calls' })],
  ['usage-total-prompt-tokens', new FakeElement({ id: 'usage-total-prompt-tokens' })],
  ['usage-total-completion-tokens', new FakeElement({ id: 'usage-total-completion-tokens' })],
  ['usage-total-tokens', new FakeElement({ id: 'usage-total-tokens' })],
  ['usage-table-body', new FakeElement({ id: 'usage-table-body' })],
  ['usage-virtual-models-body', new FakeElement({ id: 'usage-virtual-models-body' })],
  ['sync-meta', new FakeElement({ id: 'sync-meta' })],
  ['clear-usage', new FakeElement({ id: 'clear-usage' })],
]);

globalThis.document = {
  getElementById(id) {
    return elements.get(id) ?? null;
  },
};

globalThis.alert = () => {};
globalThis.confirm = () => true;

const { createUsageFeature } = await import('../src/web/app/features/usage.js');

const state = {
  usageRecords: [
    {
      modelId: 'coding',
      providerName: 'openrouter',
      callCount: 32,
      promptTokens: 1755491,
      completionTokens: 16538,
      totalTokens: 1772029,
      lastUsedAt: 1784526738550,
    },
  ],
  virtualModelStats: [
    {
      id: 'coding',
      totalRequests: 73,
      lastUsedAt: 1784526658824,
      routeHits: [
        { provider: 'kilo', modelId: 'kilo-auto-free', count: 25 },
        { provider: 'opencode', modelId: 'deepseek-v4-flash-free', count: 24 },
      ],
      routeFailures: [],
    },
  ],
  syncMetas: {},
  lastRefreshResult: null,
};

const usageFeature = createUsageFeature({
  state,
  fetchJSON: async () => ({ records: [], virtualModelStats: [] }),
  escapeHtml: (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;'),
  formatNumber: value => String(value),
  formatTime: value => `time:${value}`,
});

usageFeature.renderUsage();

const virtualModelsMarkup = elements.get('usage-virtual-models-body')?.innerHTML ?? '';

assert.match(
  virtualModelsMarkup,
  /kilo/,
  'usage page should render the routed provider from virtual model stats',
);

assert.match(
  virtualModelsMarkup,
  /kilo-auto-free/,
  'usage page should render the routed model from virtual model stats',
);

console.log('frontend usage regression passed');
