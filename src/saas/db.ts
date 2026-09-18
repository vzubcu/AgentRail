import { isPostgresPersistenceEnabled } from '../persistence/postgres-pool.js';
import type { ApiKey, AuditEvent, DailyUsage, SessionRecord, TierRecord, User } from './types.js';

const backend = isPostgresPersistenceEnabled()
  ? await import('./postgres-db.js')
  : await import('./legacy-db.js');

export type { ApiKey, AuditEvent, DailyUsage, SessionRecord, TierRecord, User } from './types.js';

export const initDB = backend.initDB;
export const createUser = backend.createUser;
export const getUserByEmail = backend.getUserByEmail;
export const getUserById = backend.getUserById;
export const listUsers = backend.listUsers;
export const updateUser = backend.updateUser;
export const deleteUser = backend.deleteUser;
export const createApiKey = backend.createApiKey;
export const getApiKeyById = backend.getApiKeyById;
export const listApiKeysForUser = backend.listApiKeysForUser;
export const revokeApiKey = backend.revokeApiKey;
export const touchApiKeyById = backend.touchApiKeyById;
export const countActiveKeys = backend.countActiveKeys;
export const createSessionRecord = backend.createSessionRecord;
export const getSessionByHash = backend.getSessionByHash;
export const touchSessionByHash = backend.touchSessionByHash;
export const deleteSessionByHash = backend.deleteSessionByHash;
export const pruneExpiredSessions = backend.pruneExpiredSessions;
export const createAuditEvent = backend.createAuditEvent;
export const listAuditEvents = backend.listAuditEvents;
export const getDailyUsage = backend.getDailyUsage;
export const recordUsage = backend.recordUsage;
export const getUserUsageHistory = backend.getUserUsageHistory;
export const getAllUsageHistory = backend.getAllUsageHistory;
export const listTiers = backend.listTiers;
export const getTierById = backend.getTierById;
export const createTier = backend.createTier;
export const updateTier = backend.updateTier;
export const deleteTier = backend.deleteTier;

export { listLegacyApiKeySecrets, scrubLegacyApiKeySecrets } from './legacy-db.js';
