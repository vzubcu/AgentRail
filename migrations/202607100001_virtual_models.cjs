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
  await createTableIfMissing(knex, 'agentrail_virtual_models', (table) => {
    table.string('id', 255).primary().notNullable();
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.string('routing_strategy', 50).notNullable().defaultTo('round-robin');
    table.jsonb('capabilities').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('selected_models').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('auto_aliases').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.boolean('is_builtin').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index('is_builtin');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('agentrail_virtual_models');
};
