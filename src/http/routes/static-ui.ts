import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestContext } from '../types.js';
import { sendJSON, sendText } from '../responses.js';

const DASHBOARD_PARTIAL_RE = /<!--\s*partial:([a-z0-9-]+)\s*-->/gi;

async function composeDashboardHtml(webRoot: string): Promise<string> {
  const templatesRoot = path.join(webRoot, 'templates');
  const shell = await readFile(path.join(templatesRoot, 'dashboard.html'), 'utf-8');

  const partialNames = Array.from(shell.matchAll(DASHBOARD_PARTIAL_RE), (match) => match[1]);
  const uniquePartialNames = [...new Set(partialNames)];

  if (!uniquePartialNames.length) {
    return shell;
  }

  const partialEntries = await Promise.all(
    uniquePartialNames.map(async (partialName) => {
      const partialPath = path.join(templatesRoot, 'partials', `${partialName}.html`);
      const partialContent = await readFile(partialPath, 'utf-8');
      return [partialName, partialContent] as const;
    }),
  );

  const partialMap = new Map(partialEntries);

  return shell.replace(DASHBOARD_PARTIAL_RE, (_match, partialName: string) => partialMap.get(partialName) ?? '');
}

/** Check if a request to the root path is a Gemini OAuth callback (has code or error params). */
function isOAuthCallbackRedirect(ctx: RequestContext): boolean {
  if (ctx.pathname !== '/' && ctx.pathname !== '/index.html') return false;
  // For Gemini desktop app OAuth, Google redirects to http://localhost:PORT/?code=...&state=...
  const url = new URL(ctx.requestUrl, `http://${ctx.config.host}:${ctx.config.port}`);
  return url.searchParams.has('code') || url.searchParams.has('error');
}

function isDashboardRoutePath(ctx: RequestContext): boolean {
  return (
    ctx.config.dashboardRoutePaths.has(ctx.pathname) ||
    ctx.pathname.startsWith('/providers/') ||
    ctx.pathname === '/virtual-models/new' ||
    /^\/virtual-models\/edit\/.+$/.test(ctx.pathname)
  );
}

export async function handleStaticUiRoute(ctx: RequestContext): Promise<boolean> {
  // If this is an OAuth callback redirect (Gemini), skip static serving and let the OAuth handler process it
  if (isOAuthCallbackRedirect(ctx)) {
    return false;
  }

  if (ctx.config.publicRoutePaths.has(ctx.pathname)) {
    const html = await readFile(path.join(ctx.config.webRoot, 'templates', 'index.html'), 'utf-8');
    sendText(ctx.res, 200, html, 'text/html; charset=utf-8');
    return true;
  }

  if (isDashboardRoutePath(ctx)) {
    const html = await composeDashboardHtml(ctx.config.webRoot);
    sendText(ctx.res, 200, html, 'text/html; charset=utf-8');
    return true;
  }

  if (!ctx.pathname.startsWith('/static/')) {
    return false;
  }

  const requestedPath = decodeURIComponent(ctx.pathname.slice('/static/'.length));
  const safePath = path.normalize(requestedPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.resolve(ctx.config.staticRoot, safePath);

  if (!filePath.startsWith(ctx.config.staticRoot + path.sep) && filePath !== ctx.config.staticRoot) {
    sendJSON(ctx.res, 403, { error: { message: 'Forbidden', type: 'invalid_request_error' } });
    return true;
  }

  const content = await readFile(filePath);
  const ext = path.extname(filePath);
  const contentType = ext === '.css'
    ? 'text/css; charset=utf-8'
    : ext === '.js'
      ? 'application/javascript; charset=utf-8'
      : 'application/octet-stream';

  ctx.res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
  ctx.res.end(content);
  return true;
}
