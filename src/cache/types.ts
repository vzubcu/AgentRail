/**
 * Generic key-value cache abstraction with TTL support.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(pattern: string): Promise<string[]>;

  /** Health check — returns false when the backing store is unreachable. */
  ping(): Promise<boolean>;
}

/**
 * Well-known cache key prefixes used across AgentRail.
 */
export const CacheKey = {
  /** Provider health snapshot TTL = 120s */
  providerHealth: (provider: string) => `health:${provider}`,
  /** Usage aggregates TTL = 60s */
  usageAggregates: 'usage:aggregates',
  /** Quota headroom TTL = 30s */
  quotaHeadroom: 'quota:headroom',
  /** Router selector decision TTL = 15s */
  routerDecision: (provider: string) => `router:decision:${provider}`,
} as const;