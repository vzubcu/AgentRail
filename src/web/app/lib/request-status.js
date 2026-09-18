export function toStatusEvent(input, fallback = {}) {
  if (input && typeof input === 'object' && 'level' in input && 'message' in input) {
    return {
      level: input.level || fallback.level || 'info',
      message: input.message || fallback.message || '',
      details: input.details ?? fallback.details ?? null,
    };
  }

  if (input instanceof Error) {
    return {
      level: fallback.level || 'error',
      message: input.message || fallback.message || 'Request failed',
      details: {
        status: input.status ?? null,
        type: input.type ?? 'request_error',
        ...(input.details ?? {}),
      },
    };
  }

  return {
    level: fallback.level || 'info',
    message: fallback.message || String(input || ''),
    details: fallback.details ?? null,
  };
}

export function createRequestStatusReporter({ escapeHtml, formatTime }) {
  function renderDetails(details) {
    if (!details || typeof details !== 'object') {
      return '';
    }

    const entries = Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        const renderedValue = key.toLowerCase().includes('at') && typeof value === 'number'
          ? formatTime(value)
          : Array.isArray(value)
            ? value.join(', ')
            : String(value);
        return `<div class="request-status-detail"><span>${escapeHtml(key)}</span><code>${escapeHtml(renderedValue)}</code></div>`;
      });

    if (entries.length === 0) {
      return '';
    }

    return `<div class="request-status-details">${entries.join('')}</div>`;
  }

  return function reportStatus(event) {
    const region = document.getElementById('request-status-region');
    if (!region) return;

    if (!event) {
      region.hidden = true;
      region.innerHTML = '';
      return;
    }

    const normalized = toStatusEvent(event);
    region.hidden = false;
    region.innerHTML = `
      <div class="request-status-banner request-status-${escapeHtml(normalized.level)}">
        <div class="request-status-message">${escapeHtml(normalized.message)}</div>
        ${renderDetails(normalized.details)}
      </div>
    `;
  };
}
