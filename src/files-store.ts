import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredFileRecord {
  id: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  mime_type: string;
  content_path: string;
  owner_api_key_id?: string;
  expires_at?: number;
}

const FILES_ROOT = path.resolve(process.env.AGENTRAIL_FILES_ROOT ?? path.join(process.cwd(), '.agentrail', 'files'));
const FILES_INDEX_PATH = path.join(FILES_ROOT, 'index.json');
const FILES_CONTENT_DIR = path.join(FILES_ROOT, 'content');

function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'file.bin';
}

async function ensureFilesRoot(): Promise<void> {
  await mkdir(FILES_CONTENT_DIR, { recursive: true });
}

async function readIndex(): Promise<StoredFileRecord[]> {
  try {
    const raw = await readFile(FILES_INDEX_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredFileRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(records: StoredFileRecord[]): Promise<void> {
  await ensureFilesRoot();
  await writeFile(FILES_INDEX_PATH, JSON.stringify(records, null, 2), 'utf-8');
}

export function formatStoredFile(record: StoredFileRecord) {
  return {
    id: record.id,
    object: 'file',
    bytes: record.bytes,
    created_at: record.created_at,
    filename: record.filename,
    purpose: record.purpose,
    ...(record.expires_at ? { expires_at: record.expires_at } : {}),
  };
}

export async function createStoredFile(input: {
  filename: string;
  purpose: string;
  mimeType: string;
  content: Buffer;
  ownerApiKeyId?: string;
  expiresAt?: number;
}): Promise<StoredFileRecord> {
  await ensureFilesRoot();
  const records = await readIndex();
  const id = `file-${randomUUID()}`;
  const contentPath = path.join(FILES_CONTENT_DIR, `${id}-${safeFilename(input.filename)}`);
  const record: StoredFileRecord = {
    id,
    bytes: input.content.byteLength,
    created_at: Math.floor(Date.now() / 1000),
    filename: input.filename,
    purpose: input.purpose,
    mime_type: input.mimeType || 'application/octet-stream',
    content_path: contentPath,
    owner_api_key_id: input.ownerApiKeyId,
    expires_at: input.expiresAt,
  };

  await writeFile(contentPath, input.content);
  await writeIndex([record, ...records]);
  return record;
}

export async function listStoredFiles(): Promise<StoredFileRecord[]> {
  const records = await readIndex();
  const now = Math.floor(Date.now() / 1000);
  const active = records.filter((record) => !record.expires_at || record.expires_at > now);
  const expired = records.filter((record) => record.expires_at && record.expires_at <= now);
  for (const record of expired) {
    try { await unlink(record.content_path); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  if (expired.length > 0) await writeIndex(active);
  return active.sort((left, right) => right.created_at - left.created_at);
}

export async function getStoredFile(id: string): Promise<StoredFileRecord | null> {
  return (await listStoredFiles()).find((record) => record.id === id) ?? null;
}

export async function getStoredFileContent(id: string): Promise<Buffer | null> {
  const record = await getStoredFile(id);
  if (!record) return null;
  try {
    return await readFile(record.content_path);
  } catch {
    return null;
  }
}

export async function deleteStoredFile(id: string): Promise<boolean> {
  const records = await readIndex();
  const record = records.find((item) => item.id === id);
  if (!record) return false;
  try { await unlink(record.content_path); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await writeIndex(records.filter((item) => item.id !== id));
  return true;
}



