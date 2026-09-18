import { supportedTestImageTypes } from '../../lib/utils.js';

export function getTestAttachmentKind(file) {
  if (supportedTestImageTypes.has(file.type)) return 'image';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'unsupported';
}

export function cloneAttachmentForThread(attachment) {
  return {
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    kind: attachment.kind,
    status: attachment.status,
  };
}

export function revokeTestAttachmentPreview(attachment) {
  if (attachment?.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function createAttachmentQueueFeature({ state, escapeHtml, formatBytes }) {
  function renderAttachmentQueue() {
    const root = document.getElementById('test-attachment-queue');
    if (!root) return;

    if (state.queuedTestAttachments.length === 0) {
      root.innerHTML = '<div class="test-thread-empty">No pending attachments. Add images or PDFs to the next user turn.</div>';
      return;
    }

    root.innerHTML = state.queuedTestAttachments.map(attachment => {
      const media = attachment.previewUrl
        ? `<img class="test-attachment-thumb" src="${escapeHtml(attachment.previewUrl)}" alt="${escapeHtml(attachment.name)}">`
        : '<div class="test-attachment-icon">PDF</div>';

      return `
        <div class="test-attachment-item">
          ${media}
          <div class="test-attachment-meta">
            <strong>${escapeHtml(attachment.name)}</strong>
            <small>${escapeHtml(attachment.status)} · ${escapeHtml(formatBytes(attachment.size))}</small>
          </div>
          <button class="btn-secondary test-attachment-remove" type="button" data-remove-test-attachment="${escapeHtml(attachment.id)}">Remove</button>
        </div>`;
    }).join('');

    root.querySelectorAll('[data-remove-test-attachment]').forEach(button => {
      button.addEventListener('click', () => {
        const attachmentId = button.getAttribute('data-remove-test-attachment');
        const index = state.queuedTestAttachments.findIndex(item => item.id === attachmentId);
        if (index === -1) return;
        revokeTestAttachmentPreview(state.queuedTestAttachments[index]);
        state.queuedTestAttachments.splice(index, 1);
        renderAttachmentQueue();
      });
    });
  }

  async function handleAttachmentSelection(event) {
    const files = Array.from(event.target?.files || []);
    const unsupported = [];

    for (const file of files) {
      const kind = getTestAttachmentKind(file);
      if (kind === 'unsupported') {
        unsupported.push(file.name);
        continue;
      }

      state.queuedTestAttachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        kind,
        status: kind === 'image' ? 'Ready · image inline' : 'Ready · PDF extract on send',
        previewUrl: kind === 'image' ? URL.createObjectURL(file) : '',
        file,
      });
    }

    if (event.target) {
      event.target.value = '';
    }

    renderAttachmentQueue();
    if (unsupported.length > 0) {
      alert(`Unsupported attachments skipped: ${unsupported.join(', ')}`);
    }
  }

  return {
    renderAttachmentQueue,
    handleAttachmentSelection,
  };
}
