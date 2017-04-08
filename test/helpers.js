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


module.exports.setupDatabase = (models) => {
    return new Promise((resolve, reject) => {
        module.exports.emptyDatabase().then(() => {
            Promise.all(models.map(model => Tasks.newModel(model, { knex, knex_test: knex }))).then(results => {
                resolve(Tasks.migrate([], { knex, knex_test: knex }));
            }).catch(err => {
                reject(err);
            });
        });
    });
};
