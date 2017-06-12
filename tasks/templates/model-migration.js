module.exports = {
    up (knex, Promise) {
        return knex.schema.createTable('{{TABLE}}', (table) => {
            table.uuid('id').primary();
            {{ADD_COLUMNS}}
            // TODO: add other fields
            {{INDICES}}
        });
    },


    down (knex, Promise) {
        return knex.schema.dropTable('{{TABLE}}');
    }
};
