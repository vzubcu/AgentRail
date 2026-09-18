import { Cache } from './types.js';
import { MemoryCache } from './in-memory.js';
import { RedisCache, isRedisAvailable } from './redis.js';

let cache: Cache | null = null;
let redisCache: RedisCache | null = null;

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/**
 * Get the Redis URL from environment or return undefined if not configured.
 */
function getRedisUrl(): string | undefined {
  const url = process.env.AGENTRAIL_REDIS_URL?.trim();
  if (!url || url.length === 0) return undefined;
  return url;
}

/**
 * Initialize and return the cache instance.
 * Prefers Redis if available, falls back to in-memory cache.
 */
export async function getCache(): Promise<Cache> {
  if (cache) return cache;

  const redisUrl = getRedisUrl();

  if (redisUrl) {
    try {
      const available = await isRedisAvailable(redisUrl);
      if (available) {
        redisCache = new RedisCache(redisUrl);
        cache = redisCache;
        return cache;
      }
    } catch {
      // Redis not available, fall through to in-memory
    }
  }

  cache = new MemoryCache();
  return cache;
}

/**
 * Get the current cache instance without initializing.
 * Returns null if not yet initialized.
 */
export function getCacheInstance(): Cache | null {
  return cache;
}

/**
 * Get the Redis cache instance if available.
 */
export function getRedisCacheInstance(): RedisCache | null {
  return redisCache;
}

/**
 * Check if Redis is being used.
 */
export function isUsingRedis(): boolean {
  return redisCache !== null;
}

/**
 * Reset cache instance (for testing).
 */
export function resetCache(): void {
  if (redisCache) {
    redisCache.close().catch(() => {});
    redisCache = null;
  }
  cache = null;
}