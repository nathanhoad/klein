process.env.DATABASE_URL = 'postgres://localhost:5432/klein_test';
process.env.TEST_DATABASE_URL = 'postgres://localhost:5432/klein_test';

const Knex = require('knex');
const Tasks = require('..');

module.exports.knex = () => {
  return Knex({
    connection: process.env.DATABASE_URL,
    client: 'pg'
  });
};

module.exports.emptyDatabase = knex => {
  return Tasks.emptyDatabase(['drop', 'include_schema'], { knex, knexTest: knex });
};

module.exports.setupDatabase = async (models, config) => {
  let knex = config.knex;

  await module.exports.emptyDatabase(knex);
  await Promise.all(
    models.map(model => {
      return Tasks.newModel(model, Object.assign({}, { knex, knexTest: knex }, config));
    })
  );

  return Tasks.migrate([], { knex, knexTest: knex });
};
