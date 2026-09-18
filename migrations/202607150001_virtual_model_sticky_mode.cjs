async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, 'agentrail_virtual_models', 'sticky_mode', (table) => {
    table.string('sticky_mode', 50).notNullable().defaultTo('none');
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasColumn('agentrail_virtual_models', 'sticky_mode');
  if (exists) {
    await knex.schema.alterTable('agentrail_virtual_models', (table) => {
      table.dropColumn('sticky_mode');
    });
  }
};
