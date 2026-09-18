async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, 'agentrail_virtual_models', 'auto_protection', (table) => {
    table.jsonb('auto_protection').notNullable().defaultTo(knex.raw(`'{"enabled":true,"failureThreshold":3,"cooldownMs":600000}'::jsonb`));
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasColumn('agentrail_virtual_models', 'auto_protection');
  if (exists) {
    await knex.schema.alterTable('agentrail_virtual_models', (table) => {
      table.dropColumn('auto_protection');
    });
  }
};
