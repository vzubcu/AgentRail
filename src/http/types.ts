import http from 'node:http';
import { routeChatCompletion as defaultRouteChatCompletion } from '../router.js';
import type { ServerConfig } from './config.js';

export type RouteChatCompletion = typeof defaultRouteChatCompletion;

export interface CreateServerOptions {
  routeChatCompletion?: RouteChatCompletion;
  launchAgentTool?: typeof import('../agent-launch.js').launchAgentTool;
}

export interface RequestContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  requestId: string;
  startedAt: number;
  requestUrl: string;
  pathname: string;
  config: ServerConfig;
  options: CreateServerOptions;
  trace: (event: string, payload?: Record<string, unknown>) => void;
}
