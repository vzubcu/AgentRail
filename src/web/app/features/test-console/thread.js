import { revokeTestAttachmentPreview } from './attachments.js';

export function formatTestThreadEntryLabel(entry) {
  const routeModel = entry.routeModel || entry.requestedModel || 'unknown';
  if (entry.kind === 'error') return `error ← ${routeModel}`;
  if (entry.role === 'assistant') return `assistant ← ${routeModel}`;
  if (entry.role === 'user') return `user → ${entry.requestedModel || routeModel}`;
  return `${entry.role} → ${routeModel}`;
}

export function createThreadFeature({ state, escapeHtml, formatBytes }) {
  function renderThread() {
    const root = document.getElementById('test-thread');
    if (!root) return;

    if (state.testConversation.length === 0) {
      root.innerHTML = '<div class="test-thread-empty">The thread is empty. Compose a user turn, attach files if needed, and send it through the gateway.</div>';
      return;
    }

    root.innerHTML = state.testConversation.map(entry => {
      const attachmentHtml = (entry.attachments || []).length > 0
        ? `<div class="test-thread-attachments">${entry.attachments.map(attachment => `
            <div class="test-thread-attachment-chip">
              <span>${escapeHtml(attachment.name)}</span>
              <small>${escapeHtml(attachment.status)} · ${escapeHtml(formatBytes(attachment.size))}</small>
            </div>`).join('')}</div>`
        : '';
      const body = entry.text ? escapeHtml(entry.text).replace(/\n/g, '<br>') : '<em>No text body.</em>';
      const meta = entry.pending ? 'Streaming…' : entry.kind === 'error' ? 'Gateway error' : 'Committed';
      return `
        <article class="test-thread-message ${escapeHtml(entry.role)} ${entry.kind === 'error' ? 'error' : ''}">
          <div class="test-thread-role">
            <strong class="test-thread-role-label">${escapeHtml(formatTestThreadEntryLabel(entry))}</strong>
            <span>${escapeHtml(meta)}</span>
          </div>
          <div class="test-thread-body">${body}</div>
          ${attachmentHtml}
        </article>`;
    }).join('');
  }

  function clearConversation() {
    state.queuedTestAttachments.forEach(revokeTestAttachmentPreview);
    state.queuedTestAttachments = [];
    state.testConversation = [];
    const resultContent = document.getElementById('result-content');
    const routeInfo = document.getElementById('route-info');
    const messageInput = document.getElementById('test-message');
    if (resultContent) resultContent.textContent = '';
    if (routeInfo) routeInfo.textContent = '';
    if (messageInput) messageInput.value = '';
    renderThread();
  }

  function addErrorToTestThread(message, routeModel) {
    state.testConversation.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      text: `Error: ${message}`,
      attachments: [],
      content: `Error: ${message}`,
      kind: 'error',
      routeModel: routeModel || '',
    });
    renderThread();
  }

  return {
    renderThread,
    clearConversation,
    addErrorToTestThread,
  };
}
