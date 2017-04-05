module.exports = {
    up (knex, Promise) {
        return knex.schema.table('{{TABLE}}', (table) => {
            {{ADD_COLUMNS}}
        });
    },


    down (knex, Promise) {
        return knex.schema.table('{{TABLE}}', (table) => {
            {{DROP_COLUMNS}}
        });
    }
};
