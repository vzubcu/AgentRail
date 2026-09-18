import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getCache } from './cache/manager.js';

export interface UsageRecord {
  modelId: string;
  providerName: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastUsedAt: number;
}

export interface VirtualModelRouteCounter {
  provider: string;
  modelId: string;
  count: number;
}

export interface VirtualModelStatsRecord {
  id: string;
  totalRequests: number;
  lastUsedAt: number | null;
  routeHits: VirtualModelRouteCounter[];
  routeFailures: VirtualModelRouteCounter[];
}

interface UsageCacheFile {
  records: UsageRecord[];
  virtualModelStats: VirtualModelStatsRecord[];
}

const CACHE_FILE = path.resolve(process.cwd(), '.agentrail', 'usage.json');

class UsageTracker {
  private records = new Map<string, UsageRecord>();
  private virtualModelStats = new Map<string, VirtualModelStatsRecord>();
  private initialized = false;
  private cache = getCache();

  private key(modelId: string, providerName: string): string {
    return `usage:${modelId}:${providerName}`;
  }

  private virtualModelKey(id: string): string {
    return `virtual-model:${id}`;
  }

  private normalizeRouteCounters(counters: unknown): VirtualModelRouteCounter[] {
    if (!Array.isArray(counters)) {
      return [];
    }

    return counters
      .map((counter) => {
        const entry = (counter && typeof counter === 'object' ? counter : {}) as Partial<VirtualModelRouteCounter>;
        return {
          provider: typeof entry.provider === 'string' ? entry.provider : '',
          modelId: typeof entry.modelId === 'string' ? entry.modelId : '',
          count: Number.isFinite(entry.count) ? Math.max(0, Math.round(entry.count ?? 0)) : 0,
        };
      })
      .filter((counter) => counter.provider && counter.modelId && counter.count > 0)
      .sort((left, right) => right.count - left.count || left.provider.localeCompare(right.provider) || left.modelId.localeCompare(right.modelId));
  }

  private normalizeVirtualModelStatsRecord(record: unknown): VirtualModelStatsRecord | null {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const entry = record as Partial<VirtualModelStatsRecord>;
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (!id) {
      return null;
    }

    return {
      id,
      totalRequests: Number.isFinite(entry.totalRequests) ? Math.max(0, Math.round(entry.totalRequests ?? 0)) : 0,
      lastUsedAt: Number.isFinite(entry.lastUsedAt) ? Number(entry.lastUsedAt) : null,
      routeHits: this.normalizeRouteCounters(entry.routeHits),
      routeFailures: this.normalizeRouteCounters(entry.routeFailures),
    };
  }

  private getOrCreateVirtualModelStats(id: string): VirtualModelStatsRecord {
    const existing = this.virtualModelStats.get(id);
    if (existing) {
      return existing;
    }

    const created: VirtualModelStatsRecord = {
      id,
      totalRequests: 0,
      lastUsedAt: null,
      routeHits: [],
      routeFailures: [],
    };
    this.virtualModelStats.set(id, created);
    return created;
  }

  private bumpCounter(counters: VirtualModelRouteCounter[], provider: string, modelId: string): VirtualModelRouteCounter[] {
    const next = counters.map((counter) => ({ ...counter }));
    const existing = next.find((counter) => counter.provider === provider && counter.modelId === modelId);
    if (existing) {
      existing.count += 1;
    } else {
      next.push({ provider, modelId, count: 1 });
    }
    return next.sort((left, right) => right.count - left.count || left.provider.localeCompare(right.provider) || left.modelId.localeCompare(right.modelId));
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    
    // Try loading from cache first
    try {
      const cache = await this.cache;
      const cachedRecords = await cache.keys('usage:*');
      for (const cacheKey of cachedRecords) {
        const record = await cache.get<UsageRecord>(cacheKey);
        if (record) {
          this.records.set(this.key(record.modelId, record.providerName), record);
        }
      }
      
      const cachedVirtualModels = await cache.keys('virtual-model:*');
      for (const cacheKey of cachedVirtualModels) {
        const stats = await cache.get<VirtualModelStatsRecord>(cacheKey);
        if (stats) {
          this.virtualModelStats.set(stats.id, stats);
        }
      }
    } catch {
      // Cache not available, will use file persistence
    }
    
    // Fallback to file persistence
    if (this.records.size === 0 && this.virtualModelStats.size === 0) {
      try {
        const raw = await readFile(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as UsageRecord[] | Partial<UsageCacheFile>;
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            this.records.set(this.key(r.modelId, r.providerName), r);
          }
        } else {
          for (const r of Array.isArray(parsed.records) ? parsed.records : []) {
            this.records.set(this.key(r.modelId, r.providerName), r);
          }
          for (const statsRecord of Array.isArray(parsed.virtualModelStats) ? parsed.virtualModelStats : []) {
            const normalized = this.normalizeVirtualModelStatsRecord(statsRecord);
            if (normalized) {
              this.virtualModelStats.set(normalized.id, normalized);
            }
          }
        }
      } catch {
        // no persisted usage yet
      }
    }
    
