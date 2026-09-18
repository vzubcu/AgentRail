#!/usr/bin/env node
/**
 * AgentRail MCP server entry point.
 *
 * Exposes AgentRail gateway capabilities as MCP tools over stdio.
 *
 * Usage:
 * - npx -y @vzubcu/agentrail-mcp
 * - or: node dist/mcp/index.js
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildTools } from './tools.js';
import type { McpEnvConfig } from './types.js';

function readEnv(): McpEnvConfig {
  const agentrailUrl = process.env.AGENTRAIL_URL ?? 'http://localhost:42424';
  const agentrailApiKey = process.env.AGENTRAIL_API_KEY;
  const timeoutMs = Number(process.env.AGENTRAIL_TIMEOUT_MS ?? '30000');

  return { agentrailUrl, agentrailApiKey, timeoutMs };
}

function createServer(): Server {
  const env = readEnv();
  const tools = buildTools(env);

  const server = new Server(
    {
      name: 'agentrail-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.onerror = error => console.error('[agentrail-mcp] error', error);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  server.setRequestHandler(InitializeRequestSchema, async () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'agentrail-mcp', version: '0.1.0' },
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = tools.find(item => item.name === request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }

    try {
      return await tool.execute(request.params.arguments ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  });

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[agentrail-mcp] running on stdio');
}

main().catch(error => {
  console.error('[agentrail-mcp] failed to start', error);
  process.exit(1);
});