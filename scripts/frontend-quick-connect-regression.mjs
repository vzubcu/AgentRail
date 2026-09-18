import assert from 'node:assert/strict';

class FakeOption {
  constructor(value, label) {
    this.value = value;
    this.label = label;
    this.textContent = label;
    this.selected = false;
  }
}

class FakeElement {
  constructor({ id = '', dataset = {}, tagName = 'div', value = '', textContent = '' } = {}) {
    this.id = id;
    this.dataset = { ...dataset };
    this.tagName = tagName;
    this.value = value;
    this.textContent = textContent;
    this.disabled = false;
    this.className = '';
    this._innerHTML = '';
    this.options = [];
    this.listeners = new Map();
    this.childButtons = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (this.tagName === 'select') {
      this.options = [...value.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(match => new FakeOption(match[1], match[2]));
      if (!this.options.some(option => option.value === this.value)) {
        this.value = this.options[0]?.value || '';
      }
      return;
    }

    this.childButtons = [...value.matchAll(/data-agent-filter-value="([^"]+)"/g)].map(match => new FakeElement({
      dataset: { agentFilterValue: match[1] },
      tagName: 'button',
      textContent: match[1],
    }));
  }

  get selectedOptions() {
    return this.options.filter(option => option.selected);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  async dispatch(type) {
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      await handler({ currentTarget: this, target: this });
    }
  }

  click() {
    return this.dispatch('click');
  }

  querySelectorAll(selector) {
    if (selector === '[data-agent-filter-value]') {
      return this.childButtons;
    }
    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getAttribute(name) {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      return this.dataset[key] ?? null;
    }
    return this[name] ?? null;
  }
}

class FakeDocument {
  constructor(elements) {
    this.elements = elements;
    this.byId = new Map(elements.filter(element => element.id).map(element => [element.id, element]));
  }

  getElementById(id) {
    return this.byId.get(id) ?? null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-agent-filter-target]') {
      return this.elements.filter(element => element.dataset.agentFilterTarget);
    }
    if (selector === '[data-agent-model-target]') {
      return this.elements.filter(element => element.dataset.agentModelTarget);
    }
    if (selector === '[data-agent-configure]') {
      return this.elements.filter(element => element.dataset.agentConfigure);
    }
    if (selector === '[data-agent-launch]') {
      return this.elements.filter(element => element.dataset.agentLaunch);
    }
    if (selector === '[data-agent-guide]') {
      return this.elements.filter(element => element.dataset.agentGuide);
    }

    const modelMatch = selector.match(/^\[data-agent-model-target="([^"]+)"\]\[data-agent-model-role="([^"]+)"\]$/);
    if (modelMatch) {
      return this.elements.filter(element => element.dataset.agentModelTarget === modelMatch[1] && (element.dataset.agentModelRole || 'setup') === modelMatch[2]);
    }

    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

const gatewayInput = new FakeElement({ id: 'gateway-key', tagName: 'input', value: 'gateway-demo' });
const codexSetupFilter = new FakeElement({ dataset: { agentFilterTarget: 'codex', agentModelRole: 'setup' } });
const codexLaunchFilter = new FakeElement({ dataset: { agentFilterTarget: 'codex', agentModelRole: 'launch' } });
const codexSetupSelect = new FakeElement({ dataset: { agentModelTarget: 'codex', agentModelRole: 'setup' }, tagName: 'select' });
const codexLaunchSelect = new FakeElement({ dataset: { agentModelTarget: 'codex', agentModelRole: 'launch' }, tagName: 'select' });
const configureButton = new FakeElement({ dataset: { agentConfigure: 'codex', agentResultId: 'codex-agent-config-result' }, tagName: 'button', textContent: 'Configure Codex' });
const launchButton = new FakeElement({ dataset: { agentLaunch: 'codex', agentResultId: 'codex-agent-config-result' }, tagName: 'button', textContent: 'Launch Codex' });
const guideButton = new FakeElement({ dataset: { agentGuide: 'aider', agentResultId: 'aider-agent-guide-result' }, tagName: 'button', textContent: 'Show setup' });
const cursorGuideButton = new FakeElement({ dataset: { agentGuide: 'cursor', agentResultId: 'cursor-agent-guide-result' }, tagName: 'button', textContent: 'Show setup' });
const antigravityGuideButton = new FakeElement({ dataset: { agentGuide: 'antigravity', agentResultId: 'antigravity-agent-guide-result' }, tagName: 'button', textContent: 'Show setup' });
const configResult = new FakeElement({ id: 'codex-agent-config-result' });
const guideResult = new FakeElement({ id: 'aider-agent-guide-result' });
const cursorGuideResult = new FakeElement({ id: 'cursor-agent-guide-result' });
const antigravityGuideResult = new FakeElement({ id: 'antigravity-agent-guide-result' });

const document = new FakeDocument([
  gatewayInput,
  codexSetupFilter,
  codexLaunchFilter,
  codexSetupSelect,
  codexLaunchSelect,
  configureButton,
  launchButton,
  guideButton,
  cursorGuideButton,
  antigravityGuideButton,
  configResult,
  guideResult,
  cursorGuideResult,
  antigravityGuideResult,
]);

globalThis.document = document;
globalThis.window = {
  location: { origin: 'http://localhost:42424' },
  setTimeout(callback) {
    callback();
    return 1;
  },
};

