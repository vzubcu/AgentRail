export function createSystemPromptsFeature({ state, fetchJSON, escapeHtml }) {
  let editingId = null;

  function normalizePrompt(prompt) {
    return {
      id: prompt?.id || '',
      name: prompt?.name || '',
      description: prompt?.description || '',
      content: prompt?.content || '',
    };
  }

  async function loadSystemPrompts() {
    try {
      const prompts = await fetchJSON('/api/system-prompts');
      state.systemPrompts = (Array.isArray(prompts) ? prompts : []).map(normalizePrompt);
    } catch (err) {
      state.systemPrompts = [];
      console.error('Failed to load system prompts:', err);
    }
    render();
  }

  function renderTable() {
    const prompts = state.systemPrompts || [];
    return `
      <div class="sp-toolbar">
        <div class="sp-toolbar-copy">
          <strong>${prompts.length} saved prompt${prompts.length === 1 ? '' : 's'}</strong>
          <span>Centralize reusable instructions and attach them to Virtual Models.</span>
        </div>
        <button class="btn-primary" id="sp-create-btn" type="button">+ Create System Prompt</button>
      </div>
      <div class="vm-table-wrapper sp-table-card">
        <table class="vm-table sp-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Description</th>
              <th>Content</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${prompts.length === 0 ? renderEmptyRow() : prompts.map(renderRow).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderEmptyRow() {
    return `
      <tr>
        <td colspan="5" class="empty sp-empty-cell">
          <div class="sp-empty-state">
            <strong>No reusable prompts yet</strong>
            <span>Create your first system prompt to keep model behavior consistent across Virtual Models.</span>
            <button class="btn-secondary" id="sp-empty-create-btn" type="button">Create prompt</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderRow(prompt) {
    const excerpt = prompt.content.length > 140 ? `${prompt.content.slice(0, 140)}…` : prompt.content;
    return `
      <tr>
        <td class="vm-cell-id">${escapeHtml(prompt.id)}</td>
        <td><strong class="sp-prompt-name">${escapeHtml(prompt.name)}</strong></td>
        <td class="sp-description-cell">${prompt.description ? escapeHtml(prompt.description) : '<span class="muted">—</span>'}</td>
        <td class="sp-content-cell">${excerpt ? escapeHtml(excerpt) : '<span class="muted">—</span>'}</td>
        <td class="vm-cell-actions">
          <button class="vm-btn-action vm-btn-edit" data-sp-edit="${escapeHtml(prompt.id)}" type="button">Edit</button>
          <button class="vm-btn-action vm-btn-delete" data-sp-delete="${escapeHtml(prompt.id)}" type="button">Delete</button>
        </td>
      </tr>
    `;
  }

  function renderForm() {
    const isEdit = editingId !== '__new__';
    const prompt = isEdit ? (state.systemPrompts || []).find((item) => item.id === editingId) : null;
    return `
      <div class="vm-form sp-form">
        <div class="vm-form-header">
          <div>
            <h2>${isEdit ? 'Edit System Prompt' : 'Create System Prompt'}</h2>
            <p class="vm-form-subtitle">Write reusable, versionable instructions that can be selected from Virtual Models.</p>
          </div>
          <button class="btn-secondary" id="sp-form-cancel" type="button">Cancel</button>
        </div>
        <div class="vm-form-body">
          <div class="vm-form-layout">
            <section class="vm-form-section">
              <div class="vm-section-heading sp-section-heading">
                <div>
                  <h3>Prompt details</h3>
                  <p>Use a stable ID for routing and a human-friendly name for selection lists.</p>
                </div>
              </div>
              <div class="vm-form-grid vm-form-grid-two-up">
                <div class="vm-form-group">
                  <label for="sp-field-id">ID <span class="required">*</span></label>
                  <input type="text" id="sp-field-id" value="${escapeHtml(prompt?.id || '')}" ${isEdit ? 'disabled' : ''} pattern="^[a-zA-Z0-9\/\-_]+$" placeholder="default-support-prompt" required>
                  <span class="hint">Letters, numbers, hyphens, underscores, and forward slashes.</span>
                </div>
                <div class="vm-form-group">
                  <label for="sp-field-name">Name <span class="required">*</span></label>
                  <input type="text" id="sp-field-name" value="${escapeHtml(prompt?.name || '')}" placeholder="Support Assistant" required>
                  <span class="hint">Shown when selecting a prompt in Virtual Models.</span>
                </div>
                <div class="vm-form-group vm-form-group-full">
                  <label for="sp-field-description">Description</label>
                  <textarea id="sp-field-description" rows="3" placeholder="Optional description">${escapeHtml(prompt?.description || '')}</textarea>
                  <span class="hint">Summarize intent, audience, or guardrails for teammates.</span>
                </div>
                <div class="vm-form-group vm-form-group-full">
                  <label for="sp-field-content">Prompt Content <span class="required">*</span></label>
                  <textarea id="sp-field-content" class="sp-content-textarea" rows="14" placeholder="You are a helpful assistant...">${escapeHtml(prompt?.content || '')}</textarea>
                  <span class="hint">Keep instructions explicit, testable, and free of secrets.</span>
                </div>
              </div>
            </section>
          </div>
          <div class="vm-form-actions vm-form-actions-footer">
            <button class="btn-secondary" id="sp-form-cancel-bottom" type="button">Cancel</button>
            <button class="btn-primary" id="sp-form-save" type="button">${isEdit ? 'Update' : 'Create'}</button>
          </div>
          <div id="sp-form-feedback" class="vm-form-feedback"></div>
        </div>
      </div>
    `;
  }

  function render() {
    const container = document.getElementById('system-prompts-content');
    if (!container) return;
    container.innerHTML = editingId === null ? renderTable() : renderForm();
    if (editingId === null) attachTableEvents();
    else attachFormEvents();
  }

  function showFeedback(message, type = 'info') {
    const el = document.getElementById('sp-form-feedback');
    if (!el) return;
    el.textContent = message;
    el.className = `vm-form-feedback vm-form-feedback-${type}`;
  }

  function attachTableEvents() {
    const container = document.getElementById('system-prompts-content');
    if (!container) return;

    container.querySelectorAll('#sp-create-btn, #sp-empty-create-btn').forEach((button) => button.addEventListener('click', () => {
      editingId = '__new__';
      render();
    }));

    container.querySelectorAll('[data-sp-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        editingId = button.getAttribute('data-sp-edit');
        render();
      });
    });

    container.querySelectorAll('[data-sp-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.getAttribute('data-sp-delete');
        if (!id || !window.confirm(`Delete system prompt "${id}"?`)) return;
        try {
          await fetchJSON(`/api/system-prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
          state.systemPrompts = (state.systemPrompts || []).filter((item) => item.id !== id);
          render();
        } catch (err) {
          console.error('Delete system prompt failed:', err);
          window.alert(`Failed to delete: ${err.message}`);
        }
      });
    });
  }

  function collectPayload() {
    const container = document.getElementById('system-prompts-content');
    if (!container) return null;
    const isEdit = editingId !== '__new__';
    const id = isEdit ? editingId : container.querySelector('#sp-field-id')?.value.trim();
    const name = container.querySelector('#sp-field-name')?.value.trim() || '';
    const description = container.querySelector('#sp-field-description')?.value.trim() || '';
    const content = container.querySelector('#sp-field-content')?.value || '';

    if (!id) {
      showFeedback('ID is required.', 'error');
      return null;
    }
    if (!isEdit && !/^[a-zA-Z0-9\/\-_]+$/.test(id)) {
      showFeedback('ID must match pattern: letters, numbers, hyphens, underscores, forward slashes only.', 'error');
      return null;
    }
    if (!name) {
      showFeedback('Name is required.', 'error');
      return null;
    }
    if (!content.trim()) {
      showFeedback('Prompt content is required.', 'error');
      return null;
    }

    return {
      id,
      name,
      description: description || null,
      content,
    };
  }

  function attachFormEvents() {
    const container = document.getElementById('system-prompts-content');
    if (!container) return;
    container.querySelectorAll('#sp-form-cancel, #sp-form-cancel-bottom').forEach((button) => {
      button.addEventListener('click', () => {
        editingId = null;
        render();
      });
    });
    container.querySelector('#sp-form-save')?.addEventListener('click', async () => {
      const payload = collectPayload();
      if (!payload) return;
      const isEdit = editingId !== '__new__';
      try {
        if (isEdit) {
          const result = await fetchJSON(`/api/system-prompts/${encodeURIComponent(payload.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const idx = (state.systemPrompts || []).findIndex((item) => item.id === payload.id);
          if (idx !== -1) state.systemPrompts[idx] = normalizePrompt(result);
        } else {
          const result = await fetchJSON('/api/system-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          state.systemPrompts = [...(state.systemPrompts || []), normalizePrompt(result)];
        }
        editingId = null;
        render();
      } catch (err) {
        console.error('Save system prompt failed:', err);
        showFeedback(`Failed to save: ${err.message}`, 'error');
      }
    });
  }

  return {
    loadSystemPrompts,
    render,
  };
}