import assert from 'node:assert/strict';

class FakeElement {
  constructor({ id = '', value = '', checked = false, hidden = false, className = '' } = {}) {
    this.id = id;
    this.value = value;
    this.checked = checked;
    this.hidden = hidden;
    this.className = className;
    this.textContent = '';
    this.required = false;
    this.disabled = false;
    this._innerHTML = '';
    this.listeners = new Map();
    this.attributes = new Map();
    this.cachedQueries = new Map();
    this.children = [];
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.cachedQueries = new Map();

    const removeButtons = Array.from(this._innerHTML.matchAll(/class="vm-btn-action vm-btn-remove" data-index="(\d+)"/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-btn-remove' });
      el.setAttribute('data-index', match[1]);
      return el;
    });
    const priorityInputs = Array.from(this._innerHTML.matchAll(/class="vm-model-priority-input" value="(\d+)" min="1" step="1" data-index="(\d+)"/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-model-priority-input', value: match[1] });
      el.setAttribute('data-index', match[2]);
      return el;
    });
    const enabledCheckboxes = Array.from(this._innerHTML.matchAll(/class="vm-model-enabled-input" data-index="(\d+)"( checked)?/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-model-enabled-input', checked: Boolean(match[2]) });
      el.setAttribute('data-index', match[1]);
      return el;
    });
    const weightInputs = Array.from(this._innerHTML.matchAll(/class="vm-model-weight-input" value="(\d+)" min="1" step="1" data-index="(\d+)"/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-model-weight-input', value: match[1] });
      el.setAttribute('data-index', match[2]);
      return el;
    });
    const fallbackCheckboxes = Array.from(this._innerHTML.matchAll(/class="vm-model-fallback-input" data-index="(\d+)"( checked)?/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-model-fallback-input', checked: Boolean(match[2]) });
      el.setAttribute('data-index', match[1]);
      return el;
    });
    const moveUpButtons = Array.from(this._innerHTML.matchAll(/class="vm-btn-action vm-btn-move-up" data-index="(\d+)"/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-btn-move-up' });
      el.setAttribute('data-index', match[1]);
      return el;
    });
    const moveDownButtons = Array.from(this._innerHTML.matchAll(/class="vm-btn-action vm-btn-move-down" data-index="(\d+)"/g)).map((match) => {
      const el = new FakeElement({ className: 'vm-btn-move-down' });
      el.setAttribute('data-index', match[1]);
      return el;
    });

    this.cachedQueries.set('.vm-btn-remove', removeButtons);
    this.cachedQueries.set('.vm-model-priority-input', priorityInputs);
    this.cachedQueries.set('.vm-model-enabled-input', enabledCheckboxes);
    this.cachedQueries.set('.vm-model-weight-input', weightInputs);
    this.cachedQueries.set('.vm-model-fallback-input', fallbackCheckboxes);
    this.cachedQueries.set('.vm-btn-move-up', moveUpButtons);
    this.cachedQueries.set('.vm-btn-move-down', moveDownButtons);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(event, handler) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatch(event, payload = {}) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler({ target: this, preventDefault() {}, key: payload.key, ...payload });
    }
  }

  click() {
    this.dispatch('click');
  }

  focus() {}

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (child.className === 'vm-tag') {
      const tags = this.cachedQueries.get('.vm-tag') ?? [];
      tags.push(child);
      this.cachedQueries.set('.vm-tag', tags);
    }
    return child;
  }

  remove() {
    this.removed = true;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    if (selector === '.vm-tag' && this.children.length > 0) {
      return this.children.filter((child) => child.className === 'vm-tag');
    }
    return this.cachedQueries.get(selector) ?? [];
  }
}

