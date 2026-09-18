export type VirtualModelStickyMode = 'none' | 'request-key';

export type VirtualModelRoutingStrategy = 'priority' | 'round-robin' | 'random';

export interface VirtualModelMemberState {
  consecutiveFailures: number;
  lastFailureAt: number | null;
  autoDisabledUntil: number | null;
  lastAutoDisabledAt: number | null;
  lastRecoveredAt: number | null;
  lastSuccessAt: number | null;
}

export interface VirtualModelAutoProtection {
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
}

export interface VirtualModelSelection {
  provider: string;
  modelId: string;
  priority: number;
  enabled?: boolean;
  weight?: number;
  fallbackOnly?: boolean;
  capabilities?: string[];
  memberState?: VirtualModelMemberState;
}

export interface VirtualModelRecord {
  id: string;
  name: string;
  description: string | null;
  routingStrategy: VirtualModelRoutingStrategy;
  capabilities: string[];
  selectedModels: VirtualModelSelection[];
  autoAliases: string[];
  stickyMode?: VirtualModelStickyMode;
  autoProtection: VirtualModelAutoProtection;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
  systemPrompt: string | null;
}

export interface VirtualModelCreateInput {
  id: string;
  name: string;
  description?: string | null;
  routingStrategy?: VirtualModelRoutingStrategy;
  capabilities?: string[];
  selectedModels?: VirtualModelSelection[];
  autoAliases?: string[];
  stickyMode?: VirtualModelStickyMode;
  autoProtection?: VirtualModelAutoProtection;
  isBuiltin?: boolean;
  systemPrompt?: string | null;
}

export type VirtualModelUpdateInput = Partial<Omit<VirtualModelRecord, 'id' | 'createdAt' | 'isBuiltin'>>;

export interface VirtualModelRoutingConfig {
  strategy: string;
  selectedModels: VirtualModelSelection[];
  stickyMode: VirtualModelStickyMode;
  autoProtection: VirtualModelAutoProtection;
  systemPrompt: string | null;
}
