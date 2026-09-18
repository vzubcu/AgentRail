import { randomUUID } from 'node:crypto';

export type VirtualModelTraceOutcome = 'success' | 'failed';

export interface VirtualModelTraceExcludedCandidate {
  provider: string;
  modelId: string;
  reason: string;
}

export interface VirtualModelTraceAttempt {
  order: number;
  provider: string;
  modelId: string;
  outcome: 'success' | 'http_error' | 'exception' | 'invalid_response';
  status?: number;
  message?: string;
}

export interface VirtualModelRouteTrace {
  id: string;
  virtualModelId: string;
  createdAt: number;
  strategy: 'priority' | 'round-robin' | 'random';
  outcome: VirtualModelTraceOutcome;
  finalRoute?: {
    provider: string;
    modelId: string;
  };
  excludedCandidates: VirtualModelTraceExcludedCandidate[];
  attempts: VirtualModelTraceAttempt[];
  stickyMode: 'none' | 'request-key';
  stickyKeyPresent: boolean;
}

const MAX_TRACES_PER_MODEL = 50;
const traceStore = new Map<string, VirtualModelRouteTrace[]>();

export interface RecordVirtualModelRouteTraceInput {
  virtualModelId: string;
  strategy: 'priority' | 'round-robin' | 'random';
  outcome: VirtualModelTraceOutcome;
  finalRoute?: {
    provider: string;
    modelId: string;
  };
  excludedCandidates?: VirtualModelTraceExcludedCandidate[];
  attempts?: VirtualModelTraceAttempt[];
  stickyMode?: 'none' | 'request-key';
  stickyKeyPresent?: boolean;
}

export function recordVirtualModelRouteTrace(input: RecordVirtualModelRouteTraceInput): VirtualModelRouteTrace {
  const trace: VirtualModelRouteTrace = {
    id: randomUUID(),
    virtualModelId: input.virtualModelId,
    createdAt: Date.now(),
    strategy: input.strategy,
    outcome: input.outcome,
    ...(input.finalRoute ? { finalRoute: input.finalRoute } : {}),
    excludedCandidates: [...(input.excludedCandidates ?? [])],
    attempts: [...(input.attempts ?? [])],
    stickyMode: input.stickyMode ?? 'none',
    stickyKeyPresent: input.stickyKeyPresent === true,
  };

  const traces = traceStore.get(input.virtualModelId) ?? [];
  traces.unshift(trace);
  if (traces.length > MAX_TRACES_PER_MODEL) {
    traces.length = MAX_TRACES_PER_MODEL;
  }
  traceStore.set(input.virtualModelId, traces);
  return trace;
}

export function listVirtualModelRouteTraces(virtualModelId: string, limit = 10): VirtualModelRouteTrace[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;
  return (traceStore.get(virtualModelId) ?? []).slice(0, safeLimit);
}

export function getVirtualModelRouteTrace(virtualModelId: string, traceId: string): VirtualModelRouteTrace | null {
  return (traceStore.get(virtualModelId) ?? []).find((trace) => trace.id === traceId) ?? null;
}