class FakeContainer extends FakeElement {
  constructor() {
    super({ id: 'virtual-models-content' });
    this.mode = 'table';
    this.elements = new Map();
    this.modelList = new FakeElement({ id: 'vm-model-list' });
    this.tagList = new FakeElement({ id: 'vm-tag-list' });
    this.previewPanel = new FakeElement({ id: 'vm-preview-panel' });
    this.statsPanel = new FakeElement({ id: 'vm-stats-panel' });
    this.prunePanel = new FakeElement({ id: 'vm-prune-panel' });
    this.tracePanel = new FakeElement({ id: 'vm-trace-panel' });
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.elements = new Map();

    if (value.includes('vm-form')) {
      this.mode = 'form';
      this.setupFormElements(value);
    } else {
      this.mode = 'table';
      this.setupTableElements(value);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setupTableElements(value) {
    if (value.includes('id="vm-create-btn"')) {
      this.elements.set('#vm-create-btn', new FakeElement({ id: 'vm-create-btn' }));
    }
    if (value.includes('id="vm-template-select"')) {
      const templateSelect = new FakeElement({ id: 'vm-template-select' });
      templateSelect.optionValues = Array.from(value.matchAll(/id="vm-template-select"[\s\S]*?<option value="([^"]*)"/g)).map((match) => match[1]);
      this.elements.set('#vm-template-select', templateSelect);
    }
    if (value.includes('id="vm-create-template-btn"')) {
      this.elements.set('#vm-create-template-btn', new FakeElement({ id: 'vm-create-template-btn' }));
    }

    const editMatches = Array.from(value.matchAll(/data-vm-edit="([^"]+)"/g)).map((match) => {
      const el = new FakeElement();
      el.setAttribute('data-vm-edit', match[1]);
      return el;
    });
    const cloneMatches = Array.from(value.matchAll(/data-vm-clone="([^"]+)"/g)).map((match) => {
      const el = new FakeElement();
      el.setAttribute('data-vm-clone', match[1]);
      return el;
    });
    const deleteMatches = Array.from(value.matchAll(/data-vm-delete="([^"]+)"/g)).map((match) => {
      const el = new FakeElement();
      el.setAttribute('data-vm-delete', match[1]);
      return el;
    });

    this.elements.set('[data-vm-edit]', editMatches);
    this.elements.set('[data-vm-clone]', cloneMatches);
    this.elements.set('[data-vm-delete]', deleteMatches);
  }

  setupFormElements(value) {
    const providerSelect = new FakeElement({ id: 'vm-model-add-provider' });
    providerSelect.optionValues = Array.from(value.matchAll(/<option value="([^"]*)"/g)).map((match) => match[1]);

    const chatCheckbox = new FakeElement({ className: 'vm-cap-checkbox', value: 'chat' });
    const visionCheckbox = new FakeElement({ className: 'vm-cap-checkbox', value: 'vision' });
    const fileCheckbox = new FakeElement({ className: 'vm-cap-checkbox', value: 'file_input' });

    this.modelList = new FakeElement({ id: 'vm-model-list' });
    this.tagList = new FakeElement({ id: 'vm-tag-list' });
    this.previewPanel = new FakeElement({ id: 'vm-preview-panel' });
    this.statsPanel = new FakeElement({ id: 'vm-stats-panel' });
    this.prunePanel = new FakeElement({ id: 'vm-prune-panel' });
    this.tracePanel = new FakeElement({ id: 'vm-trace-panel' });
    const modelListMatch = value.match(/<div class="vm-model-list" id="vm-model-list">([\s\S]*?)<\/div>\s*<\/div>/);
    this.modelList.innerHTML = modelListMatch ? modelListMatch[1] : '';
    const previewPanelMatch = value.match(/<div id="vm-preview-panel" class="vm-preview-panel">([\s\S]*?)<\/div>\s*<\/div>/);
    this.previewPanel.innerHTML = previewPanelMatch ? previewPanelMatch[1] : '';
    const statsPanelMatch = value.match(/<div id="vm-stats-panel" class="vm-stats-panel">([\s\S]*?)<\/div>\s*<div id="vm-prune-panel"/);
    this.statsPanel.innerHTML = statsPanelMatch ? statsPanelMatch[1] : '';
    const prunePanelMatch = value.match(/<div id="vm-prune-panel" class="vm-prune-panel">([\s\S]*?)<\/div>\s*<\/div>/);
    this.prunePanel.innerHTML = prunePanelMatch ? prunePanelMatch[1] : '';
    const tracePanelMatch = value.match(/<div id="vm-trace-panel" class="vm-trace-panel">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="vm-form-actions">/);
    this.tracePanel.innerHTML = tracePanelMatch ? tracePanelMatch[1] : '';

    const idMatch = value.match(/id="vm-field-id" value="([^"]*)"/);
    const nameMatch = value.match(/id="vm-field-name" value="([^"]*)"/);
    const descriptionMatch = value.match(/<textarea id="vm-field-description"[^>]*>([\s\S]*?)<\/textarea>/);

    this.elements.set('#vm-form-cancel', new FakeElement({ id: 'vm-form-cancel' }));
    this.elements.set('#vm-form-cancel-bottom', new FakeElement({ id: 'vm-form-cancel-bottom' }));
    this.elements.set('#vm-field-id', new FakeElement({ id: 'vm-field-id', value: idMatch ? idMatch[1] : '' }));
    this.elements.set('#vm-field-name', new FakeElement({ id: 'vm-field-name', value: nameMatch ? nameMatch[1] : '' }));
    this.elements.set('#vm-field-description', new FakeElement({ id: 'vm-field-description', value: descriptionMatch ? descriptionMatch[1] : '' }));
    const strategyMatch = value.match(/id="vm-field-strategy"[\s\S]*?<option value="([^"]+)" selected>/);
    const stickyModeMatch = value.match(/id="vm-field-sticky-mode"[\s\S]*?<option value="([^"]+)" selected>/);
    const autoProtectionMatch = value.match(/id="vm-field-auto-protection-enabled"([^>]*)/);
    const failureThresholdMatch = value.match(/id="vm-field-failure-threshold" value="([^"]+)"/);
    const cooldownMatch = value.match(/id="vm-field-cooldown-ms" value="([^"]+)"/);
    this.elements.set('#vm-field-strategy', new FakeElement({ id: 'vm-field-strategy', value: strategyMatch ? strategyMatch[1] : 'priority' }));
    this.elements.set('#vm-field-sticky-mode', new FakeElement({ id: 'vm-field-sticky-mode', value: stickyModeMatch ? stickyModeMatch[1] : 'none' }));
    this.elements.set('#vm-field-auto-protection-enabled', new FakeElement({ id: 'vm-field-auto-protection-enabled', checked: /checked/.test(autoProtectionMatch ? autoProtectionMatch[1] : '') }));
    this.elements.set('#vm-field-failure-threshold', new FakeElement({ id: 'vm-field-failure-threshold', value: failureThresholdMatch ? failureThresholdMatch[1] : '3' }));
    this.elements.set('#vm-field-cooldown-ms', new FakeElement({ id: 'vm-field-cooldown-ms', value: cooldownMatch ? cooldownMatch[1] : '600000' }));
    this.elements.set('#vm-model-add-provider', providerSelect);
    this.elements.set('#vm-model-add-btn', new FakeElement({ id: 'vm-model-add-btn' }));
    this.elements.set('#vm-field-aliases', new FakeElement({ id: 'vm-field-aliases' }));
    this.elements.set('#vm-form-save', new FakeElement({ id: 'vm-form-save' }));
    const formStatus = new FakeElement({ id: 'vm-form-status' });
    const formStatusMatch = value.match(/id="vm-form-status"[^>]*>([\s\S]*?)<\/div>/);
    formStatus.textContent = formStatusMatch ? formStatusMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    this.elements.set('#vm-form-status', formStatus);
    const inlineGuidance = new FakeElement({ id: 'vm-inline-guidance' });
    const inlineGuidanceMatch = value.match(/id="vm-inline-guidance"[^>]*>([\s\S]*?)<\/div>/);
    inlineGuidance.textContent = inlineGuidanceMatch ? inlineGuidanceMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    this.elements.set('#vm-inline-guidance', inlineGuidance);
    const pickerEmpty = new FakeElement({ id: 'vm-model-picker-empty' });
    const pickerEmptyMatch = value.match(/id="vm-model-picker-empty"[^>]*>([\s\S]*?)<\/div>/);
    pickerEmpty.textContent = pickerEmptyMatch ? pickerEmptyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    this.elements.set('#vm-model-picker-empty', pickerEmpty);
    this.elements.set('#vm-form-feedback', new FakeElement({ id: 'vm-form-feedback' }));
    this.elements.set('#vm-model-list', this.modelList);
    this.elements.set('#vm-tag-list', this.tagList);
    this.elements.set('#vm-preview-btn', new FakeElement({ id: 'vm-preview-btn' }));
    this.elements.set('#vm-test-btn', new FakeElement({ id: 'vm-test-btn' }));
    this.elements.set('#vm-stats-btn', new FakeElement({ id: 'vm-stats-btn' }));
    this.elements.set('#vm-prune-btn', new FakeElement({ id: 'vm-prune-btn' }));
    this.elements.set('#vm-prune-confirm-btn', new FakeElement({ id: 'vm-prune-confirm-btn' }));
    this.elements.set('#vm-trace-btn', new FakeElement({ id: 'vm-trace-btn' }));
    this.elements.set('#vm-preview-panel', this.previewPanel);
    this.elements.set('#vm-stats-panel', this.statsPanel);
    this.elements.set('#vm-prune-panel', this.prunePanel);
    this.elements.set('#vm-trace-panel', this.tracePanel);
    this.elements.set('.vm-cap-checkbox', [chatCheckbox, visionCheckbox, fileCheckbox]);
    this.elements.set('.vm-cap-checkbox:checked', []);
    this.elements.set('.vm-tag-remove', []);
  }

  setCheckedCapabilities(values) {
    const checkboxes = this.elements.get('.vm-cap-checkbox') ?? [];
    const checked = [];
    for (const checkbox of checkboxes) {
      checkbox.checked = values.includes(checkbox.value);
      if (checkbox.checked) checked.push(checkbox);
    }
    this.elements.set('.vm-cap-checkbox:checked', checked);
  }

  querySelector(selector) {
    const value = this.elements.get(selector);
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  querySelectorAll(selector) {
    if (selector === '#vm-form-cancel, #vm-form-cancel-bottom') {
      return [this.querySelector('#vm-form-cancel'), this.querySelector('#vm-form-cancel-bottom')].filter(Boolean);
    }
    const value = this.elements.get(selector);
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }
}

