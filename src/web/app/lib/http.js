const gatewayKeyStorageKey = 'agentrail.gatewayKey';

function createRequestError(message, extras = {}) {
  const error = new Error(message);
  Object.assign(error, {
    status: null,
    type: 'request_error',
    details: null,
    retryable: false,
    cause: undefined,
    ...extras,
  });
  return error;
}

function isNetworkError(error) {
  return error instanceof TypeError || error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

function isRetryableStatus(status, retryStatuses = []) {
  return retryStatuses.includes(status) || status === 408 || status === 429 || status >= 500;
}

async function parseErrorResponse(response) {
  const payload = await response.json().catch(() => ({}));
  const details = payload?.error?.details ?? null;
  return createRequestError(payload?.error?.message ?? `Request failed: ${response.status}`, {
    status: response.status,
    type: payload?.error?.type ?? 'request_error',
    details,
    retryable: isRetryableStatus(response.status),
  });
}

function normalizeNetworkError(error) {
  if (error?.type === 'request_error' || error?.status !== undefined) {
    return error;
  }

  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return createRequestError('Request timed out before the provider responded.', {
      status: null,
      type: 'timeout_error',
      details: null,
      retryable: true,
      cause: error,
    });
  }

  if (isNetworkError(error)) {
    return createRequestError('Network request failed before the provider responded.', {
      status: null,
      type: 'network_error',
      details: null,
      retryable: true,
      cause: error,
    });
  }

  return error;
}

async function performJSONRequest(url, options = {}, gatewayKey) {
  const {
    retry,
    timeoutMs,
    ...fetchOptions
  } = options ?? {};
  const retries = Math.max(0, Number(retry?.retries ?? 0));
  const retryStatuses = Array.isArray(retry?.retryStatuses) ? retry.retryStatuses : [];
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        credentials: 'same-origin',
        headers: withGatewayAuthHeaders(fetchOptions?.headers ?? {}, gatewayKey),
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });

      if (!response.ok) {
        const error = await parseErrorResponse(response);
        if (attempt < retries && isRetryableStatus(response.status, retryStatuses)) {
          lastError = error;
          continue;
        }
        throw error;
      }

      if (response.status === 204) {
        return null;
      }

      const text = await response.text();
      if (!text) {
        return null;
      }
      return JSON.parse(text);
    } catch (error) {
      const normalized = normalizeNetworkError(error);
      if (attempt < retries && normalized?.retryable) {
        lastError = normalized;
        continue;
      }
      throw normalized;
    }
  }

  throw lastError ?? createRequestError('Request failed');
}

export function getStoredGatewayKey() {
  try {
    return window.localStorage.getItem(gatewayKeyStorageKey) || '';
  } catch {
    return '';
  }
}

export function setStoredGatewayKey(value) {
  try {
    if (value) {
      window.localStorage.setItem(gatewayKeyStorageKey, value);
    } else {
      window.localStorage.removeItem(gatewayKeyStorageKey);
    }
  } catch {
    // Ignore storage failures; users can still rely on environment variables.
  }
}

export function withGatewayAuthHeaders(headers = {}, gatewayKey = getStoredGatewayKey()) {
  const nextHeaders = new Headers(headers);
  if (gatewayKey && !nextHeaders.has('Authorization') && !nextHeaders.has('x-api-key')) {
    nextHeaders.set('Authorization', `Bearer ${gatewayKey}`);
  }
  return nextHeaders;
}

export async function fetchJSON(url, options) {
  return performJSONRequest(url, options);
}

export async function fetchJSONWithGatewayKey(url, options, gatewayKey) {
  return performJSONRequest(url, options, gatewayKey);
}
