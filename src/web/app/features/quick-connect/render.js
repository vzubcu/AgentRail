import { buildPowerShellEnvSnippet } from './state.js';

export function renderQuickConnectResult(resultId, content, tone, root = document) {
  const container = root.getElementById(resultId);
  if (!container) return;
  container.className = `quick-connect-result${tone === 'error' ? ' error' : tone === 'warning' ? ' warning' : ''}`;
  container.innerHTML = content;
}

function renderSettingsList(settings, escapeHtml) {
  const rows = settings.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (rows.length === 0) return '';
  return `
    <div class="quick-connect-result-block quick-connect-result-meta">
      ${rows.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> <code>${escapeHtml(value)}</code></div>`).join('')}
    </div>
  `;
}

function renderStepList(steps, escapeHtml) {
  if (!steps?.length) return '';
  return `
    <div class="quick-connect-result-block">
      <strong>Remaining steps</strong>
      <ul class="quick-connect-result-list">
        ${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderFileList(files, escapeHtml) {
  if (!files?.length) return '';
  return `
    <div class="quick-connect-result-block">
      <strong>Files</strong>
      <ul class="quick-connect-result-list quick-connect-result-files">
        ${files.map(file => `<li><code>${escapeHtml(file.kind)}</code> → <code>${escapeHtml(file.path)}</code></li>`).join('')}
      </ul>
    </div>
  `;
}

function renderMessages(messages, escapeHtml, tone) {
  if (!messages?.length) return '';
  return `
    <div class="quick-connect-result-block quick-connect-result-messages ${tone}">
      ${messages.map(message => `<div>${escapeHtml(message)}</div>`).join('')}
    </div>
  `;
}

function attachEnvCopyButton(buttonId, envSnippet, copyText, root = document) {
  if (!envSnippet) return;
  root.getElementById(buttonId)?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const previousText = button.textContent || 'Copy env';
    button.disabled = true;
    try {
      await copyText(envSnippet);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Retry';
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = previousText;
      }, 1400);
    }
  });
}

export function renderSetupSuccess({ state, resultId, result, escapeHtml, copyText, root = document }) {
  state.lastAgentResults[result.target] = result;
  const envSnippet = buildPowerShellEnvSnippet(result.env || {});
  const tone = result.ok ? ((result.warnings || []).length || (result.errors || []).length ? 'warning' : 'success') : 'error';
  const settings = [
    ['Mode', result.mode ? result.mode.charAt(0).toUpperCase() + result.mode.slice(1) : 'Guide'],
    ['Root path', result.rootPath],
    ['Written', String(result.written ?? 0)],
    ['Primary selection', result.primarySelection?.name],
    ['Default profile', result.defaultProfile],
    ['Provider config', result.providerConfig],
  ];

  if (Array.isArray(result.profiles) && result.profiles.length > 0) {
    settings.push(['Configured models', result.profiles.map(profile => profile.modelId).join(', ')]);
  } else if (result.primarySelection?.modelId) {
    settings.push(['Configured model', result.primarySelection.modelId]);
  }

  const copyButtonId = `${resultId}-copy-env`;
  const content = `
    <div class="quick-connect-result-mode-row">
      <span class="quick-connect-mode-badge ${escapeHtml(result.mode || 'guide')}">${escapeHtml(result.mode ? result.mode.charAt(0).toUpperCase() + result.mode.slice(1) : 'Guide')}</span>
    </div>
    ${renderSettingsList(settings, escapeHtml)}
    ${envSnippet ? `
      <div class="quick-connect-result-block">
        <div class="quick-connect-result-actions">
          <span>PowerShell runtime env</span>
          <button class="endpoint-copy-button" type="button" id="${escapeHtml(copyButtonId)}">Copy env</button>
        </div>
        <pre><code>${escapeHtml(envSnippet)}</code></pre>
      </div>
    ` : ''}
    ${renderStepList(result.steps || [], escapeHtml)}
    ${renderFileList(result.files || [], escapeHtml)}
    ${renderMessages(result.warnings || [], escapeHtml, 'warning')}
    ${renderMessages(result.errors || [], escapeHtml, 'error')}
  `;

  renderQuickConnectResult(resultId, content, tone, root);
  attachEnvCopyButton(copyButtonId, envSnippet, copyText, root);
}

export function renderGuideResult({ resultId, guide, escapeHtml, copyText, root = document }) {
  const envSnippet = buildPowerShellEnvSnippet(guide.env || {});
  const copyButtonId = `${resultId}-copy-env`;
  const content = `
    <div class="quick-connect-result-mode-row">
      <span class="quick-connect-mode-badge guide">Guide</span>
    </div>
    <div class="quick-connect-result-block">
      <strong>${escapeHtml(guide.title)}</strong>
    </div>
    ${renderSettingsList(guide.settings || [], escapeHtml)}
    ${envSnippet ? `
      <div class="quick-connect-result-block">
        <div class="quick-connect-result-actions">
          <span>PowerShell reference env</span>
          <button class="endpoint-copy-button" type="button" id="${escapeHtml(copyButtonId)}">Copy env</button>
        </div>
        <pre><code>${escapeHtml(envSnippet)}</code></pre>
      </div>
    ` : ''}
    ${renderStepList(guide.steps || [], escapeHtml)}
  `;

  renderQuickConnectResult(resultId, content, 'success', root);
  attachEnvCopyButton(copyButtonId, envSnippet, copyText, root);
}

export function renderLaunchSuccess({ resultId, result, launchModel, escapeHtml, copyText, root = document }) {
  const envSnippet = buildPowerShellEnvSnippet(result.env || {});
  const tone = result.ok ? ((result.warnings || []).length || (result.errors || []).length ? 'warning' : 'success') : 'error';
  const copyButtonId = `${resultId}-copy-launch-env`;
  const settings = [
    ['Launch status', result.launched ? 'Opened in PowerShell' : 'Prepared only'],
    ['Command', result.commandPreview],
    ['Profile', result.profileName],
    ['Launch model', launchModel],
  ];
  const content = `
    <div class="quick-connect-result-block">
      <strong>${escapeHtml(result.target === 'claude' ? 'Claude Code launch' : 'Codex launch')}</strong>
    </div>
    ${renderSettingsList(settings, escapeHtml)}
    ${envSnippet ? `
      <div class="quick-connect-result-block">
        <div class="quick-connect-result-actions">
          <span>PowerShell runtime env</span>
          <button class="endpoint-copy-button" type="button" id="${escapeHtml(copyButtonId)}">Copy env</button>
        </div>
        <pre><code>${escapeHtml(envSnippet)}</code></pre>
      </div>
    ` : ''}
    ${renderMessages(result.warnings || [], escapeHtml, 'warning')}
    ${renderMessages(result.errors || [], escapeHtml, 'error')}
  `;

  renderQuickConnectResult(resultId, content, tone, root);
  attachEnvCopyButton(copyButtonId, envSnippet, copyText, root);
}