const container = new FakeContainer();
const historyCalls = [];

globalThis.document = {
  getElementById(id) {
    if (id === 'virtual-models-content') return container;
    return container.querySelector(`#${id}`);
  },
  createElement() {
    return new FakeElement();
  },
};

globalThis.window = {
  location: { pathname: '/virtual-models' },
  history: {
    pushState(state, _title, path) {
      historyCalls.push({ method: 'pushState', state, path });
      globalThis.window.location.pathname = path;
    },
    replaceState(state, _title, path) {
      historyCalls.push({ method: 'replaceState', state, path });
      globalThis.window.location.pathname = path;
    },
  },
  confirm() {
    return true;
  },
};

const requests = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const state = {
  virtualModels: [],
  virtualModelsCandidates: [],
};

const { createVirtualModelsFeature } = await import('../src/web/app/features/virtual-models.js');

const feature = createVirtualModelsFeature({
  state,
  fetchJSON: async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/virtual-models') {
      if (options.method === 'POST') {
        const payload = JSON.parse(options.body);
        if (payload.autoAliases?.includes('custom-alias')) {
          throw new Error('Duplicate alias "custom-alias" already exists');
        }
        return payload;
      }
      return [
        {
          id: 'custom/router',
          name: 'Custom Router',
          description: 'Routes to healthy chat models',
          routingStrategy: 'round-robin',
          capabilities: ['chat'],
          autoProtection: { enabled: true, failureThreshold: 3, cooldownMs: 600000 },
          selectedModels: [
            { provider: 'groq', modelId: 'llama-3.3-70b', priority: 2, enabled: true, weight: 60, fallbackOnly: false, capabilities: ['chat', 'vision'] },
            { provider: 'openrouter', modelId: 'llama-4-scout', priority: 3, enabled: true, weight: 40, fallbackOnly: false, capabilities: ['chat'], memberState: { consecutiveFailures: 3, autoDisabledUntil: 1893456000000 } },
          ],
          autoAliases: ['custom-alias'],
          isBuiltin: false,
        },
        {
          id: 'builtin/router',
          name: 'Built-in Router',
          description: 'Protected source router',
          routingStrategy: 'priority',
          capabilities: ['chat'],
          selectedModels: [
            { provider: 'groq', modelId: 'llama-3.3-70b', priority: 1, enabled: true, weight: 100, fallbackOnly: false, capabilities: ['chat', 'vision'] },
          ],
          autoAliases: ['builtin-alias'],
          isBuiltin: true,
        },
      ];
    }
    if (url === '/api/virtual-models/templates') {
      return [
        {
          id: 'chat-failover',
          name: 'Chat Failover',
          description: 'Priority failover for chat providers',
          routingStrategy: 'priority',
          capabilities: ['chat'],
          selectedModels: [
            { provider: 'groq', modelId: 'llama-3.3-70b', priority: 1, enabled: true, weight: 1, fallbackOnly: false, capabilities: ['chat', 'vision'] },
            { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: true, weight: 1, fallbackOnly: true, capabilities: ['chat'] },
          ],
          stickyMode: 'none',
          autoProtection: { enabled: true, failureThreshold: 3, cooldownMs: 600000 },
        },
        {
          id: 'weighted-cheap-pool',
          name: 'Weighted Cheap Pool',
          description: 'Random weighted pool',
          routingStrategy: 'random',
          capabilities: ['chat'],
          selectedModels: [
            { provider: 'groq', modelId: 'llama-3.3-70b', priority: 1, enabled: true, weight: 70, fallbackOnly: false, capabilities: ['chat', 'vision'] },
            { provider: 'openrouter', modelId: 'llama-4-scout', priority: 2, enabled: true, weight: 30, fallbackOnly: false, capabilities: ['chat'] },
          ],
          stickyMode: 'request-key',
          autoProtection: { enabled: true, failureThreshold: 3, cooldownMs: 600000 },
        },
      ];
    }
    if (url === '/api/virtual-models/candidates') {
      return [
        {
          provider: 'groq',
          models: [{ id: 'llama-3.3-70b', providerModelId: 'groq/llama-3.3-70b', capabilities: ['chat', 'vision'] }],
        },
        {
          provider: 'openrouter',
          models: [{ id: 'llama-4-scout', providerModelId: 'meta-llama/llama-4-scout:free', capabilities: ['chat'] }],
        },
      ];
    }
    if (url === '/api/virtual-models/preview' && options.method === 'POST') {
      return {
        strategy: 'round-robin',
        requestedCapabilities: ['chat'],
        eligibleModels: [
          { provider: 'openrouter', modelId: 'llama-4-scout', priority: 1, healthy: true },
          { provider: 'groq', modelId: 'llama-3.3-70b', priority: 2, healthy: false, reason: 'fallback_only', fallbackOnly: true },
        ],
        explanation: ['Suggested route: openrouter/llama-4-scout (round-robin).'],
        suggestedRoute: { provider: 'openrouter', modelId: 'llama-4-scout' },
      };
    }
    if (url === '/api/virtual-models/test' && options.method === 'POST') {
      return {
        dryRun: true,
        selectedRoute: { provider: 'openrouter', modelId: 'llama-4-scout' },
        preview: {
          strategy: 'round-robin',
          requestedCapabilities: ['chat'],
          eligibleModels: [
            { provider: 'openrouter', modelId: 'llama-4-scout', priority: 1, healthy: true },
            { provider: 'groq', modelId: 'llama-3.3-70b', priority: 2, healthy: false, reason: 'fallback_only', fallbackOnly: true },
          ],
          explanation: ['Suggested route: openrouter/llama-4-scout (round-robin).'],
          suggestedRoute: { provider: 'openrouter', modelId: 'llama-4-scout' },
        },
      };
    }
    if (url === '/api/virtual-models/custom%2Frouter/stats') {
      return {
        id: 'custom/router',
        totalRequests: 7,
        lastUsedAt: 1721000000000,
        activeMembers: 1,
        cooldownMembers: 1,
        manuallyDisabledMembers: 0,
        routeHits: [
          { provider: 'openrouter', modelId: 'llama-4-scout', count: 5 },
          { provider: 'groq', modelId: 'llama-3.3-70b', count: 2 },
        ],
        routeFailures: [
          { provider: 'groq', modelId: 'llama-3.3-70b', count: 1 },
        ],
        currentlyExcluded: [
          { provider: 'openrouter', modelId: 'llama-4-scout', reason: 'auto_disabled_cooldown' },
        ],
      };
    }
    if (url === '/api/virtual-models/custom%2Frouter/trace?limit=10') {
      return {
        traces: [
          {
            id: 'trace-1',
            virtualModelId: 'custom/router',
            outcome: 'success',
            createdAt: 1721000000100,
            strategy: 'round-robin',
            finalRoute: { provider: 'openrouter', modelId: 'llama-4-scout' },
            excludedCandidates: [
              { provider: 'groq', modelId: 'llama-3.3-70b', reason: 'disabled' },
            ],
            attempts: [
              { provider: 'openrouter', modelId: 'llama-4-scout', outcome: 'failed', order: 1, phase: 'primary' },
              { provider: 'groq', modelId: 'llama-3.3-70b', outcome: 'success', order: 2, phase: 'fallback', fallbackOnly: true },
            ],
          },
        ],
      };
    }
    if (url === '/api/virtual-models/custom%2Frouter/trace/trace-1') {
      return {
        id: 'trace-1',
        virtualModelId: 'custom/router',
        outcome: 'success',
        createdAt: 1721000000100,
        strategy: 'round-robin',
        finalRoute: { provider: 'openrouter', modelId: 'llama-4-scout' },
        excludedCandidates: [
          { provider: 'groq', modelId: 'llama-3.3-70b', reason: 'disabled' },
        ],
        attempts: [
          { provider: 'openrouter', modelId: 'llama-4-scout', outcome: 'failed', order: 1, phase: 'primary' },
          { provider: 'groq', modelId: 'llama-3.3-70b', outcome: 'success', order: 2, phase: 'fallback', fallbackOnly: true },
        ],
      };
    }
    if (url === '/api/virtual-models/custom%2Frouter/prune-unhealthy' && options.method === 'POST') {
      const payload = options.body ? JSON.parse(options.body) : {};
      if (payload.apply === true) {
        return {
          id: 'custom/router',
          applied: true,
          removed: [
            { provider: 'groq', modelId: 'llama-3.3-70b', reason: 'provider_unhealthy' },
          ],
          kept: [
            { provider: 'openrouter', modelId: 'llama-4-scout' },
          ],
          updatedModel: {
            id: 'custom/router',
            name: 'Custom Router',
            description: 'Routes to healthy chat models',
            routingStrategy: 'round-robin',
            capabilities: ['chat'],
            selectedModels: [
              { provider: 'openrouter', modelId: 'llama-4-scout', priority: 1, enabled: true, weight: 40, fallbackOnly: false, capabilities: ['chat'] },
            ],
            autoAliases: ['custom-alias'],
            isBuiltin: false,
          },
        };
      }
      return {
        id: 'custom/router',
        applied: false,
        removed: [
          { provider: 'groq', modelId: 'llama-3.3-70b', reason: 'provider_unhealthy' },
        ],
        kept: [
          { provider: 'openrouter', modelId: 'llama-4-scout' },
        ],
      };
    }
    if (url === '/api/virtual-models/custom%2Frouter' && options.method === 'PUT') {
      const payload = JSON.parse(options.body);
      if (payload.autoAliases?.includes('custom-alias')) { throw new Error('Duplicate alias "custom-alias" already exists'); }
      return payload;
    }
    return { ok: true };
  },
  escapeHtml,
  activateTab() {},
});

