import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getPersistencePool } from './persistence/postgres-pool.js';

export interface SystemPromptRecord {
  id: string;
  name: string;
  description: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const SYSTEM_PROMPTS_JSON_PATH = path.resolve(process.cwd(), '.agentrail', 'system-prompts.json');
let systemPromptsJsonLoaded = false;
let cachedSystemPrompts: SystemPromptRecord[] | null = null;

function normalizeRecord(record: Partial<SystemPromptRecord> & { id: string; name: string; content: string }): SystemPromptRecord {
  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === 'string' ? record.description : null,
    content: record.content,
    createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : 0,
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0,
  };
}

async function loadSystemPromptsFromJson(): Promise<void> {
  if (systemPromptsJsonLoaded) return;
  systemPromptsJsonLoaded = true;
  try {
    const raw = await readFile(SYSTEM_PROMPTS_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as SystemPromptRecord[];
    cachedSystemPrompts = Array.isArray(parsed) ? parsed.map((record) => normalizeRecord(record)) : [];
  } catch {
    cachedSystemPrompts = [];
  }
}

async function saveSystemPromptsToJson(): Promise<void> {
  await mkdir(path.dirname(SYSTEM_PROMPTS_JSON_PATH), { recursive: true });
  await writeFile(SYSTEM_PROMPTS_JSON_PATH, JSON.stringify(cachedSystemPrompts ?? [], null, 2), 'utf-8');
}

function mapRowToSystemPrompt(row: Record<string, unknown>): SystemPromptRecord {
  return normalizeRecord({
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    content: String(row.content ?? ''),
    createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : 0,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : 0,
  });
}

function currentTimestamp(): number {
  return Date.now();
}

export async function getAllSystemPrompts(): Promise<SystemPromptRecord[]> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadSystemPromptsFromJson();
    return cachedSystemPrompts ?? [];
  }

  const result = await pool.query('SELECT * FROM agentrail_system_prompts ORDER BY created_at ASC');
  return (result.rows as Record<string, unknown>[]).map(mapRowToSystemPrompt);
}

export async function createSystemPrompt(input: {
  id: string;
  name: string;
  description?: string | null;
  content: string;
}): Promise<SystemPromptRecord> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadSystemPromptsFromJson();
    if ((cachedSystemPrompts ?? []).some((prompt) => prompt.id === input.id)) {
      throw new Error(`System prompt "${input.id}" already exists`);
    }

    const now = currentTimestamp();
    const record = normalizeRecord({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    });
    cachedSystemPrompts = [...(cachedSystemPrompts ?? []), record];
    await saveSystemPromptsToJson();
    return record;
  }

  const existing = await pool.query('SELECT id FROM agentrail_system_prompts WHERE id = $1 LIMIT 1', [input.id]);
  if (existing.rows.length > 0) {
    throw new Error(`System prompt "${input.id}" already exists`);
  }

  const now = new Date();
  await pool.query(
    'INSERT INTO agentrail_system_prompts (id, name, description, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [input.id, input.name, input.description ?? null, input.content, now, now],
  );
  const result = await pool.query('SELECT * FROM agentrail_system_prompts WHERE id = $1 LIMIT 1', [input.id]);
  return mapRowToSystemPrompt(result.rows[0] as Record<string, unknown>);
}

export async function updateSystemPrompt(
  id: string,
  updates: Partial<Omit<SystemPromptRecord, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<SystemPromptRecord | null> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadSystemPromptsFromJson();
    const idx = (cachedSystemPrompts ?? []).findIndex((prompt) => prompt.id === id);
    if (idx === -1) return null;

    const existing = (cachedSystemPrompts ?? [])[idx];
    const updated = normalizeRecord({
      ...existing,
      ...updates,
      id: existing.id,
      name: updates.name ?? existing.name,
      content: updates.content ?? existing.content,
      createdAt: existing.createdAt,
      updatedAt: currentTimestamp(),
    });
    (cachedSystemPrompts ?? [])[idx] = updated;
    await saveSystemPromptsToJson();
    return updated;
  }

  const existing = await pool.query('SELECT * FROM agentrail_system_prompts WHERE id = $1 LIMIT 1', [id]);
  if (existing.rows.length === 0) return null;

  const current = existing.rows[0] as Record<string, unknown>;
  const now = new Date();
  await pool.query(
    'UPDATE agentrail_system_prompts SET name = $2, description = $3, content = $4, updated_at = $5 WHERE id = $1',
    [id, updates.name ?? current.name, updates.description !== undefined ? updates.description : current.description, updates.content ?? current.content, now],
  );
  const result = await pool.query('SELECT * FROM agentrail_system_prompts WHERE id = $1 LIMIT 1', [id]);
  return mapRowToSystemPrompt(result.rows[0] as Record<string, unknown>);
}

export async function deleteSystemPrompt(id: string): Promise<boolean> {
  const pool = getPersistencePool();
  if (!pool) {
    await loadSystemPromptsFromJson();
    const idx = (cachedSystemPrompts ?? []).findIndex((prompt) => prompt.id === id);
    if (idx === -1) return false;
    (cachedSystemPrompts ?? []).splice(idx, 1);
    await saveSystemPromptsToJson();
    return true;
  }

  const existing = await pool.query('SELECT id FROM agentrail_system_prompts WHERE id = $1 LIMIT 1', [id]);
  if (existing.rows.length === 0) return false;
  await pool.query('DELETE FROM agentrail_system_prompts WHERE id = $1', [id]);
  return true;
}