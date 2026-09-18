import { buildCloneDraft, buildUiSelection, normalizeAutoProtection, normalizeCandidateGroups, normalizeVirtualModel } from './normalizers.js';
import { createRouteFormatters, formatRuntimeInstant, toPlainText } from './formatters.js';
import { filterModels as filterCandidateModels, filterModelsByProvider as filterCandidateModelsByProvider, groupCandidatesByProvider } from './model-picker.js';

export function createVirtualModelsFeature({ state, fetchJSON, escapeHtml, activateTab }) {
  const { formatRouteLabel, renderReasonList, renderAttemptList } = createRouteFormatters({ escapeHtml });
  let editingId = null;
  let selectedModels = [];
  let previewState = null;
  let statsState = null;
  let pruneState = null;
  let traceState = null;
  let previewPanelStatus = 'idle';
  let statsPanelStatus = 'idle';
  let prunePanelStatus = 'idle';
  let tracePanelStatus = 'idle';
  let previewPanelError = '';
  let statsPanelError = '';
  let prunePanelError = '';
  let tracePanelError = '';
  let cloneDraftModel = null;
  let expandedMemberRows = new Set();
  let draggedMemberIndex = null;
  let formDirty = false;
  let previewStale = false;
  let filterProvider = '';
  let filterCapabilities = [];
  let filterContextLength = 0;
  let filterTier = 'all';

  const virtualModelsListPath = '/virtual-models';
  const virtualModelsNewPath = '/virtual-models/new';

  function virtualModelEditPath(modelId) {
    return `/virtual-models/edit/${encodeURIComponent(modelId)}`;
  }

  function getRouteEditorState(pathname = window.location.pathname) {
    if (pathname === virtualModelsNewPath) return { mode: 'new' };
    const match = pathname.match(/^\/virtual-models\/edit\/(.+)$/);
    if (!match) return { mode: 'list' };
    try {
      return { mode: 'edit', id: decodeURIComponent(match[1]) };
    } catch {
      return { mode: 'list' };
    }
  }

  function pushVirtualModelsPath(path, replace = false) {
    if (window.location.pathname === path) return;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ tabId: 'virtual-models' }, '', path);
  }

  function openListRoute({ replace = false } = {}) {
    editingId = null;
    resetFormState();
    pushVirtualModelsPath(virtualModelsListPath, replace);
    render();
  }

  function openNewRoute({ replace = false, draft = null } = {}) {
    editingId = '__new__';
    resetFormState();
    cloneDraftModel = draft;
    pushVirtualModelsPath(virtualModelsNewPath, replace);
    render();
  }

  function openEditRoute(modelId, { replace = false } = {}) {
    editingId = modelId;
    resetFormState();
    cloneDraftModel = null;
    pushVirtualModelsPath(virtualModelEditPath(modelId), replace);
    render();
  }

  function syncEditorStateFromRoute() {
    const route = getRouteEditorState();
    if (route.mode === 'new') {
      editingId = '__new__';
      return;
    }

    if (route.mode === 'edit') {
      // Preserve edit state from route even if data hasn't loaded yet
      // The model data will be loaded asynchronously and the form will populate
      editingId = route.id;
      cloneDraftModel = null;
      return;
    }

    editingId = null;
    cloneDraftModel = null;
  }

  function renderSystemPromptOptions(selectedPromptId) {
    const prompts = Array.isArray(state.systemPrompts) ? state.systemPrompts : [];
    return [`<option value="">— Select saved prompt —</option>`]
      .concat(prompts.map(prompt => `<option value="${escapeHtml(prompt.id)}" ${selectedPromptId === prompt.id ? 'selected' : ''}>${escapeHtml(prompt.name)}</option>`))
      .join('');
  }

  function resetFormState() {
    selectedModels = [];
    previewState = null;
    statsState = null;
    pruneState = null;
    traceState = null;
    previewPanelStatus = 'idle';
    statsPanelStatus = 'idle';
    prunePanelStatus = 'idle';
    tracePanelStatus = 'idle';
    previewPanelError = '';
    statsPanelError = '';
    prunePanelError = '';
    tracePanelError = '';
    cloneDraftModel = null;
    expandedMemberRows = new Set();
    draggedMemberIndex = null;
    formDirty = false;
    previewStale = false;
  }

  function syncPriorities() {

    selectedModels = selectedModels.map((sm, idx) => ({
      ...sm,
      priority: idx + 1,
    }));
  }

  function swapSelectedModels(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= selectedModels.length) return;
    const next = [...selectedModels];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    selectedModels = next;
    syncPriorities();
    previewState = null;
    updateModelList();
  }

  function toggleMemberAdvanced(index) {
    if (expandedMemberRows.has(index)) expandedMemberRows.delete(index);
    else expandedMemberRows.add(index);
    updateModelList();
  }

  function moveSelectedModelByDrag(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= selectedModels.length) return;
    if (toIndex < 0 || toIndex >= selectedModels.length) return;
    swapSelectedModels(fromIndex, toIndex);
  }

  function getCurrentStrategyValue() {
    const container = document.getElementById('virtual-models-content');
    const strategyEl = container ? container.querySelector('#vm-field-strategy') : null;
    return strategyEl ? strategyEl.value : 'priority';
  }

  function renderFormStatusContent() {
    const isEdit = editingId !== '__new__';
    if (previewState && previewStale) {
      return '<strong>Preview is stale</strong><span>Run preview or dry run again before saving this draft.</span>';
    }
    if (previewState) {
      return `<strong>${previewState.mode === 'test' ? 'Dry run current' : 'Preview current'}</strong><span>The latest validation matches the current draft.</span>`;
    }
    if (formDirty) {
      return '<strong>Unsaved changes</strong><span>Save to update the virtual model and refresh observability against this draft.</span>';
    }
    if (isEdit) {
      return '<strong>Saved model</strong><span>Stats, traces, and prune actions reflect the last saved version.</span>';
    }
    return '<strong>New draft</strong><span>Add models and save to unlock stats, traces, and prune actions.</span>';
  }

  function updateFormStatus() {
    const el = document.getElementById('vm-form-status');
    if (!el) return;
    const content = renderFormStatusContent();
    el.innerHTML = content;
    el.textContent = toPlainText(content);
  }

  function renderInlineGuidanceContent() {
    const notes = ['Fallback members are used only as backup routes and are skipped during the primary pass.'];
    const strategy = getCurrentStrategyValue();
    if (strategy === 'random') {
      notes.push('Random routing uses weight across primary members only.');
    }
    if (strategy === 'round-robin') {
      notes.push('Round robin ignores weight and rotates across eligible primary members.');
    }
    if (selectedModels.some(model => model.fallbackOnly === true)) {
      notes.push('Fallback members are used only as backup routes and are skipped during the primary pass.');
    }
    if (selectedModels.length === 0) {
      notes.push('Add at least one primary model to enable preview and save.');
    }
    if (selectedModels.length > 0 && selectedModels.every(model => model.fallbackOnly === true)) {
      notes.push('Add a primary model so the first routing pass has an eligible target.');
    }
    if (notes.length === 0) {
      notes.push('Fallback members are used only as backup routes and are skipped during the primary pass.');
    }
    return notes.map(note => `<div class="vm-inline-guidance-item">${escapeHtml(note)}</div>`).join('');
  }

  function updateInlineGuidance() {
    const el = document.getElementById('vm-inline-guidance');
    if (!el) return;
    const content = renderInlineGuidanceContent();
    el.innerHTML = content;
    el.textContent = toPlainText(content);
  }

  function renderModelPickerEmptyContent(candidateGroups) {
    if (!Array.isArray(candidateGroups) || candidateGroups.length === 0) {
      return 'No healthy candidates are available yet. Test configured providers so active models appear here.';
    }
    return 'Healthy candidates are grouped here by provider. Add one primary member before saving.';
  }

  function updateModelPickerEmpty() {
    const el = document.getElementById('vm-model-picker-empty');
    if (!el) return;
    const content = renderModelPickerEmptyContent(state.virtualModelsCandidates || []);
    el.textContent = content;
    el.className = `vm-model-picker-empty${(state.virtualModelsCandidates || []).length === 0 ? ' vm-model-picker-empty-active' : ''}`;
  }

  function markFormDirty() {
    formDirty = true;
    if (previewState) {
      previewStale = true;
      previewPanelStatus = 'stale';
    }
    updateFormStatus();
    updateInlineGuidance();
    renderPreviewPanel();
  }

  function findCandidateModel(providerName, modelId) {
    const groups = state.virtualModelsCandidates || [];
    const providerGroup = groups.find(group => group.provider === providerName);
    if (!providerGroup) return null;
    return providerGroup.models.find(model => (model.id || model.providerModelId) === modelId || model.providerModelId === modelId) || null;
  }

  async function loadVirtualModels() {
    try {
      const [virtualModels, candidates, templates, systemPrompts] = await Promise.all([
        fetchJSON('/api/virtual-models'),
        fetchJSON('/api/virtual-models/candidates'),
        fetchJSON('/api/virtual-models/templates'),
        fetchJSON('/api/system-prompts'),
      ]);
      state.virtualModels = (Array.isArray(virtualModels) ? virtualModels : []).map(normalizeVirtualModel);
      state.virtualModelsCandidates = normalizeCandidateGroups(candidates);
      state.virtualModelTemplates = (Array.isArray(templates) ? templates : []).map(normalizeVirtualModel);
      state.systemPrompts = Array.isArray(systemPrompts) ? systemPrompts : [];
      syncEditorStateFromRoute();

      // If the edit route targets a model that no longer exists in the catalog
      // (direct URL, or the model was removed), or a protected built-in model,
      // fall back to the list view rather than rendering an empty editor.
      if (editingId !== null && editingId !== '__new__') {
        const targetModel = (state.virtualModels || []).find(model => model.id === editingId);
        if (!targetModel || targetModel.isBuiltin) {
          editingId = null;
          resetFormState();
          pushVirtualModelsPath(virtualModelsListPath, true);
        }
      }
    } catch (err) {
      state.virtualModels = [];
      state.virtualModelsCandidates = [];
      state.virtualModelTemplates = [];
      state.systemPrompts = [];
      console.error('Failed to load virtual models:', err);
    }
    render();
  }

  function render() {
    const container = document.getElementById('virtual-models-content');
    if (!container) return;

    if (editingId !== null) {
      container.innerHTML = renderForm();
      attachFormEvents();
    } else {
      container.innerHTML = renderTable();
      attachTableEvents();
    }
  }

  function renderTable() {
    const models = state.virtualModels || [];
    const templates = state.virtualModelTemplates || [];
    return `
      <div class="vm-toolbar">
        <button class="btn-primary" id="vm-create-btn">+ Create Virtual Model</button>
        <div class="vm-template-toolbar">
          <label for="vm-template-select">Create From Template</label>
          <select id="vm-template-select">
            <option value="">- Select template -</option>
            ${templates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('')}
          </select>
          <button class="btn-secondary" id="vm-create-template-btn" type="button">Use Template</button>
        </div>
      </div>
      <div class="vm-table-wrapper">
        <table class="vm-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Strategy</th>
              <th>Capabilities</th>
                <th>Aliases</th>
                <th>System Prompt</th>
                <th>Models</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
              ${models.length === 0 ? '<tr><td colspan="8" class="empty">No virtual models defined yet.</td></tr>' : models.map(m => renderRow(m)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderRow(m) {
    const capabilities = (m.capabilities || []).map(c => `<span class="vm-capability-badge">${escapeHtml(c)}</span>`).join('');
    const aliases = (m.autoAliases || []).map(a => `<span class="vm-aliase-badge">${escapeHtml(a)}</span>`).join('');
    const systemPromptName = m.systemPrompt
      ? ((state.systemPrompts || []).find(p => p.content === m.systemPrompt)?.name || '(custom)')
      : '(none)';
    const modelsCount = (m.selectedModels || []).length;
    const isBuiltin = m.isBuiltin === true;

    return `
      <tr class="${isBuiltin ? 'vm-row-builtin' : ''}">
        <td class="vm-cell-id">${escapeHtml(m.id)}${isBuiltin ? ' <span class="vm-builtin-tag">built-in</span>' : ''}</td>
        <td>${escapeHtml(m.name || '')}</td>
        <td><span class="vm-strategy-badge vm-strategy-${escapeHtml(m.routingStrategy || 'priority')}">${escapeHtml(m.routingStrategy || 'priority')}</span></td>
        <td class="vm-cell-capabilities">${capabilities || '<span class="muted">—</span>'}</td>
        <td class="vm-cell-aliases">${aliases || '<span class="muted">—</span>'}</td>
        <td class="vm-cell-system-prompt">${escapeHtml(systemPromptName)}</td>
        <td class="vm-cell-count">${modelsCount}</td>
        <td class="vm-cell-actions">
          <button class="vm-btn-action vm-btn-edit" data-vm-edit="${escapeHtml(m.id)}" ${isBuiltin ? 'disabled title="Built-in models cannot be edited"' : ''}>Edit</button>
          <button class="vm-btn-action vm-btn-clone" data-vm-clone="${escapeHtml(m.id)}">Clone</button>
          <button class="vm-btn-action vm-btn-delete" data-vm-delete="${escapeHtml(m.id)}" ${isBuiltin ? 'disabled title="Built-in models cannot be deleted"' : ''}>Delete</button>
        </td>
      </tr>
    `;
  }

  function renderForm() {
    const candidates = state.virtualModelsCandidates || [];
    const isEdit = editingId !== '__new__';
    const draftModel = isEdit
      ? (state.virtualModels || []).find(m => m.id === editingId) || null
      : cloneDraftModel;

    const id = draftModel ? (draftModel.id || '') : '';
    const name = draftModel ? draftModel.name : '';
    const description = draftModel ? (draftModel.description || '') : '';
    const systemPrompt = draftModel ? (draftModel.systemPrompt || '') : '';
    const matchedPrompt = (state.systemPrompts || []).find(prompt => prompt.content === systemPrompt);
    const strategy = draftModel ? (draftModel.routingStrategy || 'priority') : 'priority';
    const capabilities = draftModel ? (draftModel.capabilities || []) : [];
    const currentModels = draftModel ? (draftModel.selectedModels || []) : [];
    const aliases = draftModel ? (draftModel.autoAliases || []) : [];
    const stickyMode = draftModel ? (draftModel.stickyMode || 'none') : 'none';
    const autoProtection = normalizeAutoProtection(draftModel?.autoProtection);

    selectedModels = currentModels.map(buildUiSelection);
    syncPriorities();

    const groupedProviders = groupCandidatesByProvider(candidates);
    const memberSummary = summarizeSelectedModels();
    const savedOperationalDisabled = isEdit ? '' : 'disabled';

    return `
      <div class="vm-form">
        <div class="vm-form-header">
          <div>
            <h2>${isEdit ? 'Edit Virtual Model' : 'Create Virtual Model'}</h2>
            <p class="vm-form-subtitle">Author the member pool quickly, then validate routing and runtime behavior from the same surface.</p>
          </div>
          <button class="btn-secondary" id="vm-form-cancel">Cancel</button>
        </div>
        <div class="vm-form-body">
          <div class="vm-form-layout">
            <section class="vm-form-section">
              <div class="vm-section-heading">
                <h3>Routing behavior</h3>
                <p>Define the identity and baseline selection strategy for this virtual model.</p>
              </div>
              <div class="vm-form-grid vm-form-grid-two-up">
                <div class="vm-form-group">
                  <label for="vm-field-id">ID <span class="required">*</span></label>
                  <input type="text" id="vm-field-id" value="${escapeHtml(id)}" ${isEdit ? 'disabled' : ''} pattern="^[a-zA-Z0-9/_.-]+$" placeholder="my-custom-model" required>
                  ${isEdit ? '' : '<small class="hint">Only letters, numbers, hyphens, underscores, and forward slashes allowed.</small>'}
                </div>

                <div class="vm-form-group">
                  <label for="vm-field-name">Name <span class="required">*</span></label>
                  <input type="text" id="vm-field-name" value="${escapeHtml(name)}" placeholder="My Custom Model" required>
                </div>

                <div class="vm-form-group vm-form-group-full">
                  <label for="vm-field-description">Description</label>
                  <textarea id="vm-field-description" rows="3" placeholder="Optional description">${escapeHtml(description)}</textarea>
                </div>

                <div class="vm-form-group vm-form-group-full">
                  <label for="vm-field-system-prompt-select">Use Saved Prompt</label>
                  <div class="vm-inline-actions">
                    <select id="vm-field-system-prompt-select">
                      ${renderSystemPromptOptions(matchedPrompt?.id || '')}
                    </select>
                    <button class="btn-secondary" id="vm-manage-system-prompts" type="button">Manage prompts</button>
                  </div>
                  <small class="hint">Selecting a saved prompt copies its content into the textarea below.</small>
                </div>

                <div class="vm-form-group vm-form-group-full">
                  <label for="vm-field-system-prompt">System Prompt</label>
                  <textarea id="vm-field-system-prompt" rows="6" placeholder="Optional system prompt injected into every request routed through this virtual model.">${escapeHtml(systemPrompt)}</textarea>
                </div>

                <div class="vm-form-group">
                  <label for="vm-field-strategy">Routing Strategy</label>
                  <select id="vm-field-strategy">
                    <option value="priority" ${strategy === 'priority' ? 'selected' : ''}>Priority</option>
                    <option value="round-robin" ${strategy === 'round-robin' ? 'selected' : ''}>Round Robin</option>
                    <option value="random" ${strategy === 'random' ? 'selected' : ''}>Random</option>
                  </select>
                </div>

                <div class="vm-form-group">
                  <label for="vm-field-sticky-mode">Sticky Routing</label>
                  <select id="vm-field-sticky-mode">
                    <option value="none" ${stickyMode === 'none' ? 'selected' : ''}>Disabled</option>
                    <option value="request-key" ${stickyMode === 'request-key' ? 'selected' : ''}>Request Key</option>
                  </select>
                  <small class="hint">Request Key keeps the same backing model for the same gateway key or sticky header.</small>
                </div>
              </div>
            </section>

            <section class="vm-form-section">
              <div class="vm-section-heading">
                <h3>Protection</h3>
                <p>Control when unstable members should be cooled down and brought back later.</p>
              </div>
              <div class="vm-form-grid vm-form-grid-two-up">
                <div class="vm-form-group vm-form-group-full">
                  <label class="vm-checkbox-label"><input type="checkbox" id="vm-field-auto-protection-enabled" ${autoProtection.enabled ? 'checked' : ''}> Auto Protection</label>
                  <small class="hint">When enabled, members that repeatedly fail are temporarily excluded instead of silently disappearing.</small>
                </div>
                <div class="vm-form-group">
                  <label for="vm-field-failure-threshold">Failure threshold</label>
                  <input type="number" id="vm-field-failure-threshold" value="${escapeHtml(autoProtection.failureThreshold)}" min="1" step="1">
                </div>
                <div class="vm-form-group">
                  <label for="vm-field-cooldown-ms">Cooldown (ms)</label>
                  <input type="number" id="vm-field-cooldown-ms" value="${escapeHtml(autoProtection.cooldownMs)}" min="0" step="1000">
                </div>
              </div>
            </section>

            <section class="vm-form-section">
              <div class="vm-section-heading">
                <h3>Capabilities & aliases</h3>
                <p>Declare what this route should expose and which aliases it can answer to.</p>
              </div>
              <fieldset class="vm-form-group vm-capabilities-fieldset">
                <legend>Capabilities <span class="required">*</span> <small class="hint">(at least one required)</small></legend>
                <label class="vm-checkbox-label"><input type="checkbox" class="vm-cap-checkbox" value="chat" ${capabilities.includes('chat') ? 'checked' : ''}> Chat</label>
                <label class="vm-checkbox-label"><input type="checkbox" class="vm-cap-checkbox" value="vision" ${capabilities.includes('vision') ? 'checked' : ''}> Vision</label>
                <label class="vm-checkbox-label"><input type="checkbox" class="vm-cap-checkbox" value="file_input" ${capabilities.includes('file_input') ? 'checked' : ''}> File Input</label>
              </fieldset>

              <div class="vm-form-group">
                <label for="vm-field-aliases">Auto Aliases</label>
                <div class="vm-tag-input" id="vm-tag-input-container">
                  <div class="vm-tag-list" id="vm-tag-list">
                    ${aliases.map(a => renderTag(a)).join('')}
                  </div>
                  <input type="text" id="vm-field-aliases" placeholder="Type and press Enter to add" class="vm-tag-text-input">
                </div>
                <div class="vm-inline-guidance" id="vm-inline-guidance">${renderInlineGuidanceContent()}</div>
              </div>
            </section>

            <section class="vm-form-section">
              <div class="vm-section-heading">
                <h3>Member pool</h3>
                <p>Review primary and fallback routes together with their live runtime state before saving.</p>
              </div>
              <div class="vm-inline-metrics">
                <div class="vm-inline-metric"><span class="vm-inline-metric-label">Active</span><strong>${escapeHtml(memberSummary.active)}</strong></div>
                <div class="vm-inline-metric"><span class="vm-inline-metric-label">Cooldown</span><strong>${escapeHtml(memberSummary.cooldown)}</strong></div>
                <div class="vm-inline-metric"><span class="vm-inline-metric-label">Fallback</span><strong>${escapeHtml(memberSummary.fallback)}</strong></div>
                <div class="vm-inline-metric"><span class="vm-inline-metric-label">Disabled</span><strong>${escapeHtml(memberSummary.disabled)}</strong></div>
              </div>
              <div class="vm-form-group">
                <label>Select Models <span class="required">*</span></label>
                <div class="vm-model-selector">
                  <div class="vm-model-filters">
                    <select id="vm-filter-provider" class="vm-filter-select">
                      <option value="">All Providers</option>
                      ${Object.keys(groupedProviders).sort().map(providerName => `
                        <option value="${escapeHtml(providerName)}">${escapeHtml(providerName)}</option>
                      `).join('')}
                    </select>
                    <select id="vm-filter-capabilities" class="vm-filter-select" multiple>
                      <option value="">All Capabilities</option>
                      ${Array.from(new Set(candidates.flatMap(c => c.models?.flatMap(m => m.capabilities || []) || [])))
                        .sort()
                        .map(cap => `<option value="${escapeHtml(cap)}">${escapeHtml(cap)}</option>`)
                        .join('')}
                    </select>
                    <select id="vm-filter-context" class="vm-filter-select">
                      <option value="">Any Context</option>
                      <option value="8000">≥ 8K</option>
                      <option value="32000">≥ 32K</option>
                      <option value="128000">≥ 128K</option>
                      <option value="200000">≥ 200K</option>
                    </select>
                    <select id="vm-filter-tier" class="vm-filter-select">
                      <option value="all">All Tiers</option>
                      <option value="free">Free</option>
                      <option value="trial">Trial</option>
                      <option value="paid">Paid</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div class="vm-model-picker">
                    <select id="vm-model-add-provider" class="vm-model-provider-select">
                      <option value="">— Select model —</option>
                    </select>
                    <button class="btn-secondary" id="vm-model-add-btn" type="button">Add Model</button>
                  </div>
                  <div id="vm-model-picker-empty" class="vm-model-picker-empty${candidates.length === 0 ? ' vm-model-picker-empty-active' : ''}">${escapeHtml(renderModelPickerEmptyContent(candidates))}</div>
                  <div class="vm-model-list" id="vm-model-list"> 
                    ${selectedModels.map((sm, idx) => renderSelectedModelRow(idx, sm)).join('')}
                  </div>
                </div>
              </div>
            </section>

            <section class="vm-form-section">
              <div class="vm-section-heading">
                <h3>Operational controls</h3>
                <p>Use these tools to sanity-check routing before you save or to inspect a dry run on the current draft.</p>
              </div>
              <div class="vm-panel-toolbar">
                <button class="btn-secondary" id="vm-preview-btn" type="button">Preview Routing</button>
                <button class="btn-secondary" id="vm-test-btn" type="button">Test Virtual Model</button>
              </div>
              <div id="vm-preview-panel" class="vm-preview-panel vm-operation-panel">${renderPreviewPanelContent()}</div>
            </section>

            <section class="vm-form-section">
              <div class="vm-section-heading">
                <h3>Observability</h3>
                <p>Inspect saved-model behavior, maintenance impact, and recent route decisions without leaving the editor.</p>
              </div>
              <div class="vm-panel-toolbar">
                <button class="btn-secondary" id="vm-stats-btn" type="button" ${savedOperationalDisabled}>Load Stats</button>
                <button class="btn-secondary" id="vm-prune-btn" type="button" ${savedOperationalDisabled}>Prune Unhealthy</button>
                <button class="btn-secondary" id="vm-trace-btn" type="button" ${savedOperationalDisabled}>Load Recent Traces</button>
              </div>
              ${isEdit ? '' : '<div class="vm-guard-note">Save the virtual model first to unlock stats, prune, and trace history.</div>'}
              <div class="vm-observability-grid">
                <div id="vm-stats-panel" class="vm-stats-panel vm-operation-panel">${renderStatsPanelContent()}</div>
                <div id="vm-prune-panel" class="vm-prune-panel vm-operation-panel">${renderPrunePanelContent()}</div>
                <div id="vm-trace-panel" class="vm-trace-panel vm-operation-panel">${renderTracePanelContent()}</div>
              </div>
            </section>
          </div>

          <div class="vm-form-actions vm-form-actions-footer">
            <div id="vm-form-status" class="vm-form-status">${renderFormStatusContent()}</div>
            <button class="btn-secondary" id="vm-form-cancel-bottom" type="button">Cancel</button>
            <button class="btn-primary" id="vm-form-save" type="button">${isEdit ? 'Update' : 'Create'}</button>
          </div>
          <div id="vm-form-feedback" class="vm-form-feedback"></div>
        </div>
      </div>
    `;
  }
  function renderSelectedModelRow(idx, sm) {
    const providerName = sm.providerName || '';
    const modelId = sm.providerModelId || '';
    const capabilities = Array.isArray(sm.capabilities) ? sm.capabilities : [];
    const tier = sm.commercialTier || 'unknown';
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const memberState = sm.memberState || {};
    const status = getMemberStatus(sm);
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');
    const routeRole = sm.fallbackOnly === true ? 'Fallback route' : 'Primary route';
    const failureCount = Number(memberState.consecutiveFailures ?? 0);
    const cooldownLabel = memberState.autoDisabledUntil
      ? `Cooldown until ${escapeHtml(formatRuntimeInstant(memberState.autoDisabledUntil))}`
      : status === 'Disabled'
        ? 'Excluded until re-enabled'
        : 'Available for routing';
    const failureLabel = failureCount > 0 ? `${escapeHtml(failureCount)} consecutive failures` : 'No recent failures';
    const isExpanded = expandedMemberRows.has(idx);
    return `
      <div class="vm-model-row" data-index="${idx}" draggable="true">
        <div class="vm-model-row-top">
          <div class="vm-model-row-title-block">
            <div class="vm-model-row-heading">
              <span class="vm-model-row-drag" aria-hidden="true">⋮⋮</span>
              <span class="vm-model-row-name">${escapeHtml(providerName)}: ${escapeHtml(modelId)}</span>
              <span class="vm-tier-badge vm-tier-${tier}">${escapeHtml(tierLabel)}</span>
            </div>
            <div class="vm-model-row-statuses">
              <span class="vm-member-state-chip vm-member-state-${statusClass}">${escapeHtml(status)}</span>
              <span class="vm-member-state-chip vm-member-role-chip">${escapeHtml(routeRole)}</span>
              <span class="vm-member-state-chip vm-member-priority-chip">Priority ${escapeHtml(sm.priority)}</span>
            </div>
          </div>
          <div class="vm-model-row-actions">
            <div class="vm-model-row-move" aria-label="Drag to reorder or use arrow controls">
              <span class="vm-model-row-move-label">Drag to reorder</span>
              <button class="vm-btn-action vm-btn-move-up" data-index="${idx}" type="button">↑</button>
              <button class="vm-btn-action vm-btn-move-down" data-index="${idx}" type="button">↓</button>
            </div>
            <button class="vm-btn-action vm-btn-advanced-toggle" data-index="${idx}" type="button" aria-expanded="${isExpanded ? 'true' : 'false'}">Advanced controls</button>
          </div>
        </div>
        <div class="vm-model-row-meta">
          ${capabilities.map(capability => `<span class="vm-capability-badge">${escapeHtml(capability)}</span>`).join('') || '<span class="muted">No per-model capabilities</span>'}
          <span class="vm-model-runtime-note">${cooldownLabel}</span>
          <span class="vm-model-runtime-note">${failureLabel}</span>
        </div>
        <div class="vm-model-row-advanced${isExpanded ? ' vm-model-row-advanced-open' : ''}" ${isExpanded ? '' : 'hidden'}>
          <label class="vm-model-row-enabled">
            <input type="checkbox" class="vm-model-enabled-input" data-index="${idx}" ${sm.enabled !== false ? 'checked' : ''}>
            Enabled
          </label>
          <label class="vm-model-row-weight">
            Weight:
            <input type="number" class="vm-model-weight-input" value="${sm.weight ?? 1}" min="1" step="1" data-index="${idx}">
          </label>
          <label class="vm-model-row-fallback">
            <input type="checkbox" class="vm-model-fallback-input" data-index="${idx}" ${sm.fallbackOnly === true ? 'checked' : ''}>
            Fallback only
          </label>
          <button class="vm-btn-action vm-btn-remove" data-index="${idx}" type="button">Remove</button>
        </div>
      </div>
    `;
  }

  function renderTag(value) {

    return `<span class="vm-tag">${escapeHtml(value)}<button class="vm-tag-remove" type="button" data-tag="${escapeHtml(value)}">×</button></span>`;
  }


  function getMemberStatus(sm) {
    if (sm.enabled === false) return 'Disabled';
    const autoDisabledUntil = Number(sm.memberState?.autoDisabledUntil ?? 0);
    if (Number.isFinite(autoDisabledUntil) && autoDisabledUntil > Date.now()) {
      return 'Cooldown';
    }
    return 'Active';
  }

  function summarizeSelectedModels() {
    return selectedModels.reduce((summary, sm) => {
      const status = getMemberStatus(sm);
      if (status === 'Disabled') summary.disabled += 1;
      else if (status === 'Cooldown') summary.cooldown += 1;
      else summary.active += 1;
      if (sm.fallbackOnly === true) summary.fallback += 1;
      return summary;
    }, { active: 0, cooldown: 0, fallback: 0, disabled: 0 });
  }

  function renderPanelState({ title, detail, tone = 'idle', scope = '', action = '', error = '' }) {
    const scopeHtml = scope ? `<span class="vm-panel-scope">${escapeHtml(scope)}</span>` : '';
    const actionHtml = action ? `<span class="vm-panel-state-action">${escapeHtml(action)}</span>` : '';
    const errorHtml = error ? `<div class="vm-panel-error-detail">${escapeHtml(error)}</div>` : '';
    return `
      <div class="vm-panel-state vm-panel-state-${escapeHtml(tone)}">
        <div class="vm-panel-state-header">
          <strong>${escapeHtml(title)}</strong>
          ${scopeHtml}
        </div>
        <span>${escapeHtml(detail)}</span>
        ${actionHtml}
        ${errorHtml}
      </div>
    `;
  }

  function renderStatsPanelContent() {
    if (statsPanelStatus === 'loading') {
      return renderPanelState({
        title: 'Loading runtime stats',
        detail: 'Fetching live usage and exclusion counts for the saved virtual model.',
        tone: 'loading',
        scope: 'Saved model snapshot',
      });
    }

    if (statsPanelStatus === 'error') {
      return renderPanelState({
        title: 'Stats unavailable',
        detail: 'The saved-model runtime snapshot could not be loaded.',
        tone: 'error',
        scope: 'Saved model snapshot',
        action: 'Retry Load Stats after the provider health refresh settles.',
        error: statsPanelError,
      });
    }

    if (!statsState) {
      return renderPanelState({
        title: 'Runtime stats idle',
        detail: 'Load stats to inspect request volume, top routes, and excluded members for the saved virtual model.',
        tone: 'idle',
        scope: 'Saved model snapshot',
      });
    }

    const routeHits = Array.isArray(statsState.routeHits) ? statsState.routeHits : [];
    const routeFailures = Array.isArray(statsState.routeFailures) ? statsState.routeFailures : [];
    const excluded = Array.isArray(statsState.currentlyExcluded) ? statsState.currentlyExcluded : [];
    const mostUsed = routeHits[0];
    const mostUsedLabel = mostUsed ? escapeHtml(`${mostUsed.provider}/${mostUsed.modelId}`) : 'None';
    const failuresLabel = routeFailures.length === 0
      ? 'None'
      : routeFailures.map(entry => `${escapeHtml(entry.provider)}/${escapeHtml(entry.modelId)} (${escapeHtml(entry.count)})`).join(', ');
    const excludedLabel = excluded.length === 0
      ? 'None'
      : excluded.map(entry => `${escapeHtml(entry.provider)}/${escapeHtml(entry.modelId)} (${escapeHtml(entry.reason)})`).join(', ');

    return `
      <div class="vm-panel-heading">
        <strong>Runtime snapshot</strong>
        <span>Requests, top route, and currently excluded members from the last saved configuration.</span>
      </div>
      <div class="vm-panel-banner vm-panel-banner-neutral">
        <strong>Saved model snapshot</strong>
        <span>Draft edits do not change these numbers until the virtual model is saved again.</span>
      </div>
      <div class="vm-metric-grid">
        <div class="vm-metric-card"><span class="vm-metric-label">Requests</span><strong>${escapeHtml(statsState.totalRequests ?? 0)}</strong></div>
        <div class="vm-metric-card"><span class="vm-metric-label">Cooldown members</span><strong>${escapeHtml(statsState.cooldownMembers ?? 0)}</strong></div>
        <div class="vm-metric-card"><span class="vm-metric-label">Top route</span><strong>${mostUsedLabel}</strong></div>
        <div class="vm-metric-card"><span class="vm-metric-label">Last used</span><strong>${statsState.lastUsedAt ? escapeHtml(formatRuntimeInstant(statsState.lastUsedAt)) : 'Never'}</strong></div>
      </div>
      <div class="vm-panel-list">
        <div><span class="vm-panel-list-label">Failures</span><span>${failuresLabel}</span></div>
        <div><span class="vm-panel-list-label">Excluded members</span><span>${excludedLabel}</span></div>
      </div>
    `;
  }

  function renderPrunePanelContent() {
    if (prunePanelStatus === 'loading') {
      return renderPanelState({
        title: 'Loading prune preview',
        detail: 'Checking which unhealthy members would be removed from the saved virtual model.',
        tone: 'loading',
        scope: 'Saved model change',
      });
    }

    if (prunePanelStatus === 'error') {
      return renderPanelState({
        title: 'Prune preview unavailable',
        detail: 'The unhealthy-member review could not be loaded.',
        tone: 'error',
        scope: 'Saved model change',
        action: 'Retry once provider health finishes refreshing.',
        error: prunePanelError,
      });
    }

    if (!pruneState) {
      return renderPanelState({
        title: 'Prune review idle',
        detail: 'Preview prune results before applying changes to the saved virtual model.',
        tone: 'idle',
        scope: 'Saved model change',
      });
    }

    const removed = Array.isArray(pruneState.removed) ? pruneState.removed : [];
    const kept = Array.isArray(pruneState.kept) ? pruneState.kept : [];
    const removedLabel = removed.length === 0
      ? 'None'
      : removed.map(entry => `${escapeHtml(entry.provider)}/${escapeHtml(entry.modelId)} (${escapeHtml(entry.reason)})`).join(', ');
    const keptLabel = kept.length === 0
      ? 'None'
      : kept.map(entry => `${escapeHtml(entry.provider)}/${escapeHtml(entry.modelId)}`).join(', ');
    const removedList = renderReasonList(removed, 'No unhealthy members would be removed.');
    const confirmButton = pruneState.applied !== true && removed.length > 0
      ? '<button class="btn-secondary" id="vm-prune-confirm-btn" type="button">Confirm Prune</button>'
      : '';
    const appliedLabel = pruneState.applied === true ? '<div class="vm-panel-inline-success">Prune applied.</div>' : '';

    return `
      <div class="vm-panel-heading">
        <strong>Review prune impact</strong>
        <span>Confirm only after reviewing which unhealthy members will be removed from the saved model.</span>
      </div>
      <div class="vm-panel-banner vm-panel-banner-warn">
        <strong>Saved model change</strong>
        <span>This action edits the persisted virtual model, not just the draft on screen.</span>
      </div>
      <div class="vm-panel-list">
        <div><span class="vm-panel-list-label">Removed candidates</span><span>${removedLabel}</span></div>
        <div class="vm-panel-list-stack"><span class="vm-panel-list-label">Removal reasons</span><div class="vm-reason-list">${removedList}</div></div>
        <div><span class="vm-panel-list-label">Kept models</span><span>${keptLabel}</span></div>
      </div>
      <div class="vm-panel-actions">
        ${confirmButton}
        ${appliedLabel}
      </div>
    `;
  }


  function renderTracePanelContent() {
    if (tracePanelStatus === 'loading') {
      return renderPanelState({
        title: 'Loading route traces',
        detail: 'Fetching recent saved-model decisions from exclusion to final route.',
        tone: 'loading',
        scope: 'Saved model traces',
      });
    }

    if (tracePanelStatus === 'error') {
      return renderPanelState({
        title: 'Route traces unavailable',
        detail: 'Recent routing decisions could not be loaded.',
        tone: 'error',
        scope: 'Saved model traces',
        action: 'Retry Load Traces after new traffic is recorded.',
        error: tracePanelError,
      });
    }

    if (!traceState) {
      return renderPanelState({
        title: 'Route traces idle',
        detail: 'Load recent route traces to inspect exclusions, attempts, and final routing decisions for the saved virtual model.',
        tone: 'idle',
        scope: 'Saved model traces',
      });
    }

    const traces = Array.isArray(traceState.traces) ? traceState.traces : [];
    if (traces.length === 0) {
      return renderPanelState({
        title: 'No route traces yet',
        detail: 'No recent route traces were recorded for this saved virtual model.',
        tone: 'idle',
        scope: 'Saved model traces',
      });
    }

    return `
      <div class="vm-panel-heading"><strong>Recent route traces</strong><span>Read the latest route decision from exclusion to final provider choice.</span></div>
      <div class="vm-trace-items">
        ${traces.map(trace => {
          const finalRoute = formatRouteLabel(trace.finalRoute);
          const attempts = Array.isArray(trace.attempts) ? trace.attempts : [];
          const excluded = Array.isArray(trace.excludedCandidates) ? trace.excludedCandidates : [];
          const fallbackUsed = attempts.some(attempt => attempt.phase === 'fallback' || attempt.fallbackOnly === true);
          return `
            <div class="vm-trace-item">
              <div class="vm-trace-item-header">
                <strong>${escapeHtml(trace.id || 'unknown')}</strong>
                <span class="vm-member-state-chip vm-member-state-${escapeHtml((trace.outcome || 'unknown').toLowerCase())}">${escapeHtml(trace.outcome || 'unknown')}</span>
              </div>
              <div class="vm-panel-banner vm-panel-banner-neutral">
                <strong>Final chosen route</strong>
                <span>${finalRoute}</span>
              </div>
              <div><span class="vm-panel-list-label">Routing path</span> ${fallbackUsed ? 'Fallback path was used after the primary pass.' : 'Primary path completed without fallback.'}</div>
              <div class="vm-panel-list-stack"><span class="vm-panel-list-label">Attempts</span><div class="vm-attempt-list">${renderAttemptList(attempts)}</div></div>
              <div class="vm-panel-list-stack"><span class="vm-panel-list-label">Excluded candidates</span><div class="vm-reason-list">${renderReasonList(excluded, 'No candidates were excluded before routing.')}</div></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderPreviewPanelContent() {
    if (previewPanelStatus === 'loading') {
      return renderPanelState({
        title: 'Running draft validation',
        detail: 'Testing the current draft against the latest healthy model list.',
        tone: 'loading',
        scope: 'Draft validation',
      });
    }

    if (previewPanelStatus === 'error') {
      return renderPanelState({
        title: 'Draft validation failed',
        detail: 'Preview or dry run could not evaluate the current draft.',
        tone: 'error',
        scope: 'Draft validation',
        action: 'Review required fields and provider health, then run preview again.',
        error: previewPanelError,
      });
    }

    if (!previewState) {
      return renderPanelState({
        title: 'Draft validation idle',
        detail: 'Use Preview Routing or Test Virtual Model to inspect the current draft before saving.',
        tone: 'idle',
        scope: 'Draft validation',
      });
    }

    const preview = previewState.preview || previewState;
    const eligible = Array.isArray(preview.eligibleModels) ? preview.eligibleModels : [];
    const explanation = Array.isArray(preview.explanation) ? preview.explanation : [];
    const suggestedRoute = preview.suggestedRoute || previewState.selectedRoute;
    const modeLabel = previewState.mode === 'test' ? 'Dry run result' : 'Preview result';
    const excludedCount = eligible.filter(item => !item.healthy).length;
    const excludedItems = eligible.filter(item => !item.healthy).map(item => ({
      provider: item.provider,
      modelId: item.modelId,
      reason: item.reason || 'unknown',
    }));
    const fallbackSuggested = eligible.find(item => item.provider === suggestedRoute?.provider && item.modelId === suggestedRoute?.modelId && item.fallbackOnly === true);

    return `
      <div class="vm-panel-heading">
        <strong>${escapeHtml(modeLabel)}</strong>
        <span>Inspect the likely route before saving or compare the current draft against live health.</span>
      </div>
      <div class="vm-panel-banner ${previewPanelStatus === 'stale' ? 'vm-panel-banner-warn' : 'vm-panel-banner-info'}">
        <strong>${previewPanelStatus === 'stale' ? 'Draft changed after validation' : 'Draft validation current'}</strong>
        <span>${previewPanelStatus === 'stale' ? 'The draft changed after this result was generated. Run preview or dry run again.' : 'This result reflects the current unsaved draft, not the saved model observability panels.'}</span>
      </div>
      <div class="vm-metric-grid">
        <div class="vm-metric-card"><span class="vm-metric-label">Final chosen route</span><strong>${formatRouteLabel(suggestedRoute)}</strong></div>
        <div class="vm-metric-card"><span class="vm-metric-label">Eligible models</span><strong>${eligible.filter(item => item.healthy).length} / ${eligible.length}</strong></div>
        <div class="vm-metric-card"><span class="vm-metric-label">Excluded candidates</span><strong>${excludedCount}</strong></div>
        <div class="vm-metric-card"><span class="vm-metric-label">Strategy</span><strong>${escapeHtml(preview.strategy || 'priority')}</strong></div>
      </div>
      <div class="vm-preview-items">
        ${eligible.map(item => {
          const routeType = item.fallbackOnly === true ? 'Fallback path' : 'Primary path';
          const finalChip = suggestedRoute && suggestedRoute.provider === item.provider && suggestedRoute.modelId === item.modelId
            ? '<span class="vm-panel-chip vm-panel-chip-success">Chosen route</span>'
            : '';
          return `
          <div class="vm-preview-item ${item.healthy ? 'vm-preview-item-healthy' : 'vm-preview-item-unhealthy'}">
            <div class="vm-preview-item-header"><strong>${escapeHtml(item.provider)}/${escapeHtml(item.modelId)}</strong>${finalChip}</div>
            <span>priority ${escapeHtml(item.priority)} · ${routeType} · ${item.healthy ? 'eligible' : `excluded (${escapeHtml(item.reason || 'unknown')})`}</span>
          </div>
        `;
        }).join('')}
      </div>
      <div class="vm-panel-list-stack">
        <span class="vm-panel-list-label">Excluded candidates and reasons</span>
        <div class="vm-reason-list">${renderReasonList(excludedItems, 'No candidates were excluded in this draft validation.')}</div>
      </div>
      <div class="vm-panel-banner ${fallbackSuggested ? 'vm-panel-banner-warn' : 'vm-panel-banner-neutral'}">
        <strong>${fallbackSuggested ? 'Fallback path selected' : 'Primary path selected'}</strong>
        <span>${fallbackSuggested ? 'The selected route came from the fallback pool after primary candidates were filtered out.' : 'The selected route remained in the primary pool.'}</span>
      </div>
      <div class="vm-preview-explanation">
        <strong>Why this route</strong>
        ${explanation.map(line => `<div>${escapeHtml(line)}</div>`).join('') || '<div>No additional explanation.</div>'}
      </div>
    `;
  }

  function filterModels() {
    return filterCandidateModels({
      candidates: state.virtualModelsCandidates || [],
      providerFilter: filterProvider,
      capabilitiesFilter: filterCapabilities,
      contextFilter: filterContextLength,
      tierFilter: filterTier,
    });
  }

  function filterModelsByProvider(provider) {
    return filterCandidateModelsByProvider({ candidates: state.virtualModelsCandidates || [], provider });
  }

  function attachTableEvents() {
    const container = document.getElementById('virtual-models-content');
    if (!container) return;

    const createBtn = container.querySelector('#vm-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        openNewRoute();
      });
    }

    const createTemplateBtn = container.querySelector('#vm-create-template-btn');
    if (createTemplateBtn) {
      createTemplateBtn.addEventListener('click', () => {
        const templateSelect = container.querySelector('#vm-template-select');
        const templateId = templateSelect ? templateSelect.value : '';
        const template = (state.virtualModelTemplates || []).find(item => item.id === templateId);
        if (!template) return;
        const draft = {
          id: '',
          name: template.name || '',
          description: template.description || '',
          routingStrategy: template.routingStrategy || 'priority',
          capabilities: [...(template.capabilities || [])],
          selectedModels: (template.selectedModels || []).map(buildUiSelection),
          autoAliases: [],
          stickyMode: template.stickyMode || 'none',
          autoProtection: normalizeAutoProtection(template.autoProtection),
        };
        openNewRoute({ draft });
      });
    }

    container.querySelectorAll('[data-vm-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modelId = btn.getAttribute('data-vm-edit');
        const model = (state.virtualModels || []).find(m => m.id === modelId);
        if (model && model.isBuiltin) return;
        openEditRoute(modelId);
      });
    });

    container.querySelectorAll('[data-vm-clone]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modelId = btn.getAttribute('data-vm-clone');
        const model = (state.virtualModels || []).find(m => m.id === modelId);
        if (!model) return;
        openNewRoute({ draft: buildCloneDraft(model) });
      });
    });

    container.querySelectorAll('[data-vm-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modelId = btn.getAttribute('data-vm-delete');
        const model = (state.virtualModels || []).find(m => m.id === modelId);
        if (model && model.isBuiltin) return;

        if (!window.confirm(`Are you sure you want to delete the virtual model "${modelId}"?`)) return;

        try {
          await fetchJSON(`/api/virtual-models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
          state.virtualModels = (state.virtualModels || []).filter(m => m.id !== modelId);
          render();
        } catch (err) {
          console.error('Delete failed:', err);
          alert(`Failed to delete: ${err.message}`);
        }
      });
    });
  }

  function handleProviderRoute(provider) {
    const filteredModels = filterModelsByProvider(provider);
    renderProviderSpecificView(provider, filteredModels);
  }

  function attachFormEvents() {
    const container = document.getElementById('virtual-models-content');
    if (!container) return;

    const cancelButtons = container.querySelectorAll('#vm-form-cancel, #vm-form-cancel-bottom');
    cancelButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        openListRoute();
      });
    });

    ['#vm-field-name', '#vm-field-description', '#vm-field-system-prompt', '#vm-field-strategy', '#vm-field-sticky-mode', '#vm-field-auto-protection-enabled', '#vm-field-failure-threshold', '#vm-field-cooldown-ms'].forEach(selector => {
      const input = container.querySelector(selector);
      if (input) {
        input.addEventListener('change', () => {
          markFormDirty();
        });
      }
    });

    container.querySelectorAll('.vm-cap-checkbox').forEach(input => {
      input.addEventListener('change', () => {
        markFormDirty();
      });
    });

    updateFormStatus();
    updateInlineGuidance();
    updateModelPickerEmpty();

    const addModelBtn = container.querySelector('#vm-model-add-btn');
    if (addModelBtn) {
      addModelBtn.addEventListener('click', () => {
        const select = container.querySelector('#vm-model-add-provider');
        const value = select ? select.value : '';
        if (!value) return;

        const parts = value.split('::');
        if (parts.length !== 2) return;

        const providerName = parts[0];
        const providerModelId = parts[1];
        if (!providerName || !providerModelId) {
          showFormFeedback('Invalid model selection: missing provider or model ID.', 'error');
          return;
        }
        if (selectedModels.some(sm => sm.providerName === providerName && sm.providerModelId === providerModelId)) {
          showFormFeedback('This model is already selected.', 'error');
          return;
        }

        const candidateModel = findCandidateModel(providerName, providerModelId);
        selectedModels.push({
          providerName,
          providerModelId,
          priority: selectedModels.length + 1,
          enabled: true,
          weight: 1,
          fallbackOnly: false,
          capabilities: Array.isArray(candidateModel?.capabilities) ? candidateModel.capabilities : [],
          commercialTier: candidateModel?.commercialTier || 'unknown',
        });
        expandedMemberRows = new Set([selectedModels.length - 1]);
        select.value = '';
        previewState = null;
        markFormDirty();
        updateModelList();
      });
    }

    function updateModelPickerOptions() {
      const filteredModels = filterModels();

      const select = container.querySelector('#vm-model-add-provider');
      if (!select) return;

      select.innerHTML = `
        <option value="">— Select model —</option>
        ${filteredModels.map(model => {
          const tier = model.commercialTier || 'unknown';
          const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
          return `
          <option value="${escapeHtml(model.provider)}::${escapeHtml(model.providerModelId)}">
            ${escapeHtml(model.provider)}/${escapeHtml(model.providerModelId)}
            ${model.context ? ` (${model.context} ctx)` : ''}
            [${tierLabel}]
          </option>
        `}).join('')}
      `;
    }

    const tagInput = container.querySelector('#vm-field-aliases');
    if (tagInput) {
      tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = tagInput.value.trim();
          if (!value) return;
          addTag(value);
          tagInput.value = '';
        }
      });
    }

    container.querySelectorAll('.vm-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag');
        removeTag(tag);
      });
    });

    updateModelList();

    // Filter event listeners
     const filterProviderSelect = container.querySelector('#vm-filter-provider');
     if (filterProviderSelect) {
       filterProviderSelect.addEventListener('change', (e) => {
         filterProvider = e.target.value;
         updateModelPickerOptions();
       });
     }

    const filterCapabilitiesSelect = container.querySelector('#vm-filter-capabilities');
    if (filterCapabilitiesSelect) {
      filterCapabilitiesSelect.addEventListener('change', (e) => {
        const selectedOptions = Array.from(filterCapabilitiesSelect.selectedOptions);
        filterCapabilities = selectedOptions.map(option => option.value);
        updateModelPickerOptions();
      });
    }

    const filterContextSelect = container.querySelector('#vm-filter-context');
    if (filterContextSelect) {
      filterContextSelect.addEventListener('change', (e) => {
        filterContextLength = parseInt(e.target.value, 10) || 0;
        updateModelPickerOptions();
      });
    }

    const filterTierSelect = container.querySelector('#vm-filter-tier');
    if (filterTierSelect) {
      filterTierSelect.addEventListener('change', (e) => {
        filterTier = e.target.value;
        updateModelPickerOptions();
      });
    }

    const systemPromptSelect = container.querySelector('#vm-field-system-prompt-select');
    const systemPromptTextarea = container.querySelector('#vm-field-system-prompt');
    if (systemPromptSelect && systemPromptTextarea) {
      systemPromptSelect.addEventListener('change', () => {
        const selectedId = systemPromptSelect.value;
        const prompt = (state.systemPrompts || []).find((item) => item.id === selectedId);
        if (prompt) {
          systemPromptTextarea.value = prompt.content || '';
          markFormDirty();
        }
      });
    }

    const managePromptsBtn = container.querySelector('#vm-manage-system-prompts');
    if (managePromptsBtn) {
      managePromptsBtn.addEventListener('click', () => {
        activateTab('system-prompts', { updateHistory: true });
      });
    }

    const previewBtn = container.querySelector('#vm-preview-btn');
    if (previewBtn) previewBtn.addEventListener('click', handlePreview);

    const testBtn = container.querySelector('#vm-test-btn');
    if (testBtn) testBtn.addEventListener('click', handleTest);

    const statsBtn = container.querySelector('#vm-stats-btn');
    if (statsBtn) statsBtn.addEventListener('click', handleLoadStats);

    const pruneBtn = container.querySelector('#vm-prune-btn');
    if (pruneBtn) pruneBtn.addEventListener('click', handlePrunePreview);

    const traceBtn = container.querySelector('#vm-trace-btn');
    if (traceBtn) traceBtn.addEventListener('click', handleLoadTraces);

    const pruneConfirmBtn = container.querySelector('#vm-prune-confirm-btn');
    if (pruneConfirmBtn) pruneConfirmBtn.addEventListener('click', handlePruneConfirm);

    const saveBtn = container.querySelector('#vm-form-save');
    if (saveBtn) saveBtn.addEventListener('click', handleSave);
  }

  function renderProviderSpecificView(provider, models) {
    // Get unique capabilities from the models
    const allCapabilities = Array.from(new Set(models.flatMap(m => m.capabilities || []))).sort();
    
    // Create or update provider-specific panel
    let panel = document.getElementById('vm-provider-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'vm-provider-panel';
      panel.className = 'vm-provider-panel';
      const form = document.getElementById('virtual-models-content');
      if (form) {
        form.appendChild(panel);
      }
    }

    panel.innerHTML = `
      <div class="vm-provider-view">
        <div class="vm-provider-header">
          <h3>${escapeHtml(provider)} Models</h3>
          <button class="vm-btn-action vm-btn-close-provider" type="button">Close</button>
        </div>
        <div class="vm-provider-filters">
          <select id="vm-provider-filter-capabilities" class="vm-filter-select" multiple>
            ${allCapabilities.map(cap => `
              <option value="${escapeHtml(cap)}">${escapeHtml(cap)}</option>
            `).join('')}
          </select>
          <select id="vm-provider-filter-context" class="vm-filter-select">
            <option value="">Context length</option>
            <option value="4096">4K</option>
            <option value="8192">8K</option>
            <option value="16384">16K</option>
            <option value="32768">32K</option>
            <option value="128000">128K</option>
          </select>
        </div>
        <div class="vm-provider-model-list">
          ${models.map(model => `
            <div class="vm-provider-model-card">
              <div class="vm-provider-model-header">
                <strong>${escapeHtml(model.providerModelId)}</strong>
                <span class="vm-provider-model-context">${model.context ? `${model.context} ctx` : 'N/A'}</span>
              </div>
              <div class="vm-provider-model-capabilities">
                ${(model.capabilities || []).map(cap => `
                  <span class="vm-cap-chip">${escapeHtml(cap)}</span>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const closeBtn = panel.querySelector('.vm-btn-close-provider');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.remove();
      });
    }

    const capabilitiesSelect = panel.querySelector('#vm-provider-filter-capabilities');
    if (capabilitiesSelect) {
      capabilitiesSelect.addEventListener('change', (e) => {
        const selectedOptions = Array.from(capabilitiesSelect.selectedOptions);
        const capabilities = selectedOptions.map(option => option.value);
        const filteredModels = models.filter(model =>
          capabilities.length === 0 ||
          (model.capabilities || []).some(cap => capabilities.includes(cap))
        );
        renderProviderSpecificView(provider, filteredModels);
      });
    }

    const contextSelect = panel.querySelector('#vm-provider-filter-context');
    if (contextSelect) {
      contextSelect.addEventListener('change', (e) => {
        const contextValue = parseInt(e.target.value, 10) || 0;
        const filteredModels = models.filter(model => !contextValue || (model.context && model.context >= contextValue));
        renderProviderSpecificView(provider, filteredModels);
      });
    }
  }

function updateModelList() {
  const list = document.getElementById('vm-model-list');
  if (!list) return;
  syncPriorities();
  list.innerHTML = selectedModels.map((sm, idx) => renderSelectedModelRow(idx, sm)).join('');

  list.querySelectorAll('.vm-model-enabled-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.getAttribute('data-index'), 10);
      if (idx >= 0 && idx < selectedModels.length) {
        selectedModels[idx].enabled = input.checked;
        previewState = null;
        markFormDirty();
        updateModelList();
      }
    });
  });

  list.querySelectorAll('.vm-model-weight-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.getAttribute('data-index'), 10);
      const val = parseInt(input.value, 10);
      if (idx >= 0 && idx < selectedModels.length && Number.isFinite(val) && val >= 1) {
        selectedModels[idx].weight = val;
        previewState = null;
        markFormDirty();
      }
    });
  });

  list.querySelectorAll('.vm-model-fallback-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.getAttribute('data-index'), 10);
      if (idx >= 0 && idx < selectedModels.length) {
        selectedModels[idx].fallbackOnly = input.checked;
        previewState = null;
        markFormDirty();
        updateModelList();
      }
    });
  });

  list.querySelectorAll('.vm-btn-advanced-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (idx >= 0) toggleMemberAdvanced(idx);
    });
  });

  list.querySelectorAll('.vm-btn-move-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (idx >= 0) swapSelectedModels(idx, idx - 1);
    });
  });

  list.querySelectorAll('.vm-btn-move-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (idx >= 0) swapSelectedModels(idx, idx + 1);
    });
  });

  list.querySelectorAll('.vm-model-row').forEach(row => {
    row.addEventListener('dragstart', () => {
      draggedMemberIndex = parseInt(row.getAttribute('data-index'), 10);
    });
    row.addEventListener('dragover', event => {
      event.preventDefault();
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      const targetIndex = parseInt(row.getAttribute('data-index'), 10);
      moveSelectedModelByDrag(draggedMemberIndex, targetIndex);
      draggedMemberIndex = null;
    });
    row.addEventListener('dragend', () => {
      draggedMemberIndex = null;
    });
  });

  list.querySelectorAll('.vm-btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (idx >= 0 && idx < selectedModels.length) {
        selectedModels.splice(idx, 1);
        expandedMemberRows = new Set(Array.from(expandedMemberRows).filter(value => value !== idx).map(value => (value > idx ? value - 1 : value)));
        previewState = null;
        markFormDirty();
        updateModelList();
      }
    });
  });
}
  function addTag(value) {

    const tagList = document.getElementById('vm-tag-list');
    if (!tagList) return;
    const existing = tagList.querySelectorAll('.vm-tag');
    const exists = Array.from(existing).some(tag => tag.textContent.replace('×', '').trim() === value);
    if (exists) return;

    const span = document.createElement('span');
    span.className = 'vm-tag';
    span.setAttribute('data-tag', value);
    span.innerHTML = `${escapeHtml(value)}<button class="vm-tag-remove" type="button" data-tag="${escapeHtml(value)}">×</button>`;
    tagList.appendChild(span);
    previewState = null;

    const removeBtn = span.querySelector('.vm-tag-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        span.remove();
      });
    }
  }

  function removeTag(value) {
    const tagList = document.getElementById('vm-tag-list');
    if (!tagList) return;
    const tags = tagList.querySelectorAll('.vm-tag');
    for (const tag of tags) {
      const btn = tag.querySelector('.vm-tag-remove');
      if (btn && btn.getAttribute('data-tag') === value) {
        tag.remove();
        previewState = null;
        break;
      }
    }
  }

  function getTags() {
    const tagList = document.getElementById('vm-tag-list');
    if (!tagList) return [];
    return Array.from(tagList.querySelectorAll('.vm-tag')).map(tag => {
      const btn = tag.querySelector('.vm-tag-remove');
      return btn ? btn.getAttribute('data-tag') : tag.getAttribute('data-tag');
    }).filter(v => v);
  }

  function getSelectedCapabilities() {
    const container = document.getElementById('virtual-models-content');
    if (!container) return [];
    const checkboxes = container.querySelectorAll('.vm-cap-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  }

  function showFormFeedback(message, type = 'info') {
    const el = document.getElementById('vm-form-feedback');
    if (!el) return;
    el.textContent = message;
    el.className = `vm-form-feedback vm-form-feedback-${type}`;
  }

  function renderPreviewPanel() {
    const panel = document.getElementById('vm-preview-panel');
    if (!panel) return;
    panel.innerHTML = renderPreviewPanelContent();
  }

  function renderStatsPanel() {
    const panel = document.getElementById('vm-stats-panel');
    if (!panel) return;
    panel.innerHTML = renderStatsPanelContent();
  }

  function renderPrunePanel() {
    const panel = document.getElementById('vm-prune-panel');
    if (!panel) return;
    panel.innerHTML = renderPrunePanelContent();
    const confirmBtn = panel.querySelector ? panel.querySelector('#vm-prune-confirm-btn') : null;
    if (confirmBtn) {
      confirmBtn.addEventListener('click', handlePruneConfirm);
    }
  }

  function renderTracePanel() {
    const panel = document.getElementById('vm-trace-panel');
    if (!panel) return;
    panel.innerHTML = renderTracePanelContent();
  }

  function collectFormPayload({ allowUnsavedId = false } = {}) {
    const container = document.getElementById('virtual-models-content');
    if (!container) return null;

    const isEdit = editingId !== '__new__';
    const idEl = container.querySelector('#vm-field-id');
    const nameEl = container.querySelector('#vm-field-name');
    const descEl = container.querySelector('#vm-field-description');
    const systemPromptEl = container.querySelector('#vm-field-system-prompt');
    const strategyEl = container.querySelector('#vm-field-strategy');

    const id = isEdit ? editingId : (idEl ? idEl.value.trim() : '');
    const name = nameEl ? nameEl.value.trim() : '';
    const description = descEl ? descEl.value.trim() : '';
    const systemPrompt = systemPromptEl ? systemPromptEl.value.trim() : '';
    const strategy = strategyEl ? strategyEl.value : 'priority';
    const stickyModeEl = container.querySelector('#vm-field-sticky-mode');
    const stickyMode = stickyModeEl ? stickyModeEl.value : 'none';
    const autoProtectionEnabledEl = container.querySelector('#vm-field-auto-protection-enabled');
    const failureThresholdEl = container.querySelector('#vm-field-failure-threshold');
    const cooldownMsEl = container.querySelector('#vm-field-cooldown-ms');

    if (!allowUnsavedId && !id) {
      showFormFeedback('ID is required.', 'error');
      return null;
    }

    if (!isEdit && id && !/^[a-zA-Z0-9/_.-]+$/.test(id)) {
      showFormFeedback('ID must match pattern: letters, numbers, hyphens, underscores, forward slashes only.', 'error');
      return null;
    }

    if (!name) {
      showFormFeedback('Name is required.', 'error');
      return null;
    }

    const capabilities = getSelectedCapabilities();
    if (capabilities.length === 0) {
      showFormFeedback('At least one capability must be selected.', 'error');
      return null;
    }

    if (selectedModels.length === 0) {
      showFormFeedback('At least one model must be selected.', 'error');
      return null;
    }

    syncPriorities();

    return {
      ...(id ? { id } : {}),
      name,
      description,
      systemPrompt: systemPrompt || null,
      routingStrategy: strategy,
      capabilities,
      autoAliases: getTags(),
      stickyMode: stickyMode === 'request-key' ? 'request-key' : 'none',
      autoProtection: {
        enabled: autoProtectionEnabledEl ? autoProtectionEnabledEl.checked : true,
        failureThreshold: failureThresholdEl && Number.isFinite(Number(failureThresholdEl.value)) ? Number(failureThresholdEl.value) : 3,
        cooldownMs: cooldownMsEl && Number.isFinite(Number(cooldownMsEl.value)) ? Number(cooldownMsEl.value) : 600000,
      },
      selectedModels: selectedModels.map(sm => ({
        provider: sm.providerName,
        modelId: sm.providerModelId,
        priority: sm.priority,
        enabled: sm.enabled !== false,
        weight: Number.isFinite(sm.weight) && sm.weight > 0 ? sm.weight : 1,
        fallbackOnly: sm.fallbackOnly === true,
        capabilities: Array.isArray(sm.capabilities) ? sm.capabilities : [],
        memberState: sm.memberState || {
          consecutiveFailures: 0,
          lastFailureAt: null,
          autoDisabledUntil: null,
          lastAutoDisabledAt: null,
          lastRecoveredAt: null,
          lastSuccessAt: null,
        },
      })),
    };
  }

  async function handlePreview() {
    const payload = collectFormPayload({ allowUnsavedId: true });
    if (!payload) return;

    try {
      previewPanelStatus = 'loading';
      previewPanelError = '';
      renderPreviewPanel();
      const result = await fetchJSON('/api/virtual-models/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      previewState = { mode: 'preview', preview: result };
      previewPanelStatus = 'ready';
      previewPanelError = '';
      previewStale = false;
      renderPreviewPanel();
      updateFormStatus();
      showFormFeedback('Preview updated.', 'info');
    } catch (err) {
      previewPanelStatus = 'error';
      previewPanelError = err.message || 'Unknown preview error';
      renderPreviewPanel();
      console.error('Preview failed:', err);
      showFormFeedback(`Preview failed: ${err.message}`, 'error');
    }
  }

  async function handleTest() {
    const payload = collectFormPayload({ allowUnsavedId: true });
    if (!payload) return;

    try {
      previewPanelStatus = 'loading';
      previewPanelError = '';
      renderPreviewPanel();
      const result = await fetchJSON('/api/virtual-models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          input: { messages: [{ role: 'user', content: 'ping' }] },
          dryRun: true,
        }),
      });
      previewState = { mode: 'test', ...result };
      previewPanelStatus = 'ready';
      previewPanelError = '';
      previewStale = false;
      renderPreviewPanel();
      updateFormStatus();
      showFormFeedback('Dry run completed.', 'info');
    } catch (err) {
      previewPanelStatus = 'error';
      previewPanelError = err.message || 'Unknown test error';
      renderPreviewPanel();
      console.error('Test failed:', err);
      showFormFeedback(`Test failed: ${err.message}`, 'error');
    }
  }

  async function handleLoadStats() {
    if (editingId === '__new__' || !editingId) {
      showFormFeedback('Save the virtual model before loading stats.', 'error');
      return;
    }

    try {
      statsPanelStatus = 'loading';
      statsPanelError = '';
      renderStatsPanel();
      statsState = await fetchJSON(`/api/virtual-models/${encodeURIComponent(editingId)}/stats`);
      statsPanelStatus = 'ready';
      renderStatsPanel();
      showFormFeedback('Stats loaded.', 'info');
    } catch (err) {
      statsPanelStatus = 'error';
      statsPanelError = err.message || 'Unknown stats error';
      renderStatsPanel();
      console.error('Stats failed:', err);
      showFormFeedback(`Stats failed: ${err.message}`, 'error');
    }
  }

  async function handleLoadTraces() {
    if (editingId === '__new__' || !editingId) {
      showFormFeedback('Save the virtual model before loading traces.', 'error');
      return;
    }

    try {
      tracePanelStatus = 'loading';
      tracePanelError = '';
      renderTracePanel();
      traceState = await fetchJSON(`/api/virtual-models/${encodeURIComponent(editingId)}/trace?limit=10`);
      tracePanelStatus = 'ready';
      renderTracePanel();
      showFormFeedback('Route traces loaded.', 'info');
    } catch (err) {
      tracePanelStatus = 'error';
      tracePanelError = err.message || 'Unknown trace error';
      renderTracePanel();
      console.error('Trace load failed:', err);
      showFormFeedback(`Trace load failed: ${err.message}`, 'error');
    }
  }

  async function handlePrunePreview() {
    if (editingId === '__new__' || !editingId) {
      showFormFeedback('Save the virtual model before pruning.', 'error');
      return;
    }

    try {
      prunePanelStatus = 'loading';
      prunePanelError = '';
      renderPrunePanel();
      pruneState = await fetchJSON(`/api/virtual-models/${encodeURIComponent(editingId)}/prune-unhealthy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      prunePanelStatus = 'ready';
      renderPrunePanel();
      showFormFeedback('Prune preview loaded.', 'info');
    } catch (err) {
      prunePanelStatus = 'error';
      prunePanelError = err.message || 'Unknown prune error';
      renderPrunePanel();
      console.error('Prune preview failed:', err);
      showFormFeedback(`Prune preview failed: ${err.message}`, 'error');
    }
  }

  async function handlePruneConfirm() {
    if (editingId === '__new__' || !editingId) {
      showFormFeedback('Save the virtual model before pruning.', 'error');
      return;
    }

    try {
      const result = await fetchJSON(`/api/virtual-models/${encodeURIComponent(editingId)}/prune-unhealthy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      pruneState = result;
      prunePanelStatus = 'ready';
      prunePanelError = '';
      if (result.updatedModel) {
        const normalized = normalizeVirtualModel(result.updatedModel);
        const idx = (state.virtualModels || []).findIndex(model => model.id === editingId);
        if (idx !== -1) {
          state.virtualModels[idx] = normalized;
        }
        selectedModels = normalized.selectedModels.map(buildUiSelection);
        updateModelList();
      }
      renderPrunePanel();
      statsState = null;
      traceState = null;
      statsPanelStatus = 'idle';
      tracePanelStatus = 'idle';
      renderStatsPanel();
      renderTracePanel();
      showFormFeedback('Prune applied.', 'info');
    } catch (err) {
      prunePanelStatus = 'error';
      prunePanelError = err.message || 'Unknown prune apply error';
      renderPrunePanel();
      console.error('Prune apply failed:', err);
      showFormFeedback(`Prune apply failed: ${err.message}`, 'error');
    }
  }

  async function handleSave() {
    const payload = collectFormPayload();
    if (!payload) return;

    const id = payload.id;
    const isEdit = editingId !== '__new__';

    try {
      if (isEdit) {
        const result = await fetchJSON(`/api/virtual-models/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const idx = (state.virtualModels || []).findIndex(m => m.id === id);
        if (idx !== -1) {
          state.virtualModels[idx] = normalizeVirtualModel(result);
        }
      } else {
        const result = await fetchJSON('/api/virtual-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        state.virtualModels = [...(state.virtualModels || []), normalizeVirtualModel(result)];
      }

      openListRoute({ replace: true });
    } catch (err) {
      console.error('Save failed:', err);
      showFormFeedback(`Failed to save: ${err.message}`, 'error');
    }
  }

  return {
    loadVirtualModels,
    render,
  };
}