await feature.loadVirtualModels();

assert.match(container.innerHTML, /custom-alias/, 'expected aliases from API response to render in the table');
assert.match(container.innerHTML, />2</, 'expected selected model count from API response to render in the table');
assert.match(container.innerHTML, /Create From Template/i, 'expected template create affordance in toolbar');
assert.equal(container.querySelectorAll('[data-vm-clone]').length, 2, 'expected clone button for normal and built-in models');

assert.equal(window.location.pathname, '/virtual-models');
container.querySelector('#vm-create-btn')?.click();
assert.equal(window.location.pathname, '/virtual-models/new');
assert.equal(historyCalls.at(-1)?.method, 'pushState');
container.querySelector('#vm-form-cancel')?.click();
assert.equal(window.location.pathname, '/virtual-models');
assert.equal(historyCalls.at(-1)?.method, 'pushState');

await feature.loadVirtualModels();
container.querySelectorAll('[data-vm-edit]')[0]?.click();
assert.equal(window.location.pathname, '/virtual-models/edit/custom%2Frouter');
assert.equal(historyCalls.at(-1)?.method, 'pushState');
container.querySelector('#vm-form-cancel')?.click();

window.location.pathname = '/virtual-models/edit/custom%2Frouter';
await feature.loadVirtualModels();
assert.equal(container.querySelector('#vm-field-id').value, 'custom/router');
container.querySelector('#vm-form-cancel')?.click();

