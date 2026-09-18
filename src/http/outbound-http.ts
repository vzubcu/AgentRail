let configured = false;

// Default connection pool settings (can be overridden via env)
const DEFAULT_CONNECTIONS = Number(process.env.AGENTRAIL_HTTP_CONNECTIONS) || 100;
const DEFAULT_KEEP_ALIVE_TIMEOUT = Number(process.env.AGENTRAIL_HTTP_KEEP_ALIVE_MS) || 30000;
const DEFAULT_KEEP_ALIVE_MAX_TIMEOUT = Number(process.env.AGENTRAIL_HTTP_KEEP_ALIVE_MAX_MS) || 60000;
const DEFAULT_PIPELINING = Number(process.env.AGENTRAIL_HTTP_PIPELINING) || 10;

export async function configureOutboundHttp(): Promise<void> {
  if (configured) return;
  configured = true;

  try {
    // @ts-ignore - undici is bundled with Node.js 18+
    const undici = await import('undici');
    const allowInsecureProxyTls = process.env.AGENTRAIL_ALLOW_INSECURE_PROXY_TLS === '1';

    if (allowInsecureProxyTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      console.warn('[TLS] Insecure upstream TLS verification is disabled for fetch() calls');
    }

    // Configure connection pooling with keep-alive for all outbound requests
    // This provides significant latency reduction by reusing TCP/TLS connections
    if (undici.Agent && undici.setGlobalDispatcher) {
      const agentOptions = {
        connections: DEFAULT_CONNECTIONS,
        keepAliveTimeout: DEFAULT_KEEP_ALIVE_TIMEOUT,
        keepAliveMaxTimeout: DEFAULT_KEEP_ALIVE_MAX_TIMEOUT,
        pipelining: DEFAULT_PIPELINING,
        // Allow insecure TLS if configured
        ...(allowInsecureProxyTls ? { connect: { rejectUnauthorized: false } } : {}),
      };

      // If proxy is configured, wrap with ProxyAgent
      if (process.env.HTTP_PROXY && undici.ProxyAgent) {
        // ProxyAgent only takes the proxy URL, options are not supported in this version
        undici.setGlobalDispatcher(new undici.ProxyAgent(process.env.HTTP_PROXY));
        console.log(`[HTTP] Proxy enabled: ${process.env.HTTP_PROXY}`);
      } else {
        undici.setGlobalDispatcher(new undici.Agent(agentOptions));
        console.log(`[HTTP] Connection pooling enabled: ${DEFAULT_CONNECTIONS} connections, ${DEFAULT_KEEP_ALIVE_TIMEOUT}ms keep-alive`);
      }
    }
  } catch (err) {
    // undici not available, skip proxy/pooling setup
    console.warn('[HTTP] undici not available, connection pooling disabled:', err instanceof Error ? err.message : String(err));
  }
}
