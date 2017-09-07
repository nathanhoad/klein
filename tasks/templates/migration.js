module.exports = {
    up(knex, Promise) {
        return knex.schema.{{ACTION}}('{{TABLE}}', table => {
            {{ADD_COLUMNS}}{{INDICES}}
        });
    },

    down(knex, Promise) {
        return knex.schema.table('{{TABLE}}', table => {
            {{DROP_COLUMNS}}
        });
    }
};
