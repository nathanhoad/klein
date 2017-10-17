module.exports = {
  up(knex, Promise) {
    return knex.schema.{{ACTION}}('{{TABLE}}', table => {
      {{ADDCOLUMNS}}{{INDICES}}
    });
  },

  down(knex, Promise) {
    return knex.schema.table('{{TABLE}}', table => {
      {{DROPCOLUMNS}}
    });
  }
};
