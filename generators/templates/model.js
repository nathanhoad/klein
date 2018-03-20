const Klein = require('klein/auto');

module.exports = Klein.model('<%= tableName %>'<% if (timestamps) { %>, { timestamps: <%- JSON.stringify(timestamps) %> }<% } %>);
