import { createQuickConnectActions } from './actions.js';
import {
  getFilter,
  getFilterKey,
  getFilterOptions,
  getFilteredEntries,
  getQuickConnectModelEntries,
  syncSelection,
} from './state.js';

export function createQuickConnectFeature({
  state,
  fetchJSON,
  fetchJSONWithGatewayKey,
  getStoredGatewayKey,
  setStoredGatewayKey,
  escapeHtml,
  copyText,
  root = document,
}) {
  function renderAgentFilterControls() {
    const entries = getQuickConnectModelEntries(state);
    const options = getFilterOptions(entries);

    root.querySelectorAll('[data-agent-filter-target]').forEach(group => {
      const target = group.getAttribute('data-agent-filter-target');
      const role = group.getAttribute('data-agent-model-role') || 'setup';
      const current = getFilter(state, target, role);
      group.innerHTML = options.map(option => `
        <button
          class="quick-connect-filter-chip${option.kind === current ? ' active' : ''}"
          type="button"
          data-agent-filter-value="${escapeHtml(option.kind)}"
        >${escapeHtml(option.label)}</button>
      `).join('');

      group.querySelectorAll('[data-agent-filter-value]').forEach(button => {
        button.addEventListener('click', () => {
          const filter = button.getAttribute('data-agent-filter-value') || 'auto';
          state.quickConnectFilters[getFilterKey(target, role)] = filter;
          syncSelection(state, target, role, state.quickConnectSelections[getFilterKey(target, role)] || [], root);
          renderAgentModelSelectors();
        });
      });
    });
  }

  function renderAgentModelSelectors() {
    renderAgentFilterControls();

    root.querySelectorAll('[data-agent-model-target]').forEach(select => {
      const target = select.getAttribute('data-agent-model-target');
      const role = select.getAttribute('data-agent-model-role') || 'setup';
      const entries = getFilteredEntries(state, target, role);
      select.innerHTML = entries.length > 0
        ? entries.map(entry => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.id)}${entry.providers.length > 0 ? ` · ${escapeHtml(entry.providers.join(', '))}` : ''}</option>`).join('')
        : '<option value="">No active AgentRail models</option>';
      select.disabled = entries.length === 0;
      syncSelection(state, target, role, state.quickConnectSelections[getFilterKey(target, role)] || [], root);
    });
  }

  const actions = createQuickConnectActions({
    state,
    fetchJSON,
    fetchJSONWithGatewayKey,
    getStoredGatewayKey,
    setStoredGatewayKey,
    escapeHtml,
    copyText,
    renderAgentModelSelectors,
    root,
  });

  function bind() {
    root.querySelectorAll('[data-agent-model-target]').forEach(select => {
      select.addEventListener('change', () => {
        const target = select.getAttribute('data-agent-model-target');
        const role = select.getAttribute('data-agent-model-role') || 'setup';
        const values = Array.from(select.selectedOptions || []).map(option => option.value).filter(Boolean);
        state.quickConnectSelections[`${target}:${role}`] = role === 'launch' ? values.slice(0, 1) : values;
      });
    });

    root.querySelectorAll('[data-agent-configure]').forEach(button => {
      button.addEventListener('click', () => actions.configureAgentTool(button.getAttribute('data-agent-configure'), button.getAttribute('data-agent-result-id'), button));
    });
    root.querySelectorAll('[data-agent-launch]').forEach(button => {
      button.addEventListener('click', () => actions.launchAgentToolFromDashboard(button.getAttribute('data-agent-launch'), button.getAttribute('data-agent-result-id'), button));
    });
    root.querySelectorAll('[data-agent-guide]').forEach(button => {
      button.addEventListener('click', () => actions.showAgentGuide(button.getAttribute('data-agent-guide'), button.getAttribute('data-agent-result-id')));
    });
  }

  return {
    bind,
    renderAgentModelSelectors,
    configureAgentTool: actions.configureAgentTool,
    launchAgentToolFromDashboard: actions.launchAgentToolFromDashboard,
    showAgentGuide: actions.showAgentGuide,
  };
}
