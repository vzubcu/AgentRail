async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, 'agentrail_virtual_models', 'system_prompt', (table) => {
    table.text('system_prompt').nullable();
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasColumn('agentrail_virtual_models', 'system_prompt');
  if (exists) {
    await knex.schema.alterTable('agentrail_virtual_models', (table) => {
      table.dropColumn('system_prompt');
    });
  }
};