window.location.pathname = '/virtual-models/new';
await feature.loadVirtualModels();
assert.match(container.innerHTML, /Create Virtual Model/);
container.querySelector('#vm-form-cancel')?.click();

window.location.pathname = '/virtual-models/edit/missing%2Fmodel';
await feature.loadVirtualModels();
assert.equal(container.mode, 'table');
assert.equal(window.location.pathname, '/virtual-models');
assert.equal(historyCalls.at(-1)?.method, 'replaceState');

window.location.pathname = '/virtual-models/edit/builtin%2Frouter';
await feature.loadVirtualModels();
assert.equal(container.mode, 'table');
assert.equal(window.location.pathname, '/virtual-models');
assert.equal(historyCalls.at(-1)?.method, 'replaceState');

const templateButton = container.querySelector('#vm-create-template-btn');
assert(templateButton, 'expected create-from-template button');
const templateSelect = container.querySelector('#vm-template-select');
assert(templateSelect, 'expected template picker');
templateSelect.value = 'weighted-cheap-pool';
templateButton.click();

assert.equal(container.querySelector('#vm-field-name').value, 'Weighted Cheap Pool');
assert.equal(container.querySelector('#vm-field-strategy').value, 'random');
const autoProtectionEnabled = container.querySelector('#vm-field-auto-protection-enabled');
assert(autoProtectionEnabled, 'expected auto protection toggle in template form');
assert.equal(autoProtectionEnabled.checked, true);
assert.equal(container.querySelector('#vm-field-failure-threshold').value, '3');
assert.equal(container.querySelector('#vm-field-cooldown-ms').value, '600000');
assert.equal(container.querySelector('#vm-model-list').querySelectorAll('.vm-btn-remove').length, 2, 'expected template draft to prefill selected models');
assert.match(container.querySelector('#vm-model-list').innerHTML, /Fallback only/i);
assert.match(container.querySelector('#vm-model-list').innerHTML, /Weight/i);
const stickyModeField = container.querySelector('#vm-field-sticky-mode');
assert(stickyModeField, 'expected sticky mode field in template form');
assert.equal(stickyModeField.value, 'request-key');
container.querySelector('#vm-form-cancel')?.click();

