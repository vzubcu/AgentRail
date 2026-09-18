import { readOpenAIStreamEvents } from '../../lib/utils.js';
import { cloneAttachmentForThread } from './attachments.js';
import { toStatusEvent } from '../../lib/request-status.js';

export function createRequestFeature({
  state,
  withGatewayAuthHeaders,
  renderAttachmentQueue,
  renderThread,
  addErrorToTestThread,
  reportStatus = () => {},
}) {
  function getSelectedTestModelRecord() {
    const select = document.getElementById('test-model');
    const selectedValue = select?.value || '';
    const directModel = state.models.find(entry => entry.id === selectedValue);
    const slashIndex = selectedValue.indexOf('/');
    const modelId = directModel ? selectedValue : (slashIndex > 0 ? selectedValue.slice(slashIndex + 1) : selectedValue);
    const model = directModel || state.models.find(entry => entry.id === modelId);
    return { selectedValue, model };
  }

  async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function buildTestUserContent(message, attachments) {
    if (attachments.length === 0) {
      return message;
    }

    const content = [];
    if (message) {
      content.push({ type: 'text', text: message });
    }

    for (const attachment of attachments) {
      const dataUrl = await readFileAsDataUrl(attachment.file);
      if (attachment.kind === 'image') {
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
        content.push({
          type: 'attachment_metadata',
          filename: attachment.name,
          mime_type: attachment.type,
          size_bytes: attachment.size,
          source: 'dashboard',
          status: 'queued',
        });
        continue;
      }

      content.push({
        type: 'input_file',
        filename: attachment.name,
        mime_type: attachment.type || 'application/pdf',
        data: dataUrl,
      });
      content.push({
        type: 'attachment_metadata',
        filename: attachment.name,
        mime_type: attachment.type || 'application/pdf',
        size_bytes: attachment.size,
        source: 'dashboard',
        status: 'queued',
      });
    }

    return content;
  }

  function getResponseText(payload) {
    const choice = payload?.choices?.[0]?.message;
    if (!choice) return '';
    if (typeof choice.content === 'string') return choice.content;
    if (Array.isArray(choice.content)) {
      return choice.content
        .map(part => part?.text || '')
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  function buildConversationMessages() {
    return state.testConversation
      .filter(entry => !entry.pending)
      .map(entry => ({ role: entry.role, content: entry.content }));
  }

  async function sendTestRequest() {
    const resultContent = document.getElementById('result-content');
    const routeInfo = document.getElementById('route-info');
    const model = document.getElementById('test-model').value;
    const messageInput = document.getElementById('test-message');
    const message = messageInput.value.trim();
    const temperature = Number(document.getElementById('test-temp').value);
    const maxTokens = Number(document.getElementById('test-max-tokens').value);
    const stream = document.getElementById('test-stream').checked;
    const attachments = [...state.queuedTestAttachments];

    if (!message && attachments.length === 0) {
      reportStatus(toStatusEvent({ level: 'warning', message: 'Enter a message or attach at least one file.' }));
      return;
    }

    const selectedModel = getSelectedTestModelRecord();
    const capabilities = selectedModel.model?.capabilities || [];
    if (attachments.some(attachment => attachment.kind === 'image') && !capabilities.includes('vision')) {
      reportStatus(toStatusEvent({ level: 'warning', message: 'The selected model does not advertise vision support. Choose a vision-capable model for image attachments.' }));
      return;
    }

    resultContent.textContent = 'Loading...';
    routeInfo.textContent = '';

    let userContent;
    try {
      userContent = await buildTestUserContent(message, attachments);
    } catch (error) {
      resultContent.textContent = error.message;
      return;
    }

    const userEntry = {
      id: crypto.randomUUID(),
      role: 'user',
      text: message,
      attachments: attachments.map(cloneAttachmentForThread),
      content: userContent,
      requestedModel: model,
      routeModel: model,
    };

    state.testConversation.push(userEntry);
    state.queuedTestAttachments = [];
    renderAttachmentQueue();
    renderThread();
    messageInput.value = '';

    try {
      if (stream) {
        const assistantEntry = {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: '',
          attachments: [],
          content: '',
          pending: true,
          requestedModel: model,
          routeModel: model,
        };
        state.testConversation.push(assistantEntry);
        renderThread();

        const response = await fetch('/v1/chat/completions', {
          method: 'POST',
          credentials: 'same-origin',
          headers: withGatewayAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            model,
            messages: buildConversationMessages(),
            temperature,
            max_tokens: maxTokens,
            stream: true,
          }),
        });

        if (!response.ok || !response.body) {
          state.testConversation.pop();
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error?.message ?? `Request failed: ${response.status}`);
        }

        const provider = response.headers.get('X-AgentRail-Provider') ?? 'unknown';
        const routeModel = response.headers.get('X-AgentRail-Route-Model') ?? model;
        const attachmentSummary = response.headers.get('X-AgentRail-Attachments');
        assistantEntry.routeModel = routeModel;
        routeInfo.textContent = `Provider: ${provider} · Request model: ${model} · Route model: ${routeModel}${attachmentSummary ? ` · Attachments: ${attachmentSummary}` : ''}`;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';
        let full = '';
        resultContent.textContent = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamBuffer += decoder.decode(value, { stream: true });
            const parsed = readOpenAIStreamEvents(streamBuffer);
            streamBuffer = parsed.pending;
            if (parsed.text) {
              full += parsed.text;
              assistantEntry.text = full;
              assistantEntry.content = full;
              resultContent.textContent = full;
              renderThread();
            }
          }

          streamBuffer += decoder.decode();
          const parsed = readOpenAIStreamEvents(streamBuffer, true);
          if (parsed.text) {
            full += parsed.text;
            assistantEntry.text = full;
            assistantEntry.content = full;
            resultContent.textContent = full;
            renderThread();
          }
        } finally {
          reader.releaseLock();
        }

        assistantEntry.pending = false;
        renderThread();
        return;
      }

      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: withGatewayAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model,
          messages: buildConversationMessages(),
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error?.message ?? `Request failed: ${response.status}`);
      }

      const provider = response.headers.get('X-AgentRail-Provider') ?? 'unknown';
      const routeModel = response.headers.get('X-AgentRail-Route-Model') ?? model;
      const attachmentSummary = response.headers.get('X-AgentRail-Attachments');
      const payload = await response.json();
      const actualModel = payload.model ?? 'unknown';
      routeInfo.textContent = `Provider: ${provider} · Request model: ${model} · Route model: ${routeModel} · Actual model: ${actualModel}${attachmentSummary ? ` · Attachments: ${attachmentSummary}` : ''}`;
      resultContent.textContent = JSON.stringify(payload, null, 2);
      state.testConversation.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: getResponseText(payload),
        attachments: [],
        content: getResponseText(payload),
        requestedModel: model,
        routeModel,
      });
      renderThread();
    } catch (error) {
      resultContent.textContent = error.message;
      routeInfo.textContent = '';
      addErrorToTestThread(error.message, model);
      reportStatus(toStatusEvent(error));
    }
  }

  return {
    getSelectedTestModelRecord,
    buildTestUserContent,
    getResponseText,
    buildConversationMessages,
    sendTestRequest,
  };
}
