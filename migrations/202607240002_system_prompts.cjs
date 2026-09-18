async function createTableIfMissing(knex, tableName, createTable) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, createTable);
  }
}

exports.up = async function up(knex) {
  await createTableIfMissing(knex, 'agentrail_system_prompts', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.text('content').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('agentrail_system_prompts');
  if (exists) {
    await knex.schema.dropTable('agentrail_system_prompts');
  }
};