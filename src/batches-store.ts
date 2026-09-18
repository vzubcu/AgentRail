import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredBatchRecord {
  id: string;
  object: 'batch';
  endpoint: string;
  input_file_id: string;
  completion_window: string;
  status: 'validating' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'cancelled' | 'expired';
  created_at: number;
  in_progress_at: number | null;
  finalizing_at: number | null;
  completed_at: number | null;
  failed_at: number | null;
  cancelled_at: number | null;
  output_file_id: string | null;
  error_file_id: string | null;
  metadata?: Record<string, string>;
  errors: unknown[];
  owner_api_key_id?: string;
  expired_at?: number | null;
}

const BATCHES_ROOT = path.resolve(process.env.AGENTRAIL_BATCHES_ROOT ?? path.join(process.cwd(), '.agentrail', 'batches'));
const BATCHES_INDEX_PATH = path.join(BATCHES_ROOT, 'index.json');

async function ensureBatchesRoot(): Promise<void> {
  await mkdir(BATCHES_ROOT, { recursive: true });
}

async function readIndex(): Promise<StoredBatchRecord[]> {
  try {
    const raw = await readFile(BATCHES_INDEX_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as StoredBatchRecord[] : [];
  } catch {
    return [];
  }
}

async function writeIndex(records: StoredBatchRecord[]): Promise<void> {
  await ensureBatchesRoot();
  await writeFile(BATCHES_INDEX_PATH, JSON.stringify(records, null, 2), 'utf-8');
}

function normalizeMetadata(metadata: unknown): Record<string, string> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const normalized = Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []),
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export async function createStoredBatch(input: {
  endpoint: string;
  inputFileId: string;
  completionWindow?: string;
  metadata?: unknown;
  ownerApiKeyId?: string;
}): Promise<StoredBatchRecord> {
  const records = await readIndex();
  const record: StoredBatchRecord = {
    id: `batch_${randomUUID().replace(/-/g, '')}`,
    object: 'batch',
    endpoint: input.endpoint,
    input_file_id: input.inputFileId,
    completion_window: input.completionWindow ?? '24h',
    status: 'validating',
    created_at: Math.floor(Date.now() / 1000),
    in_progress_at: null,
    finalizing_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    output_file_id: null,
    error_file_id: null,
    metadata: normalizeMetadata(input.metadata),
    errors: [],
    owner_api_key_id: input.ownerApiKeyId,
    expired_at: null,
  };
  await writeIndex([record, ...records]);
  return record;
}

export async function listStoredBatches(): Promise<StoredBatchRecord[]> {
  return (await readIndex()).sort((left, right) => right.created_at - left.created_at);
}

export async function getStoredBatch(id: string): Promise<StoredBatchRecord | null> {
  return (await readIndex()).find((record) => record.id === id) ?? null;
}

export async function updateStoredBatch(id: string, updater: (record: StoredBatchRecord) => StoredBatchRecord): Promise<StoredBatchRecord | null> {
  const records = await readIndex();
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) {
    return null;
  }
  const nextRecord = updater(records[index]);
  records[index] = nextRecord;
  await writeIndex(records);
  return nextRecord;
}

export async function cancelStoredBatch(id: string): Promise<StoredBatchRecord | null> {
  return updateStoredBatch(id, (record) => ({
    ...record,
    status: 'cancelled',
    cancelled_at: Math.floor(Date.now() / 1000),
  }));
}
export async function deleteStoredBatch(id: string): Promise<boolean> {
  const records = await readIndex();
  if (!records.some((record) => record.id === id)) return false;
  await writeIndex(records.filter((record) => record.id !== id));
  return true;
}

export async function deleteStoredBatches(ids: Set<string>): Promise<number> {
  const records = await readIndex();
  const remaining = records.filter((record) => !ids.has(record.id));
  await writeIndex(remaining);
  return records.length - remaining.length;
}