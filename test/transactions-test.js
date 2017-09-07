const { test } = require('ava');
const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');

const Log = require('../tasks/log');
Log.silent = true;
const Helpers = require('./helpers');

const Klein = require('..').connect();

test('It can create a model and fetch it within a transaction', t => {
    const Users = Klein.model('users');

    process.env.APP_ROOT = '/tmp/klein/transaction-simple';
    FS.removeSync(process.env.APP_ROOT);

    const nathan = { name: 'Nathan' };

    return Helpers.setupDatabase([['users', 'name:string']]).then(() => {
        return Klein.transaction(transaction => {
            return Users.create(nathan, { transaction }).then(n => {
                return Users.find(n.get('id')).then(user => {
                    // Won't be found without passing the transaction
                    t.is(user, null);

                    return Users.find(n.get('id'), { transaction }).then(user => {
                        // Can be found because we passed the transaction
                        t.is(user.get('id'), n.get('id'));
                    });
                });
            });
        }).then(() => {
            return Users.where({ name: nathan.name })
                .first()
                .then(user => {
                    // Don't need the transaction after it has been commited
                    t.not(user, null);
                });
        });
    });
});

test('It can create a model and its relations within a transaction', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_many: 'projects' }
        }
    });
    const Projects = Klein.model('projects');

    process.env.APP_ROOT = '/tmp/klein/transaction-simple';
    FS.removeSync(process.env.APP_ROOT);

    const nathan = {
        name: 'Nathan',
        projects: [
            {
                name: 'Fun thing'
            },
            {
                name: 'Less fun thing'
            }
        ]
    };

    return Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'user_id:uuid']]).then(() => {
        return Klein.transaction(transaction => {
            return Users.create(nathan, { transaction }).then(n => {
                return Users.find(n.get('id')).then(user => {
                    // Won't be found without passing the transaction
                    t.is(user, null);

                    return Projects.all().then(projects => {
                        // No projects have been commited from the transaction yet
                        t.is(projects.count(), 0);

                        return Users.find(n.get('id'), { transaction }).then(user => {
                            // Can be found because we passed the transaction
                            t.is(user.get('id'), n.get('id'));

                            return Projects.all({ transaction }).then(projects => {
                                // The projects have been commited
                                t.is(projects.count(), 2);
                            });
                        });
                    });
                });
            });
        }).then(() => {
            return Users.where({ name: nathan.name })
                .first()
                .then(user => {
                    // Don't need the transaction after it has been commited
                    t.not(user, null);

                    return Projects.all();
                })
                .then(projects => {
                    t.is(projects.count(), 2);
                });
        });
    });
});
