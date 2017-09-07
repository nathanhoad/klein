process.env.DATABASE_URL = 'postgres://localhost:5432/klein_test';

const FS = require('fs-extra');
const Knex = require('knex');
const Tasks = require('../tasks');

const knex = Knex({
    connection: process.env.DATABASE_URL,
    client: 'pg',
    returning: '*'
});

module.exports.knex = knex;

module.exports.emptyDatabase = () => {
    return Tasks.emptyDatabase(['drop', 'include_schema'], { knex, knex_test: knex });
};

module.exports.setupDatabase = (models, config) => {
    return module.exports.emptyDatabase().then(() => {
        const tasks = models.map(model => {
            return Tasks.newModel(model, Object.assign({}, { knex, knex_test: knex }, config));
        });

        return Promise.all(tasks).then(results => {
            return Tasks.migrate([], { knex, knex_test: knex });
        });
    });
};
