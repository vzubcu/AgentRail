import { getEnvVarSummary, getProviderKeySummary } from '../lib/utils.js';
import { toStatusEvent } from '../lib/request-status.js';

function renderInstructionStep(step, escapeHtml) {
  const value = String(step ?? '');
  const urlPattern = /(https?:\/\/[^\s]+?)([.,!?])?(?=\s|$)/g;
  let cursor = 0;
  let html = '';

  for (const match of value.matchAll(urlPattern)) {
    const [fullMatch, url, trailingPunctuation = ''] = match;
    const matchIndex = match.index ?? 0;
    html += escapeHtml(value.slice(cursor, matchIndex));
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>${escapeHtml(trailingPunctuation)}`;
    cursor = matchIndex + fullMatch.length;
  }

  html += escapeHtml(value.slice(cursor));
  return `<li>${html}</li>`;
}

function renderInstructionItems(instructions = [], escapeHtml) {
  return instructions.map(step => renderInstructionStep(step, escapeHtml)).join('');
}

export function createKeysFeature({
  state,
  fetchJSON,
  fetchJSONWithGatewayKey,
  getStoredGatewayKey,
  setStoredGatewayKey,
  isCloudflareProvider,
  escapeHtml,
  loadCatalog,
  reportStatus = () => {},
}) {
  async function loadKeySummaries() {
    try {
      const data = await fetchJSON('/api/config/keys/summary');
      state.keySummaries = data.keys ?? {};
    } catch (error) {
      state.keySummaries = {};
      console.warn('Failed to load provider key summaries:', error.message);
    }
  }

  function openProviderKeyModal(providerName, envVar, mode = 'add') {
    const provider = state.providers.find(item => item.name === providerName);
    if (!provider) return;

    state.keyModalProviderName = providerName;
    state.keyModalEnvVar = envVar;
    state.keyModalMode = mode;
    const modal = document.getElementById('provider-key-modal');
    const title = document.getElementById('provider-key-modal-title');
    const label = document.querySelector('label[for="provider-key-modal-input"]');
    const input = document.getElementById('provider-key-modal-input');
    const secondaryGroup = document.getElementById('provider-key-modal-secondary-group');
    const secondaryLabel = document.querySelector('label[for="provider-key-modal-secondary-input"]');
    const secondaryInput = document.getElementById('provider-key-modal-secondary-input');
    const instructions = document.getElementById('provider-key-modal-instructions');
    const instructionsList = document.getElementById('provider-key-modal-instructions-list');
    const submitButton = modal.querySelector('button[type="submit"]');
    const isPrimaryKey = envVar === provider.apiKeyEnvVar;
    const isCloudflareCredential = isCloudflareProvider(provider) && isPrimaryKey && mode === 'add';
    title.textContent = mode === 'add'
      ? `Add ${isCloudflareCredential ? 'credential' : 'key'} for ${provider.name}`
      : `Set ${envVar} for ${provider.name}`;
    label.textContent = isPrimaryKey ? 'API key' : envVar;
    input.placeholder = isPrimaryKey ? 'Paste provider API key' : `Paste ${envVar}`;
    input.value = '';
    secondaryGroup.hidden = !isCloudflareCredential;
    secondaryLabel.textContent = 'Account ID';
    secondaryInput.placeholder = 'Paste Cloudflare account ID';
    secondaryInput.value = '';
    secondaryInput.required = isCloudflareCredential;
    if (instructions && instructionsList) {
      const providerInstructions = Array.isArray(provider.apiKeyInstructions) ? provider.apiKeyInstructions : [];
      const showInstructions = providerInstructions.length > 0 && isPrimaryKey;
      instructions.hidden = !showInstructions;
      if (showInstructions) {
        instructionsList.innerHTML = renderInstructionItems(providerInstructions, escapeHtml);
      } else {
        instructionsList.innerHTML = '';
      }
    }
    submitButton.textContent = mode === 'add'
      ? `Add ${isCloudflareCredential ? 'credential' : 'key'}`
      : 'Save value';
    modal.hidden = false;
    input.focus();
  }

  function closeProviderKeyModal() {
    state.keyModalProviderName = null;
    state.keyModalEnvVar = null;
    state.keyModalMode = 'add';
    document.getElementById('provider-key-modal-secondary-group').hidden = true;
    document.getElementById('provider-key-modal-secondary-input').value = '';
    document.getElementById('provider-key-modal-secondary-input').required = false;
    const instructions = document.getElementById('provider-key-modal-instructions');
    const instructionsList = document.getElementById('provider-key-modal-instructions-list');
    if (instructions) instructions.hidden = true;
    if (instructionsList) instructionsList.innerHTML = '';
    document.getElementById('provider-key-modal').hidden = true;
  }

  async function saveProviderEnvValue(envVar, value) {
    await fetchJSON('/api/config/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { [envVar]: value } }),
    });
  }

  async function clearProviderEnvValue(envVar) {
    await fetchJSON('/api/config/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { [envVar]: '' } }),
    });
    await loadKeySummaries();
    await loadCatalog();
  }

  async function deleteProviderKey(provider, fingerprint) {
    await fetchJSON(`/api/config/keys/${encodeURIComponent(provider.apiKeyEnvVar)}/${encodeURIComponent(fingerprint)}`, {
      method: 'DELETE',
    });
    await loadKeySummaries();
    await loadCatalog();
  }

  async function clearProviderKeys(provider) {
    await fetchJSON(`/api/config/keys/${encodeURIComponent(provider.apiKeyEnvVar)}`, {
      method: 'DELETE',
    });
    await loadKeySummaries();
    await loadCatalog();
  }

  async function addProviderKeyFromModal(event) {
    event.preventDefault();
    const provider = state.providers.find(item => item.name === state.keyModalProviderName);
    const envVar = state.keyModalEnvVar;
    const input = document.getElementById('provider-key-modal-input');
    const secondaryInput = document.getElementById('provider-key-modal-secondary-input');
    const value = input.value.trim();
    if (!provider || !envVar || !value) return;

    try {
      const isCloudflareCredential = isCloudflareProvider(provider) && envVar === provider.apiKeyEnvVar && state.keyModalMode === 'add';
      if (state.keyModalMode === 'add') {
        const accountId = isCloudflareCredential ? secondaryInput.value.trim() : '';
        if (isCloudflareCredential && !accountId) {
          reportStatus(toStatusEvent({ level: 'warning', message: 'Cloudflare account ID is required.' }));
          return;
        }
        const result = await fetchJSON(`/api/config/keys/${encodeURIComponent(envVar)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isCloudflareCredential ? { key: value, accountId } : { key: value }),
        });
        reportStatus(toStatusEvent({
          level: 'success',
          message: `Saved key for ${provider.name}.`,
          details: {
            provider: provider.name,
            envVar,
            keyFingerprint: result.fingerprints?.[0] ?? null,
            health: result.healthChecks?.[0]?.state ?? null,
          },
        }));
      } else {
        await saveProviderEnvValue(envVar, value);
        reportStatus(toStatusEvent({ level: 'success', message: `Saved ${envVar} for ${provider.name}.`, details: { provider: provider.name, envVar } }));
      }
      closeProviderKeyModal();
      await loadKeySummaries();
      await loadCatalog();
    } catch (error) {
      reportStatus(toStatusEvent(error));
    }
  }

  async function saveKeys() {
    const inputs = Array.from(document.querySelectorAll('#keys-form input, #keys-form textarea'));
    const keys = {};
    for (const input of inputs) {
      const value = input.value.trim();
      if (!value) continue;

      if (input.dataset.multiKey === 'true') {
        const keyValues = value
          .split(/\r?\n|,/)
          .map(item => item.trim())
          .filter(Boolean);
        if (keyValues.length > 0) {
          keys[input.dataset.envVar] = keyValues;
        }
      } else {
        keys[input.dataset.envVar] = value;
      }
    }

    const gatewayInput = document.getElementById('gateway-key');
    const gatewayKey = gatewayInput ? gatewayInput.value.trim() : '';

    const saveRequest = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, gatewayKey }),
    };

    let result;
    try {
      result = await fetchJSON('/api/config/keys', saveRequest);
    } catch (error) {
      const storedGatewayKey = getStoredGatewayKey();
      if (!gatewayKey || gatewayKey === storedGatewayKey || error.status !== 401) {
        throw error;
      }
      result = await fetchJSONWithGatewayKey('/api/config/keys', saveRequest, gatewayKey);
    }

    if (gatewayInput) {
      setStoredGatewayKey(gatewayKey);
    }

    reportStatus(toStatusEvent({
      level: 'success',
      message: `Saved ${result.updated.length} configuration value(s).`,
      details: {
        updated: result.updated?.join(', ') || 'none',
      },
    }));
    await loadCatalog();
    inputs.forEach(input => {
      input.value = '';
    });
  }

  function renderKeys() {
    const container = document.getElementById('keys-form');
    container.innerHTML = state.providers.map(provider => {
      const summary = getProviderKeySummary(state, provider);

      return `
        <div class="provider-key-section">
          <h4>${escapeHtml(provider.name)}</h4>
          <div class="provider-key-overview">
            <span>${summary.effectiveCount} active</span>
            <span>${summary.managedCount} managed</span>
            <span>${summary.environmentCount} env</span>
          </div>
          <button class="btn-secondary" type="button" data-manage-provider-keys="${escapeHtml(provider.name)}">Manage keys</button>
        </div>`;
    }).join('');
  }

  return {
    loadKeySummaries,
    openProviderKeyModal,
    closeProviderKeyModal,
    addProviderKeyFromModal,
    deleteProviderKey,
    clearProviderKeys,
    saveProviderEnvValue,
    clearProviderEnvValue,
    saveKeys,
    renderKeys,
    getProviderKeySummary: (provider) => getProviderKeySummary(state, provider),
    getEnvVarSummary: (envVar) => getEnvVarSummary(state, envVar),
  };
}
