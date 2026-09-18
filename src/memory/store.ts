import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.agentrail');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

export interface MemoryEntry {
  id: string;
  /** Conversation/session the memory belongs to. */
  session: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MemoryStore {
  entries: MemoryEntry[];
}

function emptyStore(): MemoryStore {
  return { entries: [] };
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<MemoryStore> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as MemoryStore;
    if (!parsed || !Array.isArray(parsed.entries)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: MemoryStore): Promise<void> {
  await ensureDir();
  await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function tokenize(text: unknown): Set<string> {
  const normalized = (text == null ? '' : String(text)).toLowerCase();
  return new Set(
    normalized
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 1),
  );
}

function scoreMatch(entry: MemoryEntry, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const haystack = tokenize(`${entry.content} ${entry.tags.join(' ')} ${entry.session}`);
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) hits += 1;
  }
  // Semantic-ish boost: tag overlap counts double.
  const tagTokens = tokenize(entry.tags.join(' '));
  for (const token of queryTokens) {
    if (tagTokens.has(token)) hits += 1;
  }
  return hits;
}

export async function addMemory(input: {
  session?: string;
  content: string;
  tags?: string[];
}): Promise<MemoryEntry> {
  const store = await readStore();
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    session: input.session?.trim() || 'default',
    content: input.content,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    createdAt: now,
    updatedAt: now,
  };
  store.entries.push(entry);
  await writeStore(store);
  return entry;
}

export async function searchMemory(query: string, limit = 10): Promise<MemoryEntry[]> {
  const store = await readStore();
  const queryTokens = tokenize(query);
  const scored = store.entries
    .map((entry) => ({ entry, score: scoreMatch(entry, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((item) => item.entry);
}

export async function listMemory(): Promise<MemoryEntry[]> {
  const store = await readStore();
  return [...store.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteMemory(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.entries.length;
  store.entries = store.entries.filter((e) => e.id !== id);
  if (store.entries.length === before) return false;
  await writeStore(store);
  return true;
}