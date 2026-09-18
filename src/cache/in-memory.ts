import { Cache } from './types.js';

/**
 * Simple in-memory cache with TTL support.
 * Used when Redis is not available or explicitly disabled.
 */
export class MemoryCache implements Cache {
  private store = new Map<string, { value: any; expiresAt: number | null }>();
  private enabled = true;

  constructor() {
    // Auto-cleanup expired entries every 60s
    setInterval(() => this.cleanupExpired(), 60_000);
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;

    const entry = this.store.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (entry.expiresAt !== null && now > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.enabled) return;

    const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    if (!this.enabled) return false;

    const entry = this.store.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (entry.expiresAt !== null && now > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.enabled) return [];
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return Array.from(this.store.keys()).filter(key => key.startsWith(prefix));
    }
    return this.store.has(pattern) ? [pattern] : [];
  }

  async ping(): Promise<boolean> {
    return this.enabled;
  }

  /** For testing - disable the cache */
  disable(): void {
    this.enabled = false;
  }

  /** For testing - enable the cache */
  enable(): void {
    this.enabled = true;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}