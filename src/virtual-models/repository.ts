import { getPersistencePool } from '../persistence/postgres-pool.js';
import { FALLBACK_AUTO_MODEL_ID, FALLBACK_FILES_MODEL_ID } from './constants.js';
import { mapRowToVirtualModel } from './db-mapper.js';
import { getCachedVirtualModels, loadVirtualModelsFromJson, saveVirtualModelsToJson, setCachedVirtualModels } from './json-store.js';
import { normalizeAutoProtection, normalizeSelectedModels, normalizeSelection, normalizeStickyMode, normalizeSystemPrompt } from './normalization.js';
import type { VirtualModelAutoProtection, VirtualModelCreateInput, VirtualModelRecord, VirtualModelRoutingConfig, VirtualModelUpdateInput } from './types.js';

function currentTimestamp(): number {
  return Date.now();
}

export function hasVirtualModelsInDb(): boolean {
  const cachedVirtualModels = getCachedVirtualModels();
  return cachedVirtualModels !== null && cachedVirtualModels.length > 0;
}

export function getVirtualModels(): VirtualModelRecord[] {
  return getCachedVirtualModels() ?? [];
}

export function getVirtualModelById(id: string): VirtualModelRecord | undefined {
  return getVirtualModels().find((vm) => vm.id === id);
}

export function isVirtualModelId(id: string): boolean {
  const cachedVirtualModels = getCachedVirtualModels();
  if (cachedVirtualModels) {
    return cachedVirtualModels.some((vm) => vm.id === id);
  }
  return id === FALLBACK_AUTO_MODEL_ID || id === FALLBACK_FILES_MODEL_ID;
}

export function resolveAlias(alias: string): string | undefined {
  const cachedVirtualModels = getCachedVirtualModels();
  if (cachedVirtualModels) {
    for (const vm of cachedVirtualModels) {
      if (vm.autoAliases.includes(alias)) {
        return vm.id;
      }
    }
  }
  return undefined;
}

export function getVirtualModelRoutingConfig(id: string): VirtualModelRoutingConfig | undefined {
  const cachedVirtualModels = getCachedVirtualModels();
  const vm = getVirtualModelById(id);
  if (vm) {
    return {
      strategy: vm.routingStrategy,
      selectedModels: vm.selectedModels,
      stickyMode: normalizeStickyMode(vm.stickyMode),
      autoProtection: normalizeAutoProtection(vm.autoProtection),
      systemPrompt: vm.systemPrompt,
    };
  }
  if (!cachedVirtualModels && id === FALLBACK_AUTO_MODEL_ID) {
    return { strategy: 'priority', selectedModels: [], stickyMode: 'none', autoProtection: normalizeAutoProtection(undefined), systemPrompt: null };
  }
  if (!cachedVirtualModels && id === FALLBACK_FILES_MODEL_ID) {
    return { strategy: 'priority', selectedModels: [], stickyMode: 'none', autoProtection: normalizeAutoProtection(undefined), systemPrompt: null };
  }
  return undefined;
}

export function mapRecordToResponse(record: VirtualModelRecord) {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    routingStrategy: record.routingStrategy,
    capabilities: record.capabilities,
    selectedModels: record.selectedModels.map((selection) => normalizeSelection(selection)),
    autoAliases: record.autoAliases,
    stickyMode: normalizeStickyMode(record.stickyMode),
    autoProtection: normalizeAutoProtection(record.autoProtection),
    isBuiltin: record.isBuiltin,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    systemPrompt: record.systemPrompt,
  };
}

export async function reloadVirtualModels(): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadVirtualModelsFromJson();
    return;
  }

  try {
    const result = await pool.query('SELECT * FROM agentrail_virtual_models ORDER BY created_at ASC');
    const rows = result.rows as Record<string, unknown>[];
    if (rows.length === 0) {
      setCachedVirtualModels(null);
      console.log('[VirtualModels] Table is empty, using fallback defaults');
      return;
    }
    const models = rows.map(mapRowToVirtualModel);
    setCachedVirtualModels(models);
    console.log(`[VirtualModels] Loaded ${models.length} virtual models from DB`);
  } catch {
    setCachedVirtualModels(null);
  }
}

