export interface TierConfig {
  name: string;
  requestsPerDay: number;
  maxApiKeys: number;
  maxTokensPerDay: number;
  priceMonthly: number;
  features: string[];
}

const FALLBACK_TIERS: Record<string, TierConfig> = {
  free: {
    name: 'Free',
    requestsPerDay: 100,
    maxApiKeys: 3,
    maxTokensPerDay: 500_000,
    priceMonthly: 0,
    features: [
      '100 requests / day',
      '3 API keys',
      'Basic model access',
      'Community support',
    ],
  },
  pro: {
    name: 'Pro',
    requestsPerDay: 1000,
    maxApiKeys: 10,
    maxTokensPerDay: 5_000_000,
    priceMonthly: 19,
    features: [
      '1,000 requests / day',
      '10 API keys',
      'All models including premium',
      'Priority routing',
      'Email support',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    requestsPerDay: Infinity,
    maxApiKeys: 100,
    maxTokensPerDay: Infinity,
    priceMonthly: 99,
    features: [
      'Unlimited requests',
      '100 API keys',
      'All models',
      'Priority routing',
      'Dedicated support',
      '99.9% SLA',
      'Custom integrations',
    ],
  },
};

function normalizeBuiltInLimit(
  tierId: string,
  key: 'requestsPerDay' | 'maxTokensPerDay' | 'maxApiKeys',
  value: number | null,
): number | null {
  const fallback = FALLBACK_TIERS[tierId];
  if (!fallback) {
    return value;
  }

  const fallbackValue = fallback[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallbackValue === Infinity ? null : fallbackValue;
  }

  return value;
}

export function normalizeTierRecord(record: {
  id: string;
  name: string;
  requestsPerDay: number | null;
  maxApiKeys: number;
  maxTokensPerDay: number | null;
  priceMonthly: number;
  features: string[];
}): {
  id: string;
  name: string;
  requestsPerDay: number | null;
  maxApiKeys: number;
  maxTokensPerDay: number | null;
  priceMonthly: number;
  features: string[];
} {
  return {
    ...record,
    requestsPerDay: normalizeBuiltInLimit(record.id, 'requestsPerDay', record.requestsPerDay),
    maxApiKeys: normalizeBuiltInLimit(record.id, 'maxApiKeys', record.maxApiKeys) ?? FALLBACK_TIERS.free.maxApiKeys,
    maxTokensPerDay: normalizeBuiltInLimit(record.id, 'maxTokensPerDay', record.maxTokensPerDay),
  };
}

export async function getTier(tierId: string): Promise<TierConfig> {
  const { getTierById } = await import('./db.js');
  const rawTier = await getTierById(tierId);
  const dbTier = rawTier ? normalizeTierRecord(rawTier) : undefined;
  if (dbTier) {
    return {
      name: dbTier.name,
      requestsPerDay: dbTier.requestsPerDay ?? Infinity,
      maxApiKeys: dbTier.maxApiKeys,
      maxTokensPerDay: dbTier.maxTokensPerDay ?? Infinity,
      priceMonthly: dbTier.priceMonthly,
      features: dbTier.features,
    };
  }
  return FALLBACK_TIERS[tierId] ?? FALLBACK_TIERS.free;
}

export async function isValidTier(tierId: string): Promise<boolean> {
  const { getTierById } = await import('./db.js');
  const rawTier = await getTierById(tierId);
  const dbTier = rawTier ? normalizeTierRecord(rawTier) : undefined;
  return !!dbTier || tierId in FALLBACK_TIERS;
}

export async function getAllTiers(): Promise<Record<string, TierConfig>> {
  const { listTiers } = await import('./db.js');
  const dbTiers = await listTiers();
  const result: Record<string, TierConfig> = {};
  for (const rawTier of dbTiers) {
    const t = normalizeTierRecord(rawTier);
    result[t.id] = {
      name: t.name,
      requestsPerDay: t.requestsPerDay ?? Infinity,
      maxApiKeys: t.maxApiKeys,
      maxTokensPerDay: t.maxTokensPerDay ?? Infinity,
      priceMonthly: t.priceMonthly,
      features: t.features,
    };
  }
  return result;
}
