process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/klein_test';
process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/klein_test';

const Knex = require('knex');
const Schema = require('../schema').createSchema({ log: false });
const Generate = require('../generate');

module.exports.knex = () => {
  return Knex({
    connection: process.env.DATABASE_URL,
    client: 'pg'
  });
};

module.exports.emptyDatabase = knex => {
  return Schema.emptyDatabase(['--drop', '--include-schema'], { knex, knexTest: knex });
};

module.exports.setupDatabase = async (models, config) => {
  let knex = config.knex;
  config = Object.assign({}, { knex, knexTest: knex }, config);

  await module.exports.emptyDatabase(knex);
  await Promise.all(models.map(model => Generate.model(model, config)));
  return Schema.migrate([], config);
};