export async function getAllVirtualModels(): Promise<VirtualModelRecord[]> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadVirtualModelsFromJson();
    return getCachedVirtualModels() ?? [];
  }

  const result = await pool.query('SELECT * FROM agentrail_virtual_models ORDER BY created_at ASC');
  return (result.rows as Record<string, unknown>[]).map(mapRowToVirtualModel);
}

export async function createVirtualModel(input: VirtualModelCreateInput): Promise<VirtualModelRecord> {
  const pool = getPersistencePool();
  const normalizedSelectedModels = normalizeSelectedModels(input.selectedModels);
  const stickyMode = normalizeStickyMode(input.stickyMode);
  const autoProtection = normalizeAutoProtection(input.autoProtection);
  if (!pool) {
    await loadVirtualModelsFromJson();
    const cachedVirtualModels = getCachedVirtualModels();
    if (cachedVirtualModels?.some((vm) => vm.id === input.id)) {
      throw new Error(`Virtual model "${input.id}" already exists`);
    }

    const now = currentTimestamp();
    const record: VirtualModelRecord = {
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      routingStrategy: input.routingStrategy ?? 'round-robin',
      capabilities: input.capabilities ?? ['chat'],
      selectedModels: normalizedSelectedModels,
      autoAliases: input.autoAliases ?? [],
      stickyMode,
      autoProtection,
      isBuiltin: input.isBuiltin ?? false,
      createdAt: now,
      updatedAt: now,
      systemPrompt: input.systemPrompt ?? null,
    };

    setCachedVirtualModels([...(cachedVirtualModels ?? []), record]);
    await saveVirtualModelsToJson();
    console.log('[VirtualModels] Created virtual model via JSON persistence:', input.id);
    return record;
  }

  const now = new Date();
  const selectedModels = JSON.stringify(normalizedSelectedModels);
  const capabilities = JSON.stringify(input.capabilities ?? ['chat']);
  const autoAliases = JSON.stringify(input.autoAliases ?? []);
  const autoProtectionJson = JSON.stringify(autoProtection);

  const existing = await pool.query('SELECT id FROM agentrail_virtual_models WHERE id = $1 LIMIT 1', [input.id]);
  if (existing.rows.length > 0) {
    throw new Error(`Virtual model "${input.id}" already exists`);
  }

  const systemPrompt = input.systemPrompt ?? null;

  await pool.query(
    'INSERT INTO agentrail_virtual_models (id, name, description, routing_strategy, capabilities, selected_models, auto_aliases, sticky_mode, auto_protection, is_builtin, system_prompt, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13)',
    [input.id, input.name, input.description ?? null, input.routingStrategy ?? 'round-robin', capabilities, selectedModels, autoAliases, stickyMode, autoProtectionJson, input.isBuiltin ?? false, systemPrompt, now, now],
  );

  await reloadVirtualModels();
  const result = await pool.query('SELECT * FROM agentrail_virtual_models WHERE id = $1 LIMIT 1', [input.id]);
  return mapRowToVirtualModel(result.rows[0] as Record<string, unknown>);
}

