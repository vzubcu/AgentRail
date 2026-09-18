import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageTracker } from '../usage-tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.agentrail');
const QUOTA_FILE = path.join(DATA_DIR, 'quota.json');

export interface ProviderQuota {
  /** Monthly request cap for the provider. 0 = unlimited. */
  requests: number;
  /** Monthly token cap for the provider. 0 = unlimited. */
  tokens: number;
}

export type QuotaConfig = Record<string, ProviderQuota>;

export interface ProviderHeadroom {
  provider: string;
  usedRequests: number;
  usedTokens: number;
  quotaRequests: number;
  quotaTokens: number;
  remainingRequests: number;
  remainingTokens: number;
  requestHeadroomPct: number;
  tokenHeadroomPct: number;
  unlimited: boolean;
}

function defaultConfig(): QuotaConfig {
  return {};
}

async function readConfig(): Promise<QuotaConfig> {
  try {
    const raw = await fs.readFile(QUOTA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as QuotaConfig;
    if (!parsed || typeof parsed !== 'object') return defaultConfig();
    return parsed;
  } catch {
    return defaultConfig();
  }
}

async function writeConfig(config: QuotaConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(QUOTA_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export async function getQuotaConfig(): Promise<QuotaConfig> {
  return readConfig();
}

export async function setQuotaConfig(next: QuotaConfig): Promise<QuotaConfig> {
  const cleaned: QuotaConfig = {};
  for (const [provider, quota] of Object.entries(next || {})) {
    if (!provider) continue;
    cleaned[provider] = {
      requests: Math.max(0, Math.round(Number(quota?.requests) || 0)),
      tokens: Math.max(0, Math.round(Number(quota?.tokens) || 0)),
    };
  }
  await writeConfig(cleaned);
  return cleaned;
}

function pct(used: number, quota: number): number {
  if (quota <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((quota - used) / quota) * 100)));
}

export async function computeHeadroom(): Promise<ProviderHeadroom[]> {
  const config = await readConfig();
  const stats = usageTracker.getStats();
  const providers = new Set<string>([...Object.keys(config), ...stats.map((s) => s.providerName)]);

  const result: ProviderHeadroom[] = [];
  for (const provider of providers) {
    const used = stats.find((s) => s.providerName === provider);
    const usedRequests = used?.callCount ?? 0;
    const usedTokens = used?.totalTokens ?? 0;
    const quota = config[provider] ?? { requests: 0, tokens: 0 };
    const unlimited = quota.requests <= 0 && quota.tokens <= 0;

    result.push({
      provider,
      usedRequests,
      usedTokens,
      quotaRequests: quota.requests,
      quotaTokens: quota.tokens,
      remainingRequests: quota.requests > 0 ? Math.max(0, quota.requests - usedRequests) : 0,
      remainingTokens: quota.tokens > 0 ? Math.max(0, quota.tokens - usedTokens) : 0,
      requestHeadroomPct: pct(usedRequests, quota.requests),
      tokenHeadroomPct: pct(usedTokens, quota.tokens),
      unlimited,
    });
  }

  return result.sort((a, b) => a.provider.localeCompare(b.provider));
}