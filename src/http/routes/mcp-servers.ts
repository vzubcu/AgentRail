import { readBody, parseJsonBody } from '../request-context.js';
import { sendJSON } from '../responses.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import type { RequestContext } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, './mcp-config.json');

interface McpServer {
  id: string;
  name: string;
  endpoint: string;
  [key: string]: unknown;
}

interface McpConfig {
  servers: McpServer[];
}

async function loadServers(): Promise<McpConfig> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(data) as McpConfig;
  } catch {
    return { servers: [] };
  }
}

async function saveServers(config: McpConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function handleMcpServersRoute(ctx: RequestContext): Promise<boolean> {
  const basePath = '/api/mcp-servers';
  if (!ctx.pathname.startsWith(basePath)) return false;

  if (ctx.req.method === 'GET' && ctx.pathname === basePath) {
    const { servers } = await loadServers();
    sendJSON(ctx.res, 200, servers);
    return true;
  }

  if (ctx.req.method === 'POST' && ctx.pathname === basePath) {
    const raw = await readBody(ctx.req);
    const parsed = await parseJsonBody<Partial<McpServer>>(raw, ctx.res);
    if (!parsed.ok) return true;

    const newServer = parsed.value;
    if (!newServer.name || !newServer.endpoint) {
      sendJSON(ctx.res, 400, { error: { message: 'name and endpoint are required', type: 'invalid_request_error' } });
      return true;
    }

    const config = await loadServers();
    config.servers ??= [];
    // Ensure unique ID (simple timestamp-based)
    const baseId = Date.now().toString();
    let id = baseId;
    let counter = 0;
    const existingIds = new Set(config.servers.map(s => s.id));
    while (existingIds.has(id)) {
      counter++;
      id = `${baseId}-${counter}`;
    }
    newServer.id = id;
    config.servers.push(newServer as McpServer);
    await saveServers(config);

    sendJSON(ctx.res, 201, { server: newServer });
    return true;
  }

  // Individual server operations: /api/mcp-servers/:id
  if (ctx.pathname.startsWith(basePath + '/')) {
    const id = decodeURIComponent(ctx.pathname.slice(basePath.length + 1));
    if (!id) {
      sendJSON(ctx.res, 400, { error: { message: 'Invalid server ID', type: 'invalid_request_error' } });
      return true;
    }

    if (ctx.req.method === 'GET') {
      const config = await loadServers();
      const server = config.servers.find(s => s.id === id);
      if (!server) {
        sendJSON(ctx.res, 404, { error: { message: 'Server not found', type: 'not_found_error' } });
        return true;
      }
      sendJSON(ctx.res, 200, { server });
      return true;
    }

    if (ctx.req.method === 'PUT') {
      const raw = await readBody(ctx.req);
      const parsed = await parseJsonBody<Partial<McpServer>>(raw, ctx.res);
      if (!parsed.ok) return true;

      const updates = parsed.value;
      const config = await loadServers();
      const index = config.servers.findIndex(s => s.id === id);
      if (index === -1) {
        sendJSON(ctx.res, 404, { error: { message: 'Server not found', type: 'not_found_error' } });
        return true;
      }
      // Update fields, keep id
      const updated: McpServer = { ...config.servers[index], ...updates, id };
      config.servers[index] = updated;
      await saveServers(config);
      sendJSON(ctx.res, 200, { server: updated });
      return true;
    }

    if (ctx.req.method === 'DELETE') {
      const config = await loadServers();
      const index = config.servers.findIndex(s => s.id === id);
      if (index === -1) {
        sendJSON(ctx.res, 404, { error: { message: 'Server not found', type: 'not_found_error' } });
        return true;
      }
      const [deleted] = config.servers.splice(index, 1);
      await saveServers(config);
      sendJSON(ctx.res, 200, { server: deleted });
      return true;
    }
  }

  return false;
}