export async function updateVirtualModel(id: string, updates: VirtualModelUpdateInput): Promise<VirtualModelRecord | null> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadVirtualModelsFromJson();
    const cachedVirtualModels = getCachedVirtualModels();
    const idx = cachedVirtualModels?.findIndex((vm) => vm.id === id) ?? -1;
    if (idx === -1 || !cachedVirtualModels) return null;

    const existing = cachedVirtualModels[idx];
    const updated: VirtualModelRecord = {
      ...existing,
      ...updates,
      selectedModels: updates.selectedModels ? normalizeSelectedModels(updates.selectedModels) : existing.selectedModels,
      stickyMode: updates.stickyMode !== undefined ? normalizeStickyMode(updates.stickyMode) : normalizeStickyMode(existing.stickyMode),
      autoProtection: updates.autoProtection !== undefined ? normalizeAutoProtection(updates.autoProtection) : normalizeAutoProtection(existing.autoProtection),
      systemPrompt: updates.systemPrompt !== undefined ? normalizeSystemPrompt(updates.systemPrompt) : existing.systemPrompt,
      id: existing.id,
      isBuiltin: existing.isBuiltin,
      createdAt: existing.createdAt,
      updatedAt: currentTimestamp(),
    };
    cachedVirtualModels[idx] = updated;
    await saveVirtualModelsToJson();
    console.log('[VirtualModels] Updated virtual model via JSON persistence:', id);
    return updated;
  }

  const now = new Date();
  const existing = await pool.query('SELECT * FROM agentrail_virtual_models WHERE id = $1 LIMIT 1', [id]);
  if (existing.rows.length === 0) return null;

  const current = existing.rows[0] as Record<string, unknown>;
  const selectedModels = JSON.stringify(
    updates.selectedModels ? normalizeSelectedModels(updates.selectedModels) : normalizeSelectedModels(current.selected_models),
  );
  const capabilities = JSON.stringify(updates.capabilities ?? current.capabilities ?? ['chat']);
  const autoAliases = JSON.stringify(updates.autoAliases ?? current.auto_aliases ?? []);
  const stickyMode = normalizeStickyMode(updates.stickyMode ?? current.sticky_mode);
  const autoProtection = JSON.stringify(normalizeAutoProtection((updates.autoProtection ?? current.auto_protection) as Partial<VirtualModelAutoProtection> | undefined));
  const systemPrompt = updates.systemPrompt !== undefined ? normalizeSystemPrompt(updates.systemPrompt) : current.system_prompt;

  await pool.query(
    'UPDATE agentrail_virtual_models SET name = $2, description = $3, routing_strategy = $4, capabilities = $5::jsonb, selected_models = $6::jsonb, auto_aliases = $7::jsonb, sticky_mode = $8, auto_protection = $9::jsonb, system_prompt = $10, updated_at = $11 WHERE id = $1',
    [id, updates.name ?? current.name, updates.description !== undefined ? updates.description : current.description, updates.routingStrategy ?? current.routing_strategy, capabilities, selectedModels, autoAliases, stickyMode, autoProtection, systemPrompt, now],
  );

  await reloadVirtualModels();
  const result = await pool.query('SELECT * FROM agentrail_virtual_models WHERE id = $1 LIMIT 1', [id]);
  if (!result.rows[0]) return null;
  return mapRowToVirtualModel(result.rows[0] as Record<string, unknown>);
}

export async function deleteVirtualModel(id: string): Promise<boolean> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadVirtualModelsFromJson();
    const cachedVirtualModels = getCachedVirtualModels();
    const idx = cachedVirtualModels?.findIndex((vm) => vm.id === id) ?? -1;
    if (idx === -1 || !cachedVirtualModels) return false;

    if (cachedVirtualModels[idx].isBuiltin) {
      throw new Error('Cannot delete built-in virtual model');
    }

    cachedVirtualModels.splice(idx, 1);
    await saveVirtualModelsToJson();
    console.log('[VirtualModels] Deleted virtual model via JSON persistence:', id);
    return true;
  }

  const existing = await pool.query('SELECT * FROM agentrail_virtual_models WHERE id = $1 LIMIT 1', [id]);
  if (existing.rows.length === 0) return false;

  if (Boolean(existing.rows[0].is_builtin)) {
    throw new Error('Cannot delete built-in virtual model');
  }

  await pool.query('DELETE FROM agentrail_virtual_models WHERE id = $1', [id]);
  await reloadVirtualModels();
  return true;
}
