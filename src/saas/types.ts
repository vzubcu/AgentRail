export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  tier: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: number;
}

export interface ApiKey {
  id: string;
  userId: string;
  keyPreview: string;
  name: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  scopes?: string[];
  key?: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
}

export interface AuditEvent {
  id: string;
  type: string;
  userId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface TierRecord {
  id: string;
  name: string;
  requestsPerDay: number | null;
  maxApiKeys: number;
  maxTokensPerDay: number | null;
  priceMonthly: number;
  features: string[];
}

export interface DailyUsage {
  userId: string;
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SaasDatabaseSnapshot {
  users: User[];
  apiKeys: ApiKey[];
  sessions: SessionRecord[];
  usage: DailyUsage[];
  tiers: TierRecord[];
  auditEvents: AuditEvent[];
}