await feature.loadVirtualModels();
const cloneButton = container.querySelectorAll('[data-vm-clone]')[0];
assert(cloneButton, 'expected clone button for existing virtual model');
cloneButton.click();

assert.equal(container.querySelector('#vm-field-id').value, '', 'expected clone draft id to be empty');
assert.equal(container.querySelector('#vm-field-name').value, 'Custom Router Copy');
assert.equal(container.querySelector('#vm-field-description').value, 'Routes to healthy chat models');
assert.equal(container.querySelector('#vm-model-list').querySelectorAll('.vm-btn-remove').length, 2, 'expected cloned model list to copy selected models');
assert.match(container.querySelector('#vm-form-status').textContent, /New draft/i);

container.querySelector('#vm-field-id').value = 'custom/router-copy';
container.setCheckedCapabilities(['chat']);
container.querySelector('#vm-form-save')?.click();
await Promise.resolve();
await Promise.resolve();
assert.equal(window.location.pathname, '/virtual-models');
assert.equal(historyCalls.at(-1)?.method, 'replaceState');

const cloneCreateRequest = requests.find((entry) => entry.url === '/api/virtual-models' && entry.options.method === 'POST');
assert(cloneCreateRequest, 'expected clone save to POST create endpoint');
const clonePayload = JSON.parse(cloneCreateRequest.options.body);
assert.equal(clonePayload.id, 'custom/router-copy');
assert.equal(clonePayload.name, 'Custom Router Copy');
assert.deepEqual(clonePayload.autoAliases, []);
assert.equal(clonePayload.selectedModels.length, 2);
assert.equal(clonePayload.selectedModels[0].provider, 'groq');
assert.equal(clonePayload.selectedModels[1].memberState.consecutiveFailures, 3);
assert.deepEqual(clonePayload.autoProtection, { enabled: true, failureThreshold: 3, cooldownMs: 600000 });

await feature.loadVirtualModels();
const editButton = container.querySelectorAll('[data-vm-edit]')[0];
assert(editButton, 'expected edit button for existing virtual model');
editButton.click();

