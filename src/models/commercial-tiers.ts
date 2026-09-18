export const COMMERCIAL_TIERS = ['free', 'trial', 'paid', 'unknown'] as const;

export type CommercialTier = typeof COMMERCIAL_TIERS[number];

export interface ModelProviderRef {
  name: string;
  providerModelId: string;
}

export interface CommercialTierResult {
  commercialTier: CommercialTier;
  commercialNote?: string;
}

interface ProviderTierDefault {
  tier: Exclude<CommercialTier, 'unknown'>;
  note: string;
}

const COMMERCIAL_TIER_PRIORITY: Record<CommercialTier, number> = {
  free: 0,
  trial: 1,
  paid: 2,
  unknown: 3,
};

const PROVIDER_DEFAULTS: Record<string, ProviderTierDefault> = {
  openrouter: { tier: 'free', note: 'Known free-tagged catalog routes via OpenRouter.' },
  groq: { tier: 'free', note: 'Provider is curated here as a usable free-tier route.' },
  github: { tier: 'trial', note: 'Access usually depends on Marketplace or account trial allowances.' },
  reka: { tier: 'free', note: 'Provider is treated here as a recurring free-credit route.' },
  google: { tier: 'free', note: 'Google AI Studio models are treated here as free-tier routes.' },
  cloudflare: { tier: 'free', note: 'Cloudflare AI is treated here as a free/dev-tier route.' },
  siliconflow: { tier: 'free', note: 'Provider is treated here as a free-credit or free-model route.' },
  cerebras: { tier: 'free', note: 'Provider is curated here as a usable free-tier route.' },
  mistral: { tier: 'free', note: 'Mistral is treated here as an experiment/free-tier route.' },
  'nous-research': { tier: 'free', note: 'Provider is curated here as a usable free-tier route.' },
  tokenrouter: { tier: 'paid', note: 'Provider is treated here as a paid-first route.' },
  bluesminds: { tier: 'trial', note: 'Provider is treated here as a limited promo or trial route.' },
  cohere: { tier: 'trial', note: 'Provider is treated here as a signup-trial route.' },
  nvidia: { tier: 'free', note: 'NVIDIA NIM is treated here as a free developer route.' },
  llm7: { tier: 'free', note: 'Provider is curated here as a usable free-tier route.' },
  kilo: { tier: 'free', note: 'Provider catalog here is focused on free-tagged routes.' },
  zhipu: { tier: 'free', note: 'Provider is treated here as a free-tier route.' },
  opencode: { tier: 'free', note: 'Provider catalog here is focused on explicit free routes.' },
  zenmux: { tier: 'free', note: 'Provider catalog here is focused on explicit free routes.' },
  claude: { tier: 'trial', note: 'OAuth access here depends on account or plan credits.' },
  codex: { tier: 'trial', note: 'OAuth access here depends on account or plan credits.' },
  gemini: { tier: 'free', note: 'Gemini OAuth routes are treated here as free-tier routes.' },
};

const MODEL_OVERRIDES: Record<string, ProviderTierDefault> = {
  'reka:reka-core-3': { tier: 'paid', note: 'Core-tier Reka route is treated here as paid-first.' },
  'reka:reka-flash-3': { tier: 'free', note: 'Flash-tier Reka route is treated here as free-credit eligible.' },
};

const FREE_TAG_PATTERN = /(?:^|[:/_-])free(?:$|[:/_-])/i;
const PAID_TAG_PATTERN = /(?:^|[:/_-])paid(?:$|[:/_-])/i;

function classifyProviderRoute(
  providerName: string,
  modelId: string,
  providerModelId: string,
): ProviderTierDefault | undefined {
  const override = MODEL_OVERRIDES[`${providerName}:${modelId}`];
  if (override) {
    return override;
  }

  const text = `${modelId} ${providerModelId}`;
  if (FREE_TAG_PATTERN.test(text)) {
    return {
      tier: 'free',
      note: 'Marked as free directly in the provider model route.',
    };
  }

  if (PAID_TAG_PATTERN.test(text)) {
    return {
      tier: 'paid',
      note: 'Marked as paid directly in the provider model route.',
    };
  }

  return PROVIDER_DEFAULTS[providerName];
}

export function classifyProviderRouteForModel(
  providerName: string,
  modelId: string,
  providerModelId: string,
): CommercialTierResult {
  const override = MODEL_OVERRIDES[`${providerName}:${modelId}`];
  if (override) {
    return {
      commercialTier: override.tier,
      commercialNote: override.note,
    };
  }

  const text = `${modelId} ${providerModelId}`;
  if (FREE_TAG_PATTERN.test(text)) {
    return {
      commercialTier: 'free',
      commercialNote: 'Marked as free directly in the provider model route.',
    };
  }

  if (PAID_TAG_PATTERN.test(text)) {
    return {
      commercialTier: 'paid',
      commercialNote: 'Marked as paid directly in the provider model route.',
    };
  }

  const defaultTier = PROVIDER_DEFAULTS[providerName];
  if (defaultTier) {
    return {
      commercialTier: defaultTier.tier,
      commercialNote: defaultTier.note,
    };
  }

  return { commercialTier: 'unknown' };
}

export function classifyCommercialTier(model: {
  id: string;
  providers: ModelProviderRef[];
}): CommercialTierResult {
  const candidates = model.providers
    .map((provider) => ({
      provider,
      resolution: classifyProviderRoute(provider.name, model.id, provider.providerModelId),
    }))
    .filter(
      (entry): entry is { provider: ModelProviderRef; resolution: ProviderTierDefault } => Boolean(entry.resolution),
    )
    .sort((a, b) => COMMERCIAL_TIER_PRIORITY[a.resolution.tier] - COMMERCIAL_TIER_PRIORITY[b.resolution.tier]);

  if (candidates.length === 0) {
    return { commercialTier: 'unknown' };
  }

  return {
    commercialTier: candidates[0].resolution.tier,
    commercialNote: candidates[0].resolution.note,
  };
}