const requests = [];
const storedGatewayKeys = [];

const { createQuickConnectFeature } = await import('../src/web/app/features/quick-connect/entry.js');

const state = {
  models: [
    {
      id: 'openai/gpt-5',
      providers: [{ name: 'openai' }],
    },
    {
      id: 'anthropic/claude-sonnet',
      providers: [{ name: 'anthropic' }],
    },
    {
      id: 'custom/router',
      isVirtual: true,
      providers: [{ name: 'openai' }, { name: 'anthropic' }],
    },
  ],
  lastAgentResults: {},
  quickConnectFilters: {},
  quickConnectSelections: {},
};

const feature = createQuickConnectFeature({
  state,
  fetchJSON: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) });
    if (url === '/api/agents/configure') {
      return {
        ok: true,
        target: 'codex',
        mode: 'configured',
        rootPath: 'D:/Users/demo/.codex',
        written: 2,
        defaultProfile: 'agentrail-auto',
        providerConfig: 'created',
        primarySelection: { name: 'agentrail-auto', modelId: 'agentrail/auto' },
        profiles: [{ modelId: 'agentrail/auto', profileName: 'agentrail-auto' }],
        env: { AGENTRAIL_API_KEY: 'demo-key' },
        files: [{ kind: 'profile', path: '.codex/agentrail-auto.config.toml' }],
        steps: [],
        warnings: [],
        errors: [],
      };
    }
    if (url === '/api/agents/launch') {
      return {
        ok: true,
        target: 'codex',
        launched: false,
        profileName: request.body.includes('agentrail-auto') ? 'agentrail-auto' : null,
        env: { AGENTRAIL_API_KEY: 'demo-key' },
        commandPreview: 'codex --profile agentrail-auto',
        warnings: [],
        errors: [],
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  },
  fetchJSONWithGatewayKey: async (url, request, gatewayKey) => {
    storedGatewayKeys.push(gatewayKey);
    return { url, request };
  },
  getStoredGatewayKey: () => 'stored-gateway-key',
  setStoredGatewayKey: (value) => storedGatewayKeys.push(value),
  escapeHtml: (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;'),
  copyText: async () => {},
});

feature.bind();
feature.renderAgentModelSelectors();

assert.equal(codexSetupSelect.options[0]?.value, 'agentrail/auto');
assert.equal(codexLaunchSelect.options[0]?.value, 'agentrail/auto');
assert.deepEqual(state.quickConnectSelections['codex:setup'], ['agentrail/auto']);
assert.deepEqual(state.quickConnectSelections['codex:launch'], ['agentrail/auto']);

const agentrailFilterButton = codexSetupFilter.querySelectorAll('[data-agent-filter-value]').find(button => button.dataset.agentFilterValue === 'agentrail');
assert(agentrailFilterButton, 'expected agentrail filter for virtual models');
await agentrailFilterButton.click();
assert.equal(state.quickConnectFilters['codex:setup'], 'agentrail');
assert.deepEqual(codexSetupSelect.options.map(option => option.value), ['agentrail/auto', 'custom/router']);

const openAiFilterButton = codexSetupFilter.querySelectorAll('[data-agent-filter-value]').find(button => button.dataset.agentFilterValue === 'openai');
await openAiFilterButton.click();
assert.equal(state.quickConnectFilters['codex:setup'], 'openai');
assert.deepEqual(codexSetupSelect.options.map(option => option.value), ['agentrail/auto', 'openai/gpt-5']);
codexSetupSelect.options[0].selected = false;
codexSetupSelect.options[1].selected = true;
codexSetupSelect.value = 'openai/gpt-5';
await codexSetupSelect.dispatch('change');
assert.deepEqual(state.quickConnectSelections['codex:setup'], ['openai/gpt-5']);

feature.showAgentGuide('aider', 'aider-agent-guide-result');
assert.match(guideResult.innerHTML, /Aider setup guide/);
assert.match(guideResult.innerHTML, /OPENAI_API_BASE/);
feature.showAgentGuide('cursor', 'cursor-agent-guide-result');
assert.match(cursorGuideResult.innerHTML, /Cursor setup guide/);
assert.match(cursorGuideResult.innerHTML, /OpenAI endpoint/);

feature.showAgentGuide('antigravity', 'antigravity-agent-guide-result');
assert.match(antigravityGuideResult.innerHTML, /Antigravity setup guide/);
assert.match(antigravityGuideResult.innerHTML, /custom provider or proxy/i);


await configureButton.click();
assert.equal(requests[0].url, '/api/agents/configure');
assert.deepEqual(requests[0].body.modelIds, ['openai/gpt-5']);
assert.equal(state.lastAgentResults.codex.defaultProfile, 'agentrail-auto');
assert.match(configResult.innerHTML, /Configured/);
assert.match(configResult.innerHTML, /agentrail-auto/);

state.quickConnectSelections['codex:launch'] = ['agentrail/auto'];
await launchButton.click();
assert.equal(requests[1].url, '/api/agents/launch');
assert.equal(requests[1].body.modelId, 'agentrail/auto');
assert.equal(requests[1].body.profileName, 'agentrail-auto');
assert.equal(requests[1].body.gatewayKey, 'gateway-demo');
assert.match(configResult.innerHTML, /Codex launch/);
assert.equal(storedGatewayKeys.length, 0);

console.log('frontend quick connect regression passed');


