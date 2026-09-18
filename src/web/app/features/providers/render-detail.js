const OAUTH_PROVIDERS = new Set(['claude', 'codex', 'gemini']);

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

function renderInstructionList(instructions, escapeHtml) {
  if (!Array.isArray(instructions) || instructions.length === 0) return '';
  return `<div class="provider-key-note"><div>How to get this API key:</div><ol>${instructions.map((step) => renderInstructionStep(step, escapeHtml)).join('')}</ol></div>`;
}

function renderProviderFailureDetails(health, escapeHtml, formatTime) {
  const failureContext = health?.failureContext;
  if (!failureContext) return '';

  const attemptedKeys = Array.isArray(failureContext.attemptedKeyOrder) && failureContext.attemptedKeyOrder.length > 0
    ? failureContext.attemptedKeyOrder.join(', ')
    : '—';

  return `
    <section class="provider-detail-panel provider-error-panel">
      <div class="provider-detail-panel-header">
        <div>
          <h2>Last request error</h2>
          <p>${escapeHtml(health?.message || 'Provider request failed')}</p>
        </div>
        <span class="config-badge">${escapeHtml(health?.failureReason || 'error')}</span>
      </div>
      <div class="provider-error-details">
        <div class="provider-error-row"><span>Provider</span><code>${escapeHtml(failureContext.provider || '—')}</code></div>
        <div class="provider-error-row"><span>Env var</span><code>${escapeHtml(failureContext.envVar || '—')}</code></div>
        <div class="provider-error-row"><span>Failed key</span><code>${escapeHtml(failureContext.unhealthyKeyFingerprint || failureContext.keyFingerprint || '—')}</code></div>
        <div class="provider-error-row"><span>Checked at</span><code>${escapeHtml(formatTime(failureContext.checkedAt || null))}</code></div>
        <div class="provider-error-row"><span>Model</span><code>${escapeHtml(failureContext.modelId || '—')}</code></div>
        <div class="provider-error-row"><span>Status</span><code>${escapeHtml(failureContext.statusCode ?? '—')}</code></div>
        <div class="provider-error-row provider-error-row-wide"><span>Attempted keys</span><code>${escapeHtml(attemptedKeys)}</code></div>
        <div class="provider-error-row provider-error-row-wide"><span>Cause</span><code>${escapeHtml(failureContext.lastError || '—')}</code></div>
      </div>
    </section>
  `;
}

