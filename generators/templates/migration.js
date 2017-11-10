module.exports = {
  up(knex) {
    return knex.schema.<%= createTable ? 'createTable' : 'table' %>('<%= tableName %>', table => {
      <% if (createTable) { %>
        table.uuid('id').primary();
      <% } %>

      <% columns.forEach(column => { %>table.<%= column.type %>('<%= column.name %>');<% }) %>

      <% if (indices.length > 0) { %>
        // Index
        <% indices.forEach(column => { %>table.index('<%= column.name %>');<% }) %>
      <% } %>
    });
  },

  down(knex) {
    <% if (createTable) { %>
      return knex.schema.dropTable('<%= tableName %>');
    <% } else { %>
      return knex.schema.table('<%= tableName %>', table => {
        table.dropColumns(<%- columns.map(c => `'${c.name}'`).join(', ') %>);
      });
    <% } %>
  }
};