    this.initialized = true;
  }

  record(
    modelId: string,
    providerName: string,
    promptTokens: number,
    completionTokens: number,
  ): void {
    const k = this.key(modelId, providerName);
    const existing = this.records.get(k);
    const pt = Math.max(0, Math.round(promptTokens));
    const ct = Math.max(0, Math.round(completionTokens));
    if (existing) {
      existing.callCount += 1;
      existing.promptTokens += pt;
      existing.completionTokens += ct;
      existing.totalTokens += pt + ct;
      existing.lastUsedAt = Date.now();
    } else {
      const record: UsageRecord = {
        modelId,
        providerName,
        callCount: 1,
        promptTokens: pt,
        completionTokens: ct,
        totalTokens: pt + ct,
        lastUsedAt: Date.now(),
      };
      this.records.set(k, record);
    }
    this.flush().catch(() => {
      // ignore persistence errors
    });
  }

  recordVirtualModelRouteHit(id: string, provider: string, modelId: string): void {
    const stats = this.getOrCreateVirtualModelStats(id);
    stats.totalRequests += 1;
    stats.lastUsedAt = Date.now();
    stats.routeHits = this.bumpCounter(stats.routeHits, provider, modelId);
    this.flush().catch(() => {
      // ignore persistence errors
    });
  }

  recordVirtualModelRouteFailure(id: string, provider: string, modelId: string): void {
    const stats = this.getOrCreateVirtualModelStats(id);
    stats.routeFailures = this.bumpCounter(stats.routeFailures, provider, modelId);
    this.flush().catch(() => {
      // ignore persistence errors
    });
  }

  getStats(): UsageRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  getVirtualModelStats(id: string): VirtualModelStatsRecord {
    const stats = this.virtualModelStats.get(id);
    if (!stats) {
      return {
        id,
        totalRequests: 0,
        lastUsedAt: null,
        routeHits: [],
        routeFailures: [],
      };
    }

    return {
      id: stats.id,
      totalRequests: stats.totalRequests,
      lastUsedAt: stats.lastUsedAt,
      routeHits: stats.routeHits.map((counter) => ({ ...counter })),
      routeFailures: stats.routeFailures.map((counter) => ({ ...counter })),
    };
  }

  listVirtualModelStats(): VirtualModelStatsRecord[] {
    return Array.from(this.virtualModelStats.values())
      .map((stats) => ({
        id: stats.id,
        totalRequests: stats.totalRequests,
        lastUsedAt: stats.lastUsedAt,
        routeHits: stats.routeHits.map((counter) => ({ ...counter })),
        routeFailures: stats.routeFailures.map((counter) => ({ ...counter })),
      }))
      .sort((left, right) => {
        const leftTime = left.lastUsedAt ?? 0;
        const rightTime = right.lastUsedAt ?? 0;
        return rightTime - leftTime || left.id.localeCompare(right.id);
      });
  }

  async clear(): Promise<UsageRecord[]> {
    const records = Array.from(this.records.values());
    this.records.clear();
    this.virtualModelStats.clear();
    await this.flush();
    return records;
  }

  private async flush(): Promise<void> {
    const cache = await this.cache;
    
    // Write to cache
    for (const [k, record] of this.records) {
      await cache.set(k, record, 3600); // 1 hour TTL
    }
    
    for (const [id, stats] of this.virtualModelStats) {
      await cache.set(this.virtualModelKey(id), stats, 3600); // 1 hour TTL
    }
    
    // Also persist to file as backup
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const payload: UsageCacheFile = {
      records: this.getStats(),
      virtualModelStats: Array.from(this.virtualModelStats.values()).sort((a, b) => {
        const aTime = a.lastUsedAt ?? 0;
        const bTime = b.lastUsedAt ?? 0;
        return bTime - aTime || a.id.localeCompare(b.id);
      }),
    };
    await writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
  }
}

export const usageTracker = new UsageTracker();