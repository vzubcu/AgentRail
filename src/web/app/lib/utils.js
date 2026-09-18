export const supportedTestImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function getProviderHealthState(provider) {
  return provider.health?.state ?? (provider.available ? 'configured' : 'missing_key');
}

export function getProviderKeySummary(state, provider) {
  return state.keySummaries?.[provider.apiKeyEnvVar] ?? {
    configured: false,
    managedCount: 0,
    environmentCount: 0,
    effectiveCount: 0,
    keys: [],
  };
}

export function getEnvVarSummary(state, envVar) {
  return state.keySummaries?.[envVar] ?? {
    configured: false,
    managedCount: 0,
    environmentCount: 0,
    effectiveCount: 0,
    keys: [],
  };
}

export function isCloudflareProvider(provider) {
  return provider?.name === 'cloudflare' && provider?.apiKeyEnvVar === 'CLOUDFLARE_API_KEY';
}

export function getProviderFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/providers\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function providerPath(providerName) {
  return `/providers/${encodeURIComponent(providerName)}`;
}

export function extractOpenAIStreamContent(eventText) {
  let content = '';

  for (const line of eventText.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;

    const data = line.slice(5).trimStart();
    if (!data || data === '[DONE]') continue;

    try {
      const payload = JSON.parse(data);
      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        content += delta;
      }
    } catch {
      // Ignore malformed stream events and continue displaying valid deltas.
    }
  }

  return content;
}

export function readOpenAIStreamEvents(buffer, flush = false) {
  const events = buffer.split(/(?:\r?\n){2}/);
  const pending = flush ? '' : events.pop() ?? '';

  return {
    text: events.map(extractOpenAIStreamContent).join(''),
    pending,
  };
}

export function formatProviderNames(names) {
  if (!Array.isArray(names) || names.length === 0) return 'none';
  return names.join(', ');
}

export function getRouteMeta(stateKey) {
  const meta = {
    healthy: {
      role: 'Active route',
      tone: 'healthy',
      headline: 'Ready for traffic',
      description: 'This provider can receive routed requests.',
      laneStatus: '200 OK',
    },
    configured: {
      role: 'Pending check',
      tone: 'configured',
      headline: 'Key configured',
      description: 'Run a health check before using this route.',
      laneStatus: 'untested',
    },
    unhealthy: {
      role: 'Unavailable',
      tone: 'unhealthy',
      headline: 'Route failing',
      description: 'AgentRail should avoid this route until it recovers.',
      laneStatus: 'failed',
    },
    missing_key: {
      role: 'Key required',
      tone: 'missing_key',
      headline: 'Not configured',
      description: 'Add a provider key to enable this route.',
      laneStatus: 'no key',
    },
  };

  return meta[stateKey] ?? {
    role: 'Unknown',
    tone: 'missing_key',
    headline: 'Unknown state',
    description: 'Provider state is not available.',
    laneStatus: 'unknown',
  };
}

export function getLatencyTone(ms) {
  if (ms === null || ms === undefined) return 'muted';
  if (ms < 800) return 'good';
  if (ms < 2500) return 'warn';
  return 'bad';
}

export function getProviderInitials(name) {
  return String(name ?? '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'P';
}
