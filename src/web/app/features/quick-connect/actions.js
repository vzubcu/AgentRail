import {
  getQuickConnectModelEntries,
  getRecommendedAgentModelId,
  getSelectedAgentModelIds,
  getStoredAgentProfileName,
} from './state.js';
import { buildGuide } from './targets.js';
import { renderGuideResult, renderLaunchSuccess, renderQuickConnectResult, renderSetupSuccess } from './render.js';

export function createQuickConnectActions({
  state,
  fetchJSON,
  fetchJSONWithGatewayKey,
  getStoredGatewayKey,
  setStoredGatewayKey,
  escapeHtml,
  copyText,
  renderAgentModelSelectors,
  root = document,
}) {
  async function configureAgentTool(target, resultId, button) {
    const gatewayInput = root.getElementById('gateway-key');
    const gatewayKey = gatewayInput ? gatewayInput.value.trim() : '';
    const previousText = button.textContent || 'Configure';
    button.disabled = true;
    button.textContent = 'Configuring...';

    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, modelIds: getSelectedAgentModelIds(state, target, 'setup', root) }),
    };

    try {
      let result;
      try {
        result = await fetchJSON('/api/agents/configure', request);
      } catch (error) {
        if (!gatewayKey || gatewayKey === getStoredGatewayKey()) {
          throw error;
        }
        result = await fetchJSONWithGatewayKey('/api/agents/configure', request, gatewayKey);
        setStoredGatewayKey(gatewayKey);
      }
      renderSetupSuccess({ state, resultId, result, escapeHtml, copyText, root });
      renderAgentModelSelectors();
    } catch (error) {
      renderQuickConnectResult(resultId, escapeHtml(error.message || 'Configuration failed.'), 'error', root);
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  function showAgentGuide(guideId, resultId) {
    const guide = buildGuide(guideId, state, window.location.origin);
    renderGuideResult({ resultId, guide, escapeHtml, copyText, root });
  }

  async function launchAgentToolFromDashboard(target, resultId, button) {
    const gatewayInput = root.getElementById('gateway-key');
    const gatewayKey = gatewayInput ? gatewayInput.value.trim() : '';
    const modelId = getSelectedAgentModelIds(state, target, 'launch', root)[0]
      || getRecommendedAgentModelId(getQuickConnectModelEntries(state));
    const profileName = getStoredAgentProfileName(state, target, modelId);
    const previousText = button.textContent || 'Launch';
    button.disabled = true;
    button.textContent = 'Launching...';

    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, modelId, profileName, gatewayKey }),
    };

    try {
      let result;
      try {
        result = await fetchJSON('/api/agents/launch', request);
      } catch (error) {
        if (!gatewayKey || gatewayKey === getStoredGatewayKey()) {
          throw error;
        }
        result = await fetchJSONWithGatewayKey('/api/agents/launch', request, gatewayKey);
        setStoredGatewayKey(gatewayKey);
      }
      renderLaunchSuccess({
        resultId,
        result,
        launchModel: result.env?.ANTHROPIC_MODEL || modelId,
        escapeHtml,
        copyText,
        root,
      });
    } catch (error) {
      renderQuickConnectResult(resultId, escapeHtml(error.message || 'Launch failed.'), 'error', root);
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  return {
    configureAgentTool,
    launchAgentToolFromDashboard,
    showAgentGuide,
  };
}