container.querySelector('#vm-field-name').value = 'Custom Router';
container.querySelector('#vm-field-description').value = 'Routes to healthy chat models';
container.querySelector('#vm-field-strategy').value = 'round-robin';
container.setCheckedCapabilities(['chat']);
const modelList = container.querySelector('#vm-model-list');
assert(modelList, 'expected model list in edit form');
assert.match(modelList.innerHTML, /Enabled/i);
assert.match(modelList.innerHTML, /Weight/i);
assert.match(modelList.innerHTML, /Fallback only/i);
assert.match(modelList.innerHTML, /vision/i);
assert.match(modelList.innerHTML, /Cooldown/i);
assert.match(modelList.innerHTML, /3 consecutive failures/i);
assert.match(modelList.innerHTML, /Primary route/i);
assert.match(container.querySelector('#vm-form-status').textContent, /Saved model/i);
assert.match(container.querySelector('#vm-inline-guidance').textContent, /Fallback members are used only as backup routes/i);
const stickyModeInput = container.querySelector('#vm-field-sticky-mode');
assert(stickyModeInput, 'expected sticky mode control in edit form');
stickyModeInput.value = 'request-key';
stickyModeInput.dispatch('change');
const autoProtectionToggle = container.querySelector('#vm-field-auto-protection-enabled');
assert(autoProtectionToggle, 'expected auto protection control in edit form');
autoProtectionToggle.checked = true;
const failureThresholdInput = container.querySelector('#vm-field-failure-threshold');
const cooldownInput = container.querySelector('#vm-field-cooldown-ms');
assert(failureThresholdInput && cooldownInput, 'expected auto protection numeric controls');
failureThresholdInput.value = '5';
cooldownInput.value = '120000';

const moveDownButtons = modelList.querySelectorAll('.vm-btn-move-down');
assert.equal(moveDownButtons.length, 2, 'expected move down controls for selected models');
moveDownButtons[0].click();

const enabledInputs = modelList.querySelectorAll('.vm-model-enabled-input');
assert.equal(enabledInputs.length, 2, 'expected enabled toggles for selected models');
enabledInputs[1].checked = false;
enabledInputs[1].dispatch('change');

const weightInputs = modelList.querySelectorAll('.vm-model-weight-input');
assert.equal(weightInputs.length, 2, 'expected weight inputs for selected models');
weightInputs[0].value = '55';
weightInputs[0].dispatch('change');
weightInputs[1].value = '45';
weightInputs[1].dispatch('change');

const fallbackInputs = modelList.querySelectorAll('.vm-model-fallback-input');
assert.equal(fallbackInputs.length, 2, 'expected fallback toggles for selected models');
fallbackInputs[1].checked = true;
fallbackInputs[1].dispatch('change');

container.querySelector('#vm-preview-btn')?.click();
await Promise.resolve();
await Promise.resolve();
assert.match(container.innerHTML, /Operational controls/i);
assert.match(container.innerHTML, /Observability/i);
assert.match(container.innerHTML, /Member pool/i);
assert.match(container.innerHTML, /Routing behavior/i);
assert.match(container.querySelector('#vm-model-list').innerHTML, /vm-member-state-chip/i);
assert.match(container.querySelector('#vm-model-list').innerHTML, /Cooldown/i);
assert.match(container.querySelector('#vm-model-list').innerHTML, /Primary route/i);
assert.match(container.querySelector('#vm-model-list').innerHTML, /Fallback route/i);

const previewPanel = container.querySelector('#vm-preview-panel');
assert(previewPanel, 'expected preview panel in edit form');
container.querySelector('#vm-preview-btn')?.click();
await Promise.resolve();
await Promise.resolve();
assert.match(previewPanel.innerHTML, /Final chosen route/i);
assert.match(previewPanel.innerHTML, /Excluded candidates/i);
assert.match(previewPanel.innerHTML, /Why this route/i);
assert.match(container.querySelector('#vm-form-status').textContent, /Preview current/i);
assert.match(previewPanel.innerHTML, /Draft validation current/i);
container.querySelector('#vm-field-description').value = 'Routes to healthy chat models with stale preview';
container.querySelector('#vm-field-description').dispatch('change');
assert.match(container.querySelector('#vm-form-status').textContent, /Preview is stale/i);
assert.match(previewPanel.innerHTML, /Draft changed after validation/i);

container.querySelector('#vm-test-btn')?.click();
await Promise.resolve();
await Promise.resolve();
assert.match(previewPanel.innerHTML, /Dry run result/i);
assert.match(previewPanel.innerHTML, /openrouter\/llama-4-scout/i);
assert.match(previewPanel.innerHTML, /Final chosen route/i);

container.querySelector('#vm-stats-btn')?.click();
await Promise.resolve();
await Promise.resolve();
const statsPanel = container.querySelector('#vm-stats-panel');
assert(statsPanel, 'expected stats panel in edit form');
assert.match(statsPanel.innerHTML, /Saved model snapshot/i);
assert.match(statsPanel.innerHTML, /Requests/i);
assert.match(statsPanel.innerHTML, /7/i);
assert.match(statsPanel.innerHTML, /Top route/i);
assert.match(statsPanel.innerHTML, /openrouter\/llama-4-scout/i);
assert.match(statsPanel.innerHTML, /Cooldown members/i);
assert.match(statsPanel.innerHTML, /Excluded members/i);
assert.match(statsPanel.innerHTML, /auto_disabled_cooldown/i);

