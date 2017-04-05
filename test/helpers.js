const FS = require('fs-extra');
const Knex = require('knex');
const Tasks = require('../tasks');


module.exports.emptyDatabase = (knex) => {
    return new Promise((resolve, reject) => {
        Promise.all([
            knex.schema.dropTableIfExists('schema_migrations'),
            knex.schema.dropTableIfExists('schema_migrations_lock'),
            knex.schema.dropTableIfExists('users'),
            knex.schema.dropTableIfExists('lists'),
            knex.schema.dropTableIfExists('teams'),
            knex.schema.dropTableIfExists('projects_users'),
            knex.schema.dropTableIfExists('projects')
        ]).then(() => {
            resolve();
        }).catch(err => {
            resolve();
        });
    });
}


module.exports.setupDatabase = (knex, models) => {
    return new Promise((resolve, reject) => {
        module.exports.emptyDatabase(knex).then(() => {
            Promise.all(models.map(model => Promise.resolve(Tasks.newModel(model)))).then(results => {
                resolve(Tasks.migrate());
            }).catch(err => {
                resolve();
            });
        });
    });
}


process.env.DATABASE_URL = 'postgres://localhost:5432/klein_test';
module.exports.knex = require('knex')({
    connection: process.env.DATABASE_URL,
    client: 'pg',
    returning: '*'
});
