module.exports = {
    up (knex, Promise) {
        return knex.schema.createTable('{{TABLE}}', (table) => {
            table.uuid('id').primary();
            {{ADD_COLUMNS}}
            // TODO: add other fields
            
            table.timestamps();
            
            table.index('created_at');
            table.index('updated_at');
        });
    },


    down (knex, Promise) {
        return knex.schema.dropTable('{{TABLE}}');
    }
};
