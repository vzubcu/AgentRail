import assert from 'node:assert/strict';

const migration = await import('../migrations/202607060001_agentrail_persistence.cjs');

const existingTables = new Set([
  'agentrail_provider_secrets',
  'agentrail_gateway_secrets',
  'agentrail_saas_api_secrets',
]);
const existingColumns = new Map([
  ['agentrail_saas_api_secrets', new Set(['id', 'user_id', 'key_hash', 'key_preview', 'is_active', 'created_at', 'last_used_at'])],
]);
const createdTables = [];
const alteredColumns = [];

const knex = {
  raw(value) {
    return value;
  },
  schema: {
    async hasTable(name) {
      return existingTables.has(name);
    },
    async hasColumn(table, column) {
      return existingColumns.get(table)?.has(column) ?? false;
    },
    async createTable(name, builder) {
      createdTables.push(name);
      const table = {
        text() { return this; },
        integer() { return this; },
        bigInteger() { return this; },
        boolean() { return this; },
        jsonb() { return this; },
        double() { return this; },
        notNullable() { return this; },
        nullable() { return this; },
        primary() { return this; },
        unique() { return this; },
        references() { return this; },
        inTable() { return this; },
        onDelete() { return this; },
        defaultTo() { return this; },
      };
      builder(table);
    },
    async alterTable(name, builder) {
      const table = {
        text(column) { alteredColumns.push([name, column]); return this; },
        nullable() { return this; },
      };
      builder(table);
    },
    async dropTableIfExists() {},
  },
};

await migration.up(knex);

assert.deepEqual(createdTables, [
  'agentrail_saas_users',
  'agentrail_saas_api_keys_metadata',
  'agentrail_saas_sessions',
  'agentrail_saas_usage_daily',
  'agentrail_saas_tiers',
  'agentrail_saas_audit_events',
]);
assert.deepEqual(alteredColumns, [
  ['agentrail_saas_api_secrets', 'key_value'],
  ['agentrail_saas_api_secrets', 'key_value_iv'],
  ['agentrail_saas_api_secrets', 'key_value_auth_tag'],
]);

console.log('migration compatibility regression passed');
