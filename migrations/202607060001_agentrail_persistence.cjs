async function createTableIfMissing(knex, tableName, buildTable) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, buildTable);
  }
}

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

exports.up = async function up(knex) {
  await createTableIfMissing(knex, 'agentrail_provider_secrets', (table) => {
    table.text('env_var').notNullable();
    table.text('fingerprint').notNullable();
    table.integer('ordinal').notNullable();
    table.text('encrypted_iv').notNullable();
    table.text('encrypted_value').notNullable();
    table.text('encrypted_auth_tag').notNullable();
    table.text('preview').notNullable();
    table.text('secondary_label').nullable();
    table.text('secondary_preview').nullable();
    table.bigInteger('created_at').notNullable();
    table.bigInteger('updated_at').notNullable();
    table.primary(['env_var', 'fingerprint']);
  });

  await createTableIfMissing(knex, 'agentrail_gateway_secrets', (table) => {
    table.text('name').primary();
    table.text('key_hash').notNullable();
    table.text('preview').notNullable();
    table.bigInteger('updated_at').notNullable();
  });

  await createTableIfMissing(knex, 'agentrail_saas_api_secrets', (table) => {
    table.text('id').primary();
    table.text('user_id').notNullable();
    table.text('key_hash').notNullable().unique();
    table.text('key_preview').notNullable();
    table.boolean('is_active').notNullable();
    table.bigInteger('created_at').notNullable();
    table.bigInteger('last_used_at').nullable();
    table.text('key_value').nullable();
    table.text('key_value_iv').nullable();
    table.text('key_value_auth_tag').nullable();
  });

  await addColumnIfMissing(knex, 'agentrail_saas_api_secrets', 'key_value', (table) => {
    table.text('key_value').nullable();
  });
  await addColumnIfMissing(knex, 'agentrail_saas_api_secrets', 'key_value_iv', (table) => {
    table.text('key_value_iv').nullable();
  });
  await addColumnIfMissing(knex, 'agentrail_saas_api_secrets', 'key_value_auth_tag', (table) => {
    table.text('key_value_auth_tag').nullable();
  });

  await createTableIfMissing(knex, 'agentrail_saas_users', (table) => {
    table.text('id').primary();
    table.text('email').notNullable().unique();
    table.text('name').notNullable();
    table.text('password_hash').notNullable();
    table.text('tier').notNullable();
    table.boolean('is_admin').notNullable();
    table.boolean('is_active').notNullable();
    table.bigInteger('created_at').notNullable();
  });

  await createTableIfMissing(knex, 'agentrail_saas_api_keys_metadata', (table) => {
    table.text('id').primary();
    table.text('user_id').notNullable().references('id').inTable('agentrail_saas_users').onDelete('CASCADE');
    table.text('key_preview').notNullable();
    table.text('name').notNullable();
    table.boolean('is_active').notNullable();
    table.bigInteger('created_at').notNullable();
    table.bigInteger('last_used_at').nullable();
    table.jsonb('scopes').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });

  await createTableIfMissing(knex, 'agentrail_saas_sessions', (table) => {
    table.text('id').primary();
    table.text('user_id').notNullable().references('id').inTable('agentrail_saas_users').onDelete('CASCADE');
    table.text('token_hash').notNullable().unique();
    table.text('csrf_token').notNullable();
    table.bigInteger('created_at').notNullable();
    table.bigInteger('expires_at').notNullable();
    table.bigInteger('last_used_at').notNullable();
  });

  await createTableIfMissing(knex, 'agentrail_saas_usage_daily', (table) => {
    table.text('user_id').notNullable().references('id').inTable('agentrail_saas_users').onDelete('CASCADE');
    table.text('date').notNullable();
    table.integer('requests').notNullable();
    table.bigInteger('prompt_tokens').notNullable();
    table.bigInteger('completion_tokens').notNullable();
    table.primary(['user_id', 'date']);
  });

  await createTableIfMissing(knex, 'agentrail_saas_tiers', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.bigInteger('requests_per_day').nullable();
    table.integer('max_api_keys').notNullable();
    table.bigInteger('max_tokens_per_day').nullable();
    table.double('price_monthly').notNullable();
    table.jsonb('features').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });

  await createTableIfMissing(knex, 'agentrail_saas_audit_events', (table) => {
    table.text('id').primary();
    table.text('type').notNullable();
    table.text('user_id').nullable();
    table.text('ip').nullable();
    table.jsonb('metadata').nullable();
    table.bigInteger('created_at').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('agentrail_saas_audit_events');
  await knex.schema.dropTableIfExists('agentrail_saas_tiers');
  await knex.schema.dropTableIfExists('agentrail_saas_usage_daily');
  await knex.schema.dropTableIfExists('agentrail_saas_sessions');
  await knex.schema.dropTableIfExists('agentrail_saas_api_keys_metadata');
  await knex.schema.dropTableIfExists('agentrail_saas_api_secrets');
  await knex.schema.dropTableIfExists('agentrail_saas_users');
  await knex.schema.dropTableIfExists('agentrail_gateway_secrets');
  await knex.schema.dropTableIfExists('agentrail_provider_secrets');
};
