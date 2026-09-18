import type { DailyUsage } from './db.js';
import type { TierConfig } from './tiers.js';

export type LimitCheckResult = { ok: true } | { ok: false; error: string };

export function checkUsageLimit(daily: DailyUsage, tier: TierConfig): LimitCheckResult {
  if (daily.requests >= tier.requestsPerDay) {
    return {
      ok: false,
      error: `Daily request limit reached (${tier.requestsPerDay}/${tier.requestsPerDay}) for your ${tier.name} plan. Upgrade or wait until tomorrow.`,
    };
  }

  if (daily.promptTokens + daily.completionTokens >= tier.maxTokensPerDay) {
    return {
      ok: false,
      error: `Daily token limit reached (${(daily.promptTokens + daily.completionTokens).toLocaleString()}/${tier.maxTokensPerDay.toLocaleString()}) for your ${tier.name} plan. Upgrade or wait until tomorrow.`,
    };
  }

  return { ok: true };
}

export function getUsagePercentages(daily: DailyUsage | undefined, tier: TierConfig): {
  requestsPct: number;
  tokensPct: number;
} {
  if (!daily) {
    return { requestsPct: 0, tokensPct: 0 };
  }

  const requestsPct = tier.requestsPerDay === Infinity
    ? 0
    : Math.round((daily.requests / tier.requestsPerDay) * 100);

  const totalTokens = daily.promptTokens + daily.completionTokens;
  const tokensPct = tier.maxTokensPerDay === Infinity
    ? 0
    : Math.round((totalTokens / tier.maxTokensPerDay) * 100);

  return { requestsPct: Math.min(requestsPct, 100), tokensPct: Math.min(tokensPct, 100) };
}
