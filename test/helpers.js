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
};


module.exports.setupDatabase = (models) => {
    return new Promise((resolve, reject) => {
        module.exports.emptyDatabase().then(() => {
            Promise.all(models.map(model => Tasks.newModel(model, { knex }))).then(results => {
                resolve(Tasks.migrate({ knex }));
            }).catch(err => {
                reject(err);
            });
        });
    });
};
