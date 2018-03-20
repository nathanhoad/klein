const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');

const Helpers = require('./__helpers__');

let Klein;

beforeEach(() => {
  Klein = require('..')
    .create()
    .connect();
});

afterEach(() => {
  Klein.disconnect();
});

test('It can create a model and fetch it within a transaction', async () => {
  const Users = Klein.model('users');

  process.env.APP_ROOT = '/tmp/klein/transaction-simple';
  FS.removeSync(process.env.APP_ROOT);

  const nathan = { name: 'Nathan' };

  await Helpers.setupDatabase([['users', 'name:string']], { knex: Klein.knex });

  return Klein.transaction(async transaction => {
    let n = await Users.create(nathan, { transaction });
    let user = await Users.find(n.get('id'));
    // Won't be found without passing the transaction
    expect(user).toBeNull();

    user = await Users.find(n.get('id'), { transaction });
    // Can be found because we passed the transaction
    expect(user.get('id')).toBe(n.get('id'));
  }).then(async () => {
    let user = await Users.where({ name: nathan.name }).first();

    // Don't need to pass the transaction after it has been commited
    expect(user).not.toBeNull();
  });
});

test('It can create a model and its relations within a transaction', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasMany: 'projects' }
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

  await Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  return Klein.transaction(async transaction => {
    let n = await Users.create(nathan, { transaction });
    let user = await Users.find(n.get('id'));
    // Won't be found without passing the transaction
    expect(user).toBeNull();

    let projects = await Projects.all();
    // No projects have been commited from the transaction yet
    expect(projects.count()).toBe(0);

    user = await Users.find(n.get('id'), { transaction });
    // Can be found because we passed the transaction
    expect(user.get('id')).toBe(n.get('id'));

    projects = await Projects.all({ transaction });
    // The projects have been commited
    expect(projects.count()).toBe(2);
  }).then(async () => {
    let user = await Users.where({ name: nathan.name }).first();

    // Don't need to pass the transaction after it has been commited
    expect(user).not.toBeNull();

    projects = await Projects.all();
    expect(projects.count()).toBe(2);
  });
});
