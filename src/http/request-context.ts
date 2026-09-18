import http from 'node:http';
import crypto from 'node:crypto';
import type { CreateServerOptions, RequestContext } from './types.js';
import type { ServerConfig } from './config.js';
import { sendJSON } from './responses.js';

export type JsonBodyParseResult<T> =
  | { ok: true; value: T }
  | { ok: false };

export function createRequestContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: CreateServerOptions,
  config: ServerConfig,
  trace: (event: string, payload?: Record<string, unknown>) => void,
): RequestContext {
  const requestUrl = req.url ?? '/';
  const pathname = new URL(requestUrl, `http://${req.headers.host ?? 'localhost'}`).pathname;
  const requestId = crypto.randomUUID();
  return { req, res, requestId, startedAt: Date.now(), requestUrl, pathname, options, config, trace };
}

export function getHeader(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}

export function authHeaderMode(req: http.IncomingMessage): 'none' | 'bearer' | 'other' {
  const auth = req.headers.authorization;
  if (!auth) return 'none';
  if (/^Bearer\s+/i.test(auth)) return 'bearer';
  return 'other';
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function isAllowedLocalOrigin(req: http.IncomingMessage): boolean {
  const origin = getHeader(req, 'origin');
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    return (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') && isLocalHostname(originUrl.hostname);
  } catch {
    return false;
  }
}

export function applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = getHeader(req, 'origin');
  res.setHeader('Vary', 'Origin');

  if (!origin) {
    return true;
  }

  if (!isAllowedLocalOrigin(req)) {
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  return true;
}

export async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function readBodyBuffer(req: http.IncomingMessage, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (maxBytes !== undefined && totalBytes > maxBytes) throw new Error('Request body exceeds size limit');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

export function parseJsonBody<T>(raw: string, res: http.ServerResponse): JsonBodyParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    sendJSON(res, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } });
    return { ok: false };
  }
}
