import http from 'node:http';
import { routeChatCompletion as defaultRouteChatCompletion } from '../router.js';
import { logStartupRoutes, prepareRuntimeForStartup, startBackgroundModelRefresh } from '../server-runtime.js';
import { getServerConfig } from './config.js';
import type { CreateServerOptions } from './types.js';
import { applyCorsHeaders, createRequestContext } from './request-context.js';
import { sendJSON } from './responses.js';
import { checkManagementAccess, isManagementRequest } from './access.js';
import { handleStaticUiRoute } from './routes/static-ui.js';
import { handleSaasDelegatedRoute } from './routes/saas.js';
import { handleManagementRoute } from './routes/management.js';
import { handleMcpServersRoute } from './routes/mcp-servers.js';
import { handleSystemPromptsRoute } from './routes/system-prompts.js';
import { handleVirtualModelsRoute } from './routes/virtual-models.js';
import { handleModelsRoute } from './routes/models.js';
import { handleConfigKeysRoute } from './routes/config-keys.js';
import { handleOpenAIRoute } from './routes/openai.js';
import { handleSpecialtyRoute } from './routes/specialty.js';
import { handleAnthropicRoute } from './routes/anthropic.js';
import { handleOAuthRoute } from './routes/oauth.js';

function createTrace(debugTrace: boolean) {
  return (event: string, payload?: Record<string, unknown>) => {
    if (!debugTrace) return;
    const ts = new Date().toISOString();
    if (!payload) {
      console.log(`[Trace ${ts}] ${event}`);
      return;
    }
    console.log(`[Trace ${ts}] ${event} ${JSON.stringify(payload)}`);
  };
}

function summarizeHeaders(req: http.IncomingMessage): Record<string, unknown> {
  return {
    contentType: req.headers['content-type'] ?? '',
    contentLength: req.headers['content-length'] ?? '',
    userAgent: req.headers['user-agent'] ?? '',
    origin: req.headers.origin ?? '',
    hasAuthorization: Boolean(req.headers.authorization),
    hasApiKeyHeader: typeof req.headers['x-api-key'] === 'string',
    hasCookie: Boolean(req.headers.cookie),
  };
}

export function createServer(options: CreateServerOptions = {}): http.Server {
  const config = getServerConfig();
  const trace = createTrace(config.debugTrace);
  const resolvedOptions: CreateServerOptions = {
    ...options,
    routeChatCompletion: options.routeChatCompletion ?? defaultRouteChatCompletion,
  };

  const handlers = [
    handleStaticUiRoute,
    handleSaasDelegatedRoute,
    handleManagementRoute,
    handleMcpServersRoute,
    handleSystemPromptsRoute,
    handleVirtualModelsRoute,
    handleModelsRoute,
    handleConfigKeysRoute,
    handleOpenAIRoute,
    handleSpecialtyRoute,
    handleAnthropicRoute,
    handleOAuthRoute,
  ];

  return http.createServer(async (req, res) => {
    const corsAllowed = applyCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(corsAllowed ? 204 : 403);
      res.end();
      return;
    }

    const ctx = createRequestContext(req, res, resolvedOptions, config, trace);
    let finished = false;
    res.once('finish', () => {
      finished = true;
      trace('request.out', {
        requestId: ctx.requestId,
        method: req.method ?? 'UNKNOWN',
        pathname: ctx.pathname,
        status: res.statusCode,
        durationMs: Date.now() - ctx.startedAt,
        contentLength: res.getHeader('Content-Length') ?? null,
        provider: res.getHeader('X-AgentRail-Provider') ?? null,
        routeModel: res.getHeader('X-AgentRail-Route-Model') ?? null,
        virtualModel: res.getHeader('X-AgentRail-Virtual-Model') ?? null,
      });
    });
    res.once('close', () => {
      if (finished) return;
      trace('request.closed', {
        requestId: ctx.requestId,
        method: req.method ?? 'UNKNOWN',
        pathname: ctx.pathname,
        status: res.statusCode,
        durationMs: Date.now() - ctx.startedAt,
      });
    });
    trace('request.in', {
      requestId: ctx.requestId,
      method: req.method ?? 'UNKNOWN',
      url: ctx.requestUrl,
      pathname: ctx.pathname,
      headers: summarizeHeaders(req),
    });

    try {
      if (isManagementRequest(ctx.pathname, req.method) && !(await checkManagementAccess(ctx))) {
        return;
      }

      for (const handler of handlers) {
        if (await handler(ctx)) {
          return;
        }
      }

      sendJSON(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      trace('request.error', {
        requestId: ctx.requestId,
        method: req.method ?? 'UNKNOWN',
        pathname: ctx.pathname,
        durationMs: Date.now() - ctx.startedAt,
        errorName: err instanceof Error ? err.name : typeof err,
        message,
      });
      sendJSON(res, 500, { error: { message, type: 'internal_error' } });
    }
  });
}

export async function startServer(): Promise<void> {
  const config = getServerConfig();

  await prepareRuntimeForStartup({
    allowedEnvVars: config.allowedEnvVars,
    saasMode: config.saasMode,
  });

  startBackgroundModelRefresh();

  const server = createServer();
  server.listen(config.port, config.host, () => {
    logStartupRoutes({
      host: config.host,
      port: config.port,
      saasMode: config.saasMode,
    });
  });
}
