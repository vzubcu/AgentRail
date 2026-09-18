import { createAttachmentQueueFeature, getTestAttachmentKind } from './attachments.js';
import { createThreadFeature } from './thread.js';
import { createRequestFeature } from './requests.js';

const TEST_PROVIDER_STATE_LABELS = {
  configured: 'Configured',
  healthy: 'Healthy',
  missing_key: 'Missing key',
  unhealthy: 'Unhealthy',
};

export function createTestConsoleFeature({
  state,
  withGatewayAuthHeaders,
  escapeHtml,
  formatBytes,
  getSortedProviderNames,
  formatNumber,
  reportStatus = () => {},
}) {
  function getActiveProviderNames() {
    return [...new Set(state.models
      .filter(model => (model.capabilities || []).includes('chat'))
      .flatMap(model => model.isVirtual
        ? ['agentrail']
        : (model.providers || []).map(provider => provider.name).filter(Boolean)))];
  }

  function getProviderStateLabel(stateKey) {
    return TEST_PROVIDER_STATE_LABELS[stateKey] || 'Unavailable';
  }

  function getProviderFilterOptions() {
    const activeProviderNames = new Set(getActiveProviderNames());
    const orderedNames = [...new Set([
      ...getSortedProviderNames(),
      ...state.providers.map(provider => provider.name),
      ...activeProviderNames,
    ])];

    return orderedNames.map(name => {
      const provider = state.providers.find(item => item.name === name);
      const stateKey = provider?.health?.state || (activeProviderNames.has(name) ? 'healthy' : 'configured');
      const selectable = activeProviderNames.has(name) && stateKey === 'healthy';

      return {
        value: name,
        label: selectable ? name : `${name} (${getProviderStateLabel(stateKey)})`,
        disabled: !selectable,
      };
    });
  }

  function renderProviderFilter() {
    const select = document.getElementById('test-provider-filter');
    if (!select) return;

    const previousValue = select.value || 'all';
    const options = [{ value: 'all', label: 'All providers', disabled: false }, ...getProviderFilterOptions()];
    select.innerHTML = options.map(option => {
      const disabledAttr = option.disabled ? ' disabled' : '';
      return `<option value="${escapeHtml(option.value)}"${disabledAttr}>${escapeHtml(option.label)}</option>`;
    }).join('');

    const validValues = new Set(options.filter(option => !option.disabled).map(option => option.value));
    select.value = validValues.has(previousValue) ? previousValue : 'all';
  }

  function renderModelOptions() {
    const providerFilter = document.getElementById('test-provider-filter')?.value || 'all';
    const select = document.getElementById('test-model');
    if (!select) return;

    const previousValue = select.value;
    const options = state.models
      .filter(model => (model.capabilities || []).includes('chat'))
      .filter(model => {
        if (providerFilter === 'all') return true;
        if (model.isVirtual) return providerFilter === 'agentrail';
        return model.providers.some(provider => provider.name === providerFilter);
      })
      .flatMap(model => {
        if (model.isVirtual) {
          return [{
            value: model.id,
            label: `agentrail / ${model.id}`,
          }];
        }
        return model.providers
          .filter(provider => providerFilter === 'all' || provider.name === providerFilter)
          .map(provider => ({
            value: `${provider.name}/${model.id}`,
            label: `${provider.name} / ${model.id}`,
          }));
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    select.innerHTML = options
      .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');

    if (options.some(option => option.value === previousValue)) {
      select.value = previousValue;
    }
  }

  const attachmentFeature = createAttachmentQueueFeature({
    state,
    escapeHtml,
    formatBytes,
  });

  const threadFeature = createThreadFeature({
    state,
    escapeHtml,
    formatBytes,
  });

  const requestFeature = createRequestFeature({
    state,
    withGatewayAuthHeaders,
    renderAttachmentQueue: attachmentFeature.renderAttachmentQueue,
    renderThread: threadFeature.renderThread,
    addErrorToTestThread: threadFeature.addErrorToTestThread,
    reportStatus,
  });

  function bind() {
    document.getElementById('test-provider-filter')?.addEventListener('change', renderModelOptions);
    document.getElementById('test-attachments')?.addEventListener('change', attachmentFeature.handleAttachmentSelection);
    document.getElementById('send-test')?.addEventListener('click', requestFeature.sendTestRequest);
    document.getElementById('test-clear-thread')?.addEventListener('click', () => {
      threadFeature.clearConversation();
      attachmentFeature.renderAttachmentQueue();
    });
    attachmentFeature.renderAttachmentQueue();
    threadFeature.renderThread();
  }

  return {
    bind,
    clearConversation: threadFeature.clearConversation,
    handleAttachmentSelection: attachmentFeature.handleAttachmentSelection,
    renderAttachmentQueue: attachmentFeature.renderAttachmentQueue,
    renderModelOptions,
    renderProviderFilter,
    renderThread: threadFeature.renderThread,
    sendTestRequest: requestFeature.sendTestRequest,
    getResponseText: requestFeature.getResponseText,
    addErrorToTestThread: threadFeature.addErrorToTestThread,
    getTestAttachmentKind,
  };
}
