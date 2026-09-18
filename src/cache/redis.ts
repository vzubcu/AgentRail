import { Cache } from './types.js';

let Redis: any = null;
let redisImportError: Error | null = null;

try {
  // Dynamic import to make ioredis optional
  // @ts-ignore - ioredis is optional at runtime and guarded by try/catch above
  const mod = await import('ioredis');
  Redis = mod.default;
} catch (err) {
  redisImportError = err instanceof Error ? err : new Error(String(err));
}

/**
 * Redis-backed cache implementation.
 * Requires ioredis to be installed (optional dependency).
 */
export class RedisCache implements Cache {
  private client: any;
  private connected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(private readonly url: string) {
    if (!Redis) {
      throw new Error(
        `ioredis is not installed. Install it with: npm install ioredis\nOriginal error: ${redisImportError?.message}`,
      );
    }

    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.connected = true;
    });

    this.client.on('error', () => {
      this.connected = false;
    });

    this.client.on('close', () => {
      this.connected = false;
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;

    if (!this.connectionPromise) {
      this.connectionPromise = this.client.connect().then(() => {
        this.connected = true;
        this.connectionPromise = null;
      }).catch((err: Error) => {
        this.connected = false;
        this.connectionPromise = null;
        throw err;
      });
    }

    await this.connectionPromise;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      await this.ensureConnected();
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : undefined;
    } catch {
      this.connected = false;
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.ensureConnected();
      const serialized = JSON.stringify(value);
      if (ttlSeconds !== undefined) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch {
      this.connected = false;
      throw new Error('Redis set failed');
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.del(key);
    } catch {
      this.connected = false;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.flushdb();
    } catch {
      this.connected = false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      await this.ensureConnected();
      return await this.client.keys(pattern);
    } catch {
      this.connected = false;
      return [];
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
      const result = await this.client.ping();
      this.connected = result === 'PONG';
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /** Gracefully close the Redis connection */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }

  /** Check if Redis is available without throwing */
  isAvailable(): boolean {
    return this.connected;
  }
}

/**
 * Check if Redis is available (ioredis installed and reachable)
 */
export async function isRedisAvailable(url: string): Promise<boolean> {
  if (!Redis) return false;

  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    connectTimeout: 2000,
  });

  try {
    await client.connect();
    const result = await client.ping();
    await client.quit();
    return result === 'PONG';
  } catch {
    return false;
  }
}