export function renderProviderDetailView({
  provider,
  state,
  keysFeature,
  getProviderHealthState,
  healthLabels,
  isCloudflareProvider,
  escapeHtml,
  getProviderInitials,
  formatTime,
  actions,
}) {
  const detail = document.getElementById('provider-detail-view');
  const keySummary = keysFeature.getProviderKeySummary(provider);
  const providerModels = state.models.filter(model => model.providers.some(p => p.name === provider.name));
  const stateKey = getProviderHealthState(provider);
  const statusText = healthLabels[stateKey] ?? stateKey;
  const isCloudflare = isCloudflareProvider(provider);
  const isOAuth = OAUTH_PROVIDERS.has(provider.name);
  const auxiliaryEnvVars = provider.envVars.filter(envVar => envVar !== provider.apiKeyEnvVar);

  const oauthStatus = state.oauthStatus?.[provider.name];
  const oauthConfigured = oauthStatus?.configured;
  const providerFailureDetails = renderProviderFailureDetails(provider.health, escapeHtml, formatTime);

  const oauthKeyRow = isOAuth ? `
    <div class="provider-key-row ${oauthConfigured ? 'configured' : 'missing'}">
      <div>
        <div class="provider-key-label">OAuth Connection</div>
        <code>${oauthConfigured ? escapeHtml(oauthStatus.tokenPreview) : 'Not connected'}</code>
      </div>
      <span class="provider-key-source">${oauthConfigured ? 'Connected' : 'Disconnected'}</span>
      ${oauthConfigured
        ? `<button class="btn-danger" type="button" data-oauth-disconnect="${escapeHtml(provider.name)}">Disconnect</button>`
        : ''}
    </div>` : '';

  const apiKeyRows = keySummary.keys.length
    ? keySummary.keys.map((key, index) => `
      <div class="provider-key-row ${key.source}">
        <div>
          <div class="provider-key-label">${isCloudflare ? 'Credential' : 'Key'} ${index + 1}</div>
          <code>${escapeHtml(key.preview)}</code>
          ${key.secondaryPreview ? `
            <div class="provider-key-meta">
              <span>${escapeHtml(key.secondaryLabel ?? 'Value')}</span>
              <code>${escapeHtml(key.secondaryPreview)}</code>
            </div>
          ` : ''}
        </div>
        <span class="provider-key-source">${key.source === 'environment' ? 'Environment' : 'Managed'}</span>
        ${key.source === 'managed'
          ? `<button class="btn-danger" type="button" data-delete-provider-key="${escapeHtml(key.fingerprint)}">Remove</button>`
          : '<span class="provider-key-readonly">Read-only</span>'}
      </div>
    `).join('')
    : `<div class="empty provider-key-empty">No ${isCloudflare ? 'credential sets' : 'keys'} configured for this provider.</div>`;

  const keyInstructions = !isCloudflare ? renderInstructionList(provider.apiKeyInstructions, escapeHtml) : '';

  const auxiliaryRows = isCloudflare
    ? '<div class="provider-key-note">Each managed Cloudflare entry keeps the API key and account ID together.</div>'
    : auxiliaryEnvVars.length
      ? auxiliaryEnvVars.map(envVar => {
        const summary = keysFeature.getEnvVarSummary(envVar);
        const activeValue = summary.keys[0];
        return `
          <div class="provider-aux-row ${summary.configured ? 'configured' : 'missing'}">
            <div class="provider-aux-main">
              <div class="provider-key-label">${escapeHtml(envVar)}</div>
              <div class="provider-aux-value">${summary.configured ? `<code>${escapeHtml(activeValue?.preview ?? 'Configured')}</code>` : 'Missing'}</div>
            </div>
            <div class="provider-aux-actions">
              <button class="btn-secondary" type="button" data-open-provider-env-modal="${escapeHtml(envVar)}">${summary.configured ? 'Update' : 'Set value'}</button>
              ${summary.managedCount > 0 ? `<button class="btn-danger" type="button" data-clear-provider-env="${escapeHtml(envVar)}">Clear</button>` : ''}
            </div>
          </div>`;
      }).join('')
      : isOAuth
        ? '<div class="provider-key-note">Configure API key or OAuth to use this provider.</div>'
        : '<div class="provider-key-note">No auxiliary provider settings.</div>';

  const oauthBtns = isOAuth ? `
    ${oauthConfigured
      ? `<button class="btn-secondary" type="button" data-oauth-reconnect="${escapeHtml(provider.name)}">Reconnect OAuth</button>
         <button class="btn-danger" type="button" data-oauth-disconnect="${escapeHtml(provider.name)}">Disconnect OAuth</button>`
      : `<button class="btn-primary" type="button" data-oauth-connect="${escapeHtml(provider.name)}">Connect with OAuth</button>`}
  ` : '';

  const keyBtns = isOAuth
    ? `<button class="btn-secondary" type="button" data-open-add-provider-key="${escapeHtml(provider.name)}">+ Add ${isCloudflare ? 'credential' : 'key'}</button>`
    : `<button class="btn-primary provider-add-key-btn" type="button" data-open-add-provider-key="${escapeHtml(provider.name)}">+ Add ${isCloudflare ? 'credential' : 'key'}</button>`;

  const clearKeysBtn = !isOAuth && keySummary.managedCount > 0
    ? `<button class="btn-danger" type="button" data-clear-provider-keys>Clear managed ${isCloudflare ? 'credentials' : 'keys'}</button>`
    : '';

  const oauthPanel = isOAuth ? `
    <section class="provider-detail-panel">
      <div class="provider-detail-panel-header">
        <div>
          <h2>OAuth Connection</h2>
          <p>${escapeHtml(provider.name)} OAuth token</p>
        </div>
        <span class="config-badge">${oauthConfigured ? 'Connected' : 'Not connected'}</span>
      </div>
      <div class="provider-key-list">${oauthKeyRow}</div>
    </section>
  ` : '';

  detail.innerHTML = `
    <div class="provider-detail-shell">
      <div class="provider-detail-header">
        <button class="btn-secondary" type="button" id="provider-detail-back">Back to providers</button>
        <div class="provider-detail-actions">
          <button class="btn-secondary" type="button" data-refresh-provider="${escapeHtml(provider.name)}">Refresh models</button>
          <button class="btn-secondary" type="button" data-test-provider="${escapeHtml(provider.name)}">Test route</button>
          ${clearKeysBtn}
          ${oauthBtns}
          ${keyBtns}
        </div>
      </div>

      <div class="provider-detail-hero provider-card ${stateKey}">
        <div class="route-provider-main">
          <div class="route-provider-icon ${stateKey}">${escapeHtml(getProviderInitials(provider.name))}</div>
          <div class="route-provider-title">
            <div class="route-provider-name">${escapeHtml(provider.name)}</div>
            <div class="route-provider-role">${escapeHtml(provider.baseURL)}</div>
          </div>
        </div>
        <span class="provider-status route-status ${stateKey}">${escapeHtml(statusText)}</span>
      </div>

      <div class="provider-detail-grid">
        ${oauthPanel}
        ${providerFailureDetails}

        <section class="provider-detail-panel">
          <div class="provider-detail-panel-header">
            <div>
              <h2>${isCloudflare ? 'Provider credentials' : 'Provider keys'}</h2>
              <p>${escapeHtml(isCloudflare ? 'CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID' : provider.apiKeyEnvVar)}</p>
            </div>
            <span class="config-badge">${keySummary.effectiveCount + ' active'}</span>
          </div>
          <div class="provider-key-list">${apiKeyRows}</div>
          ${keyInstructions}
        </section>

        <section class="provider-detail-panel">
          <div class="provider-detail-panel-header">
            <div><h2>Route context</h2><p>${providerModels.length} active models</p></div>
          </div>
          <div class="provider-detail-stats">
            <div><span>Managed ${isCloudflare ? 'entries' : 'keys'}</span><strong>${keySummary.managedCount}</strong></div>
            <div><span>Environment ${isCloudflare ? 'entries' : 'keys'}</span><strong>${keySummary.environmentCount}</strong></div>
            <div><span>Health</span><strong>${escapeHtml(statusText)}</strong></div>
          </div>
          <div class="route-detail-block route-config provider-detail-config">${auxiliaryRows}</div>
        </section>
      </div>
    </div>
  `;

  detail.querySelector('#provider-detail-back')?.addEventListener('click', () => actions.closeProviderDetail());
  detail.querySelector('[data-refresh-provider]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = 'Syncing...';
      await actions.refreshProviderCatalog(provider.name);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Refresh models';
    }
  });
  detail.querySelector('[data-test-provider]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = 'Testing...';
      await actions.runProviderHealthCheck(provider.name);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Test route';
    }
  });

  if (isOAuth) {
    detail.querySelector('[data-oauth-connect]')?.addEventListener('click', () => startOAuthFlow(provider.name, actions));
    detail.querySelector('[data-oauth-reconnect]')?.addEventListener('click', () => startOAuthFlow(provider.name, actions));
    detail.querySelectorAll('[data-oauth-disconnect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Disconnect ${provider.name} OAuth? This will remove the stored token.`)) return;
        try {
          await fetch('/api/oauth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: provider.name }),
          });
          await loadOAuthStatus(state, actions);
        } catch (error) {
          alert(error.message);
        }
      });
    });
  }
  detail.querySelector('[data-open-add-provider-key]')?.addEventListener('click', () => keysFeature.openProviderKeyModal(provider.name, provider.apiKeyEnvVar, 'add'));
  detail.querySelector('[data-clear-provider-keys]')?.addEventListener('click', async () => {
    if (!confirm(`Remove all managed ${isCloudflare ? 'credentials' : 'keys'} for this provider?`)) return;
    try { await keysFeature.clearProviderKeys(provider); } catch (error) { alert(error.message); }
  });
  detail.querySelectorAll('[data-delete-provider-key]').forEach(button => {
    button.addEventListener('click', async () => {
      const fingerprint = button.getAttribute('data-delete-provider-key');
      if (!fingerprint || !confirm(`Remove this managed provider ${isCloudflare ? 'credential set' : 'key'}?`)) return;
      try { await keysFeature.deleteProviderKey(provider, fingerprint); } catch (error) { alert(error.message); }
    });
  });
  detail.querySelectorAll('[data-open-provider-env-modal]').forEach(button => {
    button.addEventListener('click', () => {
      const envVar = button.getAttribute('data-open-provider-env-modal');
      if (envVar) keysFeature.openProviderKeyModal(provider.name, envVar, 'set');
    });
  });
  detail.querySelectorAll('[data-clear-provider-env]').forEach(button => {
    button.addEventListener('click', async () => {
      const envVar = button.getAttribute('data-clear-provider-env');
      if (!envVar || !confirm(`Clear ${envVar} for this provider?`)) return;
      try { await keysFeature.clearProviderEnvValue(envVar); } catch (error) { alert(error.message); }
    });
  });
}