container.querySelector('#vm-prune-btn')?.click();
await Promise.resolve();
await Promise.resolve();
const prunePanel = container.querySelector('#vm-prune-panel');
assert(prunePanel, 'expected prune panel in edit form');
assert.match(prunePanel.innerHTML, /Saved model change/i);
assert.match(prunePanel.innerHTML, /Review prune impact/i);
assert.match(prunePanel.innerHTML, /groq\/llama-3.3-70b/i);
assert.match(prunePanel.innerHTML, /provider_unhealthy/i);

container.querySelector('#vm-trace-btn')?.click();
await Promise.resolve();
await Promise.resolve();
const tracePanel = container.querySelector('#vm-trace-panel');
assert(tracePanel, 'expected trace panel in edit form');
assert.match(tracePanel.innerHTML, /Recent route traces/i);
assert.match(tracePanel.innerHTML, /Final chosen route/i);
assert.match(tracePanel.innerHTML, /trace-1/i);
assert.match(tracePanel.innerHTML, /openrouter\/llama-4-scout/i);
assert.match(tracePanel.innerHTML, /Excluded candidates/i);
assert.match(tracePanel.innerHTML, /Fallback path was used after the primary pass/i);
assert.match(tracePanel.innerHTML, /Fallback path/i);

container.querySelector('#vm-prune-confirm-btn')?.click();
await Promise.resolve();
await Promise.resolve();
assert.equal(container.querySelector('#vm-model-list').querySelectorAll('.vm-btn-remove').length, 1, 'expected selected model list to shrink after prune apply');

container.querySelector('#vm-field-aliases').value = 'custom-alias';
container.querySelector('#vm-field-aliases').dispatch('keydown', { key: 'Enter' });
container.querySelector('#vm-form-save')?.click();
await Promise.resolve();
await Promise.resolve();
assert.match(container.querySelector('#vm-form-feedback').textContent, /Duplicate alias/i);

const previewRequest = requests.find((entry) => entry.url === '/api/virtual-models/preview' && entry.options.method === 'POST');
assert(previewRequest, 'expected preview action to POST the preview endpoint');
const previewPayload = JSON.parse(previewRequest.options.body);
assert.equal(previewPayload.selectedModels[0].provider, 'openrouter');
assert.equal(previewPayload.selectedModels[0].priority, 1);
assert.equal(previewPayload.selectedModels[0].weight, 55);
assert.equal(previewPayload.selectedModels[0].enabled, true);
assert.equal(previewPayload.selectedModels[1].fallbackOnly, true);
assert.equal(previewPayload.stickyMode, 'request-key');
assert.deepEqual(previewPayload.autoProtection, {
  enabled: true,
  failureThreshold: 5,
  cooldownMs: 120000,
});

const templateRequest = requests.find((entry) => entry.url === '/api/virtual-models/templates');
assert(templateRequest, 'expected template list to be fetched');

const testRequest = requests.find((entry) => entry.url === '/api/virtual-models/test' && entry.options.method === 'POST');
assert(testRequest, 'expected test action to POST the test endpoint');

const statsRequest = requests.find((entry) => entry.url === '/api/virtual-models/custom%2Frouter/stats');
assert(statsRequest, 'expected stats action to GET the stats endpoint');

const traceRequest = requests.find((entry) => entry.url === '/api/virtual-models/custom%2Frouter/trace?limit=10');
assert(traceRequest, 'expected trace action to GET the trace endpoint');

const prunePreviewRequest = requests.find((entry) => entry.url === '/api/virtual-models/custom%2Frouter/prune-unhealthy' && entry.options.method === 'POST' && entry.options.body === JSON.stringify({}));
assert(prunePreviewRequest, 'expected prune preview to POST the prune endpoint without apply payload');

const pruneApplyRequest = requests.find((entry) => entry.url === '/api/virtual-models/custom%2Frouter/prune-unhealthy' && entry.options.method === 'POST' && entry.options.body === JSON.stringify({ apply: true }));
assert(pruneApplyRequest, 'expected prune confirm to POST the prune endpoint with apply payload');

const updateRequest = requests.find((entry) => entry.url === '/api/virtual-models/custom%2Frouter' && entry.options.method === 'PUT');
assert(updateRequest, 'expected edit save to PUT the virtual model');

await feature.loadVirtualModels();
container.querySelector('#vm-form-cancel')?.click();
state.virtualModelsCandidates = [];
container.querySelector('#vm-create-btn')?.click();
assert.match(container.querySelector('#vm-model-picker-empty').textContent, /No healthy candidates are available yet/i);

const payload = JSON.parse(updateRequest.options.body);
assert.equal(payload.selectedModels.length, 1);
assert.equal(payload.selectedModels[0].provider, 'openrouter');
assert.equal(payload.selectedModels[0].memberState.consecutiveFailures, 0);
assert.deepEqual(payload.autoProtection, { enabled: true, failureThreshold: 5, cooldownMs: 120000 });

console.log('frontend virtual models regression passed');








