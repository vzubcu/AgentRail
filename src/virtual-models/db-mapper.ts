import { normalizeRecord } from './normalization.js';
import type { VirtualModelRecord } from './types.js';

export function mapRowToVirtualModel(row: Record<string, unknown>): VirtualModelRecord {
  return normalizeRecord({
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    routingStrategy: String(row.routing_strategy) as VirtualModelRecord['routingStrategy'],
    capabilities: Array.isArray(row.capabilities) ? (row.capabilities as string[]) : [],
    selectedModels: row.selected_models as unknown,
    autoAliases: Array.isArray(row.auto_aliases) ? (row.auto_aliases as string[]) : [],
    stickyMode: row.sticky_mode as unknown,
    autoProtection: row.auto_protection as unknown,
    isBuiltin: Boolean(row.is_builtin),
    createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : 0,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : 0,
    systemPrompt: row.system_prompt ?? null,
  });
}