async function startOAuthFlow(provider, actions) {
  try {
    const resp = await fetch('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || 'Failed to start OAuth');

    const statusEl = document.querySelector('[data-oauth-connect]') || document.querySelector('[data-oauth-reconnect]');
    if (statusEl) {
      statusEl.textContent = 'Waiting for authorization...';
      statusEl.disabled = true;
    }

    if (data.deviceFlow) {
      return startDeviceFlow(provider, data, actions, statusEl);
    }

    const popup = window.open(data.url, 'oauth_' + provider, 'width=600,height=700');
    if (!popup) {
      alert('Popup blocked. Please allow popups for this site, or copy the URL manually:\n\n' + data.url);
      return;
    }

    let attempts = 0;
    const maxAttempts = 120;
    const pollInterval = 2000;

    const poll = setInterval(async () => {
      attempts++;
      try {
        const statusResp = await fetch('/api/oauth/status');
        const statusData = await statusResp.json();
        state.oauthStatus = statusData.providers || {};

        if (statusData.providers?.[provider]?.configured) {
          clearInterval(poll);
          if (statusEl) {
            statusEl.textContent = 'Connected!';
            statusEl.disabled = false;
          }
          setTimeout(() => popup.close(), 500);
          await actions.loadCatalog();
          setTimeout(() => window.location.reload(), 1000);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(poll);
          if (statusEl) {
            statusEl.textContent = 'Timed out. Try again.';
            statusEl.disabled = false;
          }
          alert('OAuth timed out. Please try again and complete the authorization in the popup window.');
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          if (statusEl) {
            statusEl.textContent = 'Connect with OAuth';
            statusEl.disabled = false;
          }
        }
      }
    }, pollInterval);
  } catch (error) {
    alert(error.message);
  }
}

async function startDeviceFlow(provider, data, actions, statusEl) {
  const codeEl = document.createElement('div');
  codeEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a2e;border:1px solid #444;border-radius:12px;padding:32px;z-index:1000;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:480px;';
  codeEl.innerHTML = `
    <h3 style="margin:0 0 8px;color:#fff;">Authorize Codex</h3>
    <p style="margin:0 0 16px;color:#aaa;font-size:14px;">Enter this code at the verification page:</p>
    <div style="font-size:36px;font-weight:bold;letter-spacing:6px;background:#0d0d1a;padding:16px 24px;border-radius:8px;margin:0 0 20px;color:#4fc3f7;font-family:monospace;">${data.userCode}</div>
    <button id="device-open-url" class="btn-primary" style="width:100%;margin-bottom:8px;">Open verification page</button>
    <button id="device-close" class="btn-secondary" style="width:100%;">Cancel</button>
  `;
  document.body.appendChild(codeEl);

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:999;';
  document.body.appendChild(backdrop);

  let popup = null;
  document.getElementById('device-open-url').addEventListener('click', () => {
    popup = window.open(data.verificationUri, 'oauth_codex', 'width=600,height=700');
    if (!popup) {
      alert('Popup blocked. Please open this URL manually:\n\n' + data.verificationUri);
    }
  });

  document.getElementById('device-close').addEventListener('click', () => {
    cleanup();
    if (statusEl) {
      statusEl.textContent = 'Connect with OAuth';
      statusEl.disabled = false;
    }
  });

  function cleanup() {
    codeEl.remove();
    backdrop.remove();
    clearInterval(poll);
  }

  let attempts = 0;
  const maxAttempts = 180;
  const pollInterval = 3000;

  const poll = setInterval(async () => {
    attempts++;
    try {
      const pollResp = await fetch('/api/oauth/poll-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.state }),
      });
      const pollData = await pollResp.json();

      if (pollData.error) {
        clearInterval(poll);
        cleanup();
        if (statusEl) {
          statusEl.textContent = 'Connect with OAuth';
          statusEl.disabled = false;
        }
        alert(pollData.error.message || 'Device flow failed');
        return;
      }

      if (pollData.done) {
        clearInterval(poll);
        cleanup();
        if (statusEl) {
          statusEl.textContent = 'Connected!';
          statusEl.disabled = false;
        }
        setTimeout(() => popup?.close(), 500);
        await actions.loadCatalog();
        setTimeout(() => window.location.reload(), 1000);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(poll);
        cleanup();
        if (statusEl) {
          statusEl.textContent = 'Timed out. Try again.';
          statusEl.disabled = false;
        }
        alert('Device flow timed out. Please try again.');
      }
    } catch {
      if (attempts >= maxAttempts) {
        clearInterval(poll);
        cleanup();
        if (statusEl) {
          statusEl.textContent = 'Connect with OAuth';
          statusEl.disabled = false;
        }
      }
    }
  }, pollInterval);
}

export async function loadOAuthStatus(state, actions) {
  try {
    const resp = await fetch('/api/oauth/status');
    const data = await resp.json();
    state.oauthStatus = data.providers || {};
  } catch {
    state.oauthStatus = {};
  }
}
