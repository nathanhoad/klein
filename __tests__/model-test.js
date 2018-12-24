const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');

const Helpers = require('./__helpers__');

let Klein;
const DisconnectedKlein = require('..').create();

beforeEach(() => {
  Klein = require('..')
    .create()
    .connect();
});

afterEach(() => {
  Klein.disconnect();
});

describe('Queries', () => {
  test('It can build independent queries', () => {
    const Users = Klein.model('users');

    // Basic where
    expect(Users.where({ email: 'test@test.com' }).toString()).toBe(
      `select * from "users" where "email" = 'test@test.com'`
    );

    // Where like
    expect(Users.where('email', 'like', '%test%').toString()).toBe(`select * from "users" where "email" like '%test%'`);

    // Pagig
    expect(
      Users.where({ name: 'Test' })
        .page(3, 20)
        .toString()
    ).toBe(`select * from "users" where "name" = 'Test' limit 20 offset 40`);

    // Order
    expect(Users.order('createdAt desc').toString()).toBe(`select * from "users" order by createdAt desc`);

    // Where in
    expect(Users.whereIn('name', ['Nathan', 'Lilly']).toString()).toBe(
      `select * from "users" where "name" in ('Nathan', 'Lilly')`
    );

    // Where not in
    expect(Users.whereNotIn('name', ['Nathan', 'Lilly']).toString()).toBe(
      `select * from "users" where "name" not in ('Nathan', 'Lilly')`
    );

    // Where null
    expect(Users.whereNull('name').toString()).toBe(`select * from "users" where "name" is null`);

    // Where not null
    expect(Users.whereNotNull('name').toString()).toBe(`select * from "users" where "name" is not null`);
  });

  test('It throws an error when building independent queries without being connected', () => {
    const Users = DisconnectedKlein.model('users');
    expect(() => {
      Users.where({ email: 'test@test.com' });
    }).toThrow(/Klein must be connected/);
  });
});

describe('Instances', () => {
  test('It can create a new instance', async () => {
    process.env.APP_ROOT = '/tmp/klein/new-instance';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string', 'tasks:jsonb']], { knex: Klein.knex });

    const Lists = Klein.model('lists');

    const newList = {
      name: 'Todo',
      tasks: ['first', 'second', 'third']
    };

    let list = await Lists.create(newList);

    expect(list.get('name')).toBe(newList.name);
    expect(list.get('tasks').count()).toBe(newList.tasks.length);
  });

  test('It can create a custom new instance through a custom type factory', async () => {
    process.env.APP_ROOT = '/tmp/klein/new-instance-custom-factory';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string', 'tasks:jsonb']], { knex: Klein.knex });

    const customInstance = Immutable.Map({ something: 'else' })

    const newList = {
      name: 'Todo',
      tasks: ['first', 'second', 'third']
    };

    const Lists = Klein.model('lists', { 
      type: {
        factory: (instance) => {
          expect(instance.get('name')).toBe(newList.name);
          return customInstance;
        }
      }
    });

    let list = await Lists.create(newList);

    expect(customInstance.equals(list)).toBe(true);
  });

  test('It can save/restore/destroy an instance', async () => {
    const Lists = Klein.model('lists');

    process.env.APP_ROOT = '/tmp/klein/save-and-restore-instance';
    FS.removeSync(process.env.APP_ROOT);

    const newList = {
      name: 'Todo',
      tasks: ['first', 'second', 'third']
    };

    await Helpers.setupDatabase([['list', 'name:string', 'tasks:jsonb']], { knex: Klein.knex });

    let list = await Lists.create(newList);

    list = await Lists.find(list.get('id'));

    expect(list.get('name')).toBe(newList.name);
    expect(list.get('tasks').count()).toBe(newList.tasks.length);
    expect(list.getIn(['tasks', 0])).toBe(newList.tasks[0]);

    list = list.set('name', 'New Name');
    list = list.set('tasks', list.get('tasks').push('fourth'));
    list = await Lists.save(list);

    list = await Lists.where({ name: 'New Name' }).first();

    expect(list.get('name')).toBe('New Name');
    expect(list.get('tasks').count()).toBe(newList.tasks.length + 1);
    expect(list.get('tasks').last()).toBe('fourth');

    let deletedList = await Lists.destroy(list);

    list = await Lists.reload(deletedList);
    expect(list).toBeNull();
  });

  test('It can save/restore/destroy an instance of custom type', async () => {
    process.env.APP_ROOT = '/tmp/klein/save-and-restore-custom-instance';
    FS.removeSync(process.env.APP_ROOT);

    const newList = {
      name: 'Todo',
      tasks: ['first', 'second', 'third']
    };

    const Lists = Klein.model('lists', {
      type: {
        factory: (instance) => {
          return instance.set('__typeName', 'list');
        },
        serialize: (customInstance) => {
          return customInstance.remove('__typeName').toJS()
        },
        instanceOf: (maybeInstance) => {
          return maybeInstance && maybeInstance.toJS && maybeInstance.get('__typeName') === 'list';
        }
      }
    });

    await Helpers.setupDatabase([['list', 'name:string', 'tasks:jsonb']], { knex: Klein.knex });

    let list = await Lists.create(newList);

    list = await Lists.find(list.get('id'));
    expect(list.get('__typeName')).toBe('list');

    list = list.set('name', 'New Name');
    list = list.set('tasks', list.get('tasks').push('fourth'));
    list = await Lists.save(list);
    
    list = await Lists.where({ name: 'New Name' }).first();

    expect(list.get('name')).toBe('New Name');
    expect(list.get('tasks').count()).toBe(newList.tasks.length + 1);
    expect(list.get('tasks').last()).toBe('fourth');
    expect(list.get('__typeName')).toBe('list');

    let deletedList = await Lists.destroy(list);

    list = await Lists.reload(deletedList);
    expect(list).toBeNull();
  })

  test('It throws when saving/restoring/destroying instances without being connected', async () => {
    const Lists = DisconnectedKlein.model('lists');

    const expectedError = /Klein must be connected/;

    const newList = {
      name: 'Todo',
      tasks: ['first', 'second', 'third']
    };

    const savedList = Immutable.Map({
      id: uuid(),
      name: 'Todo',
      tasks: ['first', 'second', 'third']
    });

    try {
      await Lists.create(newList);
    } catch (ex) {
      expect(ex.message).toMatch(expectedError);
    }

    try {
      await Lists.find('some-id');
    } catch (ex) {
      expect(ex.message).toMatch(expectedError);
    }

    try {
      await Lists.save(savedList);
    } catch (ex) {
      expect(ex.message).toMatch(expectedError);
    }

    try {
      await Lists.destroy(savedList);
    } catch (ex) {
      expect(ex.message).toMatch(expectedError);
    }

    try {
      await Lists.reload(savedList);
    } catch (ex) {
      expect(ex.message).toMatch(expectedError);
    }
  });

  test("It can strip out fields that aren't in the table", async () => {
    const Lists = Klein.model('lists', {
      relations: {
        items: { hasMany: 'items' }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/ignore-bad-fields';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string'], ['item', 'task:string', 'listId:uuid']], {
      knex: Klein.knex
    });

    const newList = {
      name: 'This field is in the table',
      items: [
        {
          task: 'This field is in a relation'
        }
      ],
      another: 'This is a bad field'
    };
    const list = await Lists.create(newList);

    expect(list.get('name')).toBe(newList.name);
    expect(list.getIn(['items', 0, 'task'])).toBe(newList.items[0].task);
    expect(list.get('another')).toBeUndefined();
  });
});

describe('Collections', () => {
  test('It can save/restore a collection', async () => {
    const Lists = Klein.model('lists');

    process.env.APP_ROOT = '/tmp/klein/save-and-restore-collection';
    FS.removeSync(process.env.APP_ROOT);

    const newLists = [
      {
        name: 'Todo',
        tasks: ['first', 'second', 'third']
      },
      {
        name: 'Done',
        tasks: ['one', 'two']
      }
    ];

    await Helpers.setupDatabase([['lists', 'name:string', 'tasks:jsonb']], { knex: Klein.knex });

    let lists = await Lists.create(newLists);
    expect(lists.getIn([0, 'name'])).toBe(newLists[0].name);

    lists = await Lists.all();
    expect(lists.count()).toBe(2);
  });
});

describe('JSON', () => {
  test('It can convert a model to json', () => {
    const Users = Klein.model('users', {
      contexts: {
        special(instance) {
          return instance.merge({
            isSpecial: true
          });
        },
        simple: ['firstName', 'lastName'],
        everything: '*'
      }
    });

    const user = Immutable.fromJS({
      firstName: 'Nathan',
      lastName: 'Hoad',
      email: 'test@test.com',
      createdAt: new Date()
    });

    const json1 = Users.json(user, 'special');
    expect(json1 instanceof Object).toBeTruthy();
    expect(json1.firstName).toBe(user.get('firstName'));
    expect(json1.isSpecial).toBeTruthy();

    const json2 = Users.json(user, 'simple');
    expect(json2 instanceof Object).toBeTruthy();
    expect(Object.keys(json2).length).toBe(Users.contexts.simple.length);
    expect(json2.firstName).toBe(user.get('firstName'));

    const json3 = Users.json(user, 'everything');
    expect(json3 instanceof Object).toBeTruthy();
    expect(Object.keys(json3).length).toBe(Object.keys(user.toJS()).length);
    expect(json3.firstName).toBe(user.get('firstName'));
    expect(json3.email).toBe(user.get('email'));

    const json4 = Users.json(user);
    expect(json4 instanceof Object).toBeTruthy();
    expect(Object.keys(json4).length).toBe(Object.keys(user.toJS()).length);
    expect(json4.firstName).toBe(user.get('firstName'));
    expect(json4.email).toBe(user.get('email'));

    function name(instance) {
      return Immutable.Map({
        name: instance.get('firstName') + ' ' + instance.get('lastName')
      });
    }

    const json5 = Users.json(user, name);
    expect(json5 instanceof Object).toBeTruthy();
    expect(Object.keys(json5).length).toBe(1);
    expect(json5.name).toBe(user.get('firstName') + ' ' + user.get('lastName'));
  });

  test('it can convert a list of models to json', () => {
    const Users = Klein.model('users', {
      contexts: {
        special(instance) {
          return instance.merge({
            isSpecial: true
          });
        }
      }
    });

    const users = Immutable.fromJS([
      {
        firstName: 'Nathan',
        lastName: 'Hoad',
        email: 'test@test.com',
        createdAt: new Date()
      },
      {
        firstName: 'Lilly',
        lastName: 'Piri',
        email: 'lilly@test.com',
        createdAt: new Date()
      }
    ]);

    const json1 = Users.json(users, 'special');

    expect(json1.length).toBe(2);
    expect(json1 instanceof Array).toBeTruthy();
    expect(json1[0].firstName).toBe(users.getIn([0, 'firstName']));
    expect(json1[0].isSpecial).toBeTruthy();
    expect(json1[1].firstName).toBe(users.getIn([1, 'firstName']));
    expect(json1[1].isSpecial).toBeTruthy();

    const json2 = Users.json(users);
    expect(json2.length).toBe(2);
    expect(json2 instanceof Array).toBeTruthy();
    expect(json2[0].firstName).toBe(users.getIn([0, 'firstName']));
    expect(Object.keys(json2[0]).length).toBe(Object.keys(users.get(0).toJS()).length);
    expect(json2[1].firstName).toBe(users.getIn([1, 'firstName']));
    expect(Object.keys(json2[1]).length).toBe(Object.keys(users.get(1).toJS()).length);
  });

  test('It defaults to using the default context if it exists', () => {
    const Users = Klein.model('users', {
      contexts: {
        default(user) {
          return user.merge({
            usedDefault: true
          });
        }
      }
    });

    const user = Immutable.fromJS({
      firstName: 'Nathan',
      lastName: 'Hoad',
      email: 'test@test.com',
      createdAt: new Date()
    });

    const json1 = Users.json(user);
    expect(json1.usedDefault).toBeTruthy();

    const json2 = Users.json([user, user]);
    expect(json2[0].usedDefault).toBeTruthy();
  });

  test('It can convert a model to json that has relations on it', () => {
    const Users = Klein.model('users', {
      contexts: {
        simple: ['firstName', 'lastName', 'hats'],
        special(props) {
          props = props.filter((v, k) => ['firstName', 'email', 'hats'].includes(k));

          if (props.has('hats')) {
            props = props.set('hats', Klein.model('hats').json(props.get('hats'), 'simple'));
          }

          return props;
        }
      },
      relations: {
        hats: { hasMany: 'hats' }
      }
    });

    const Hats = Klein.model('hats', {
      contexts: {
        simple: ['type']
      },
      relations: {
        user: { belongsTo: 'users' }
      }
    });

    const userWithHats = Immutable.fromJS({
      firstName: 'Nathan',
      lastName: 'Hoad',
      email: 'test@test.com',
      createdAt: new Date(),
      hats: [
        {
          type: 'cowboy',
          size: 'L'
        },
        {
          type: 'cap',
          size: 'L'
        }
      ]
    });

    const user_with_no_hats = Immutable.fromJS({
      firstName: 'Nathan',
      lastName: 'Hoad',
      email: 'test@test.com',
      createdAt: new Date()
    });

    const json1 = Users.json(userWithHats, 'simple');
    expect(json1 instanceof Object).toBeTruthy();
    expect(json1.firstName).toBe(userWithHats.get('firstName'));
    expect(json1.hats.length).toBe(2);
    expect(json1.hats[0].type).toBe(userWithHats.getIn(['hats', 0, 'type']));
    expect(json1.hats[0].size).toBeUndefined();

    const json2 = Users.json(userWithHats, 'special');
    expect(json2 instanceof Object).toBeTruthy();
    expect(json2.firstName).toBe(userWithHats.get('firstName'));
    expect(json2.hats.length).toBe(2);
    expect(json2.hats[0].type).toBe(userWithHats.getIn(['hats', 0, 'type']));
    expect(json2.hats[0].size).toBeUndefined();
  });

  test('It can use alternative timestamps', async () => {
    const Users = Klein.model('users', {
      timestamps: {
        createdAt: 'created',
        updatedAt: 'updated'
      }
    });

    process.env.APP_ROOT = '/tmp/klein/alternative-timestamps';
    FS.removeSync(process.env.APP_ROOT);
    FS.ensureDirSync(process.env.APP_ROOT);
    FS.writeFileSync(
      process.env.APP_ROOT + '/package.json',
      JSON.stringify({
        klein: { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
      })
    );

    await Helpers.setupDatabase([['users', 'name:string']], { knex: Klein.knex });

    let user = await Users.save({ name: 'Nathan' });

    expect(user.get('name')).toBe('Nathan');
    expect(user.has('created')).toBeTruthy();
    expect(user.has('createdAt')).toBeFalsy();
    expect(user.has('updated')).toBeTruthy();
    expect(user.has('updatedAt')).toBeFalsy();
  });
});

describe('Schema', () => {
  test('It can load the schema for a model', async () => {
    const Lists = Klein.model('lists');

    process.env.APP_ROOT = '/tmp/klein/load-schema';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string', 'tasks:jsonb']], { knex: Klein.knex });

    const schema = await Lists.schema();
    expect(typeof schema).toBe('object');

    const keys = Object.keys(schema);
    expect(keys.length).toBe(5);
    expect(keys).toContain('id');
    expect(keys).toContain('name');
    expect(keys).toContain('tasks');
    expect(keys).toContain('createdAt');
    expect(keys).toContain('updatedAt');

    expect(schema.id.nullable).toBeFalsy();
    expect(schema.id.type).toBe('uuid');

    expect(schema.name.maxLength).toBe(255);

    expect(schema.tasks.type).toBe('jsonb');
  });
});

describe('Hooks', () => {
  test('It exposes beforeCreate', async () => {
    const Lists = Klein.model('lists', {
      hooks: {
        beforeCreate(model) {
          return model.set('dueDate', new Date(2017, 0, 1));
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-create';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string', 'dueDate:timestamp']], { knex: Klein.knex });

    const list = await Lists.create({ name: 'New List' });

    expect(list.get('dueDate')).not.toBeUndefined();
    expect(list.get('dueDate')).toBeInstanceOf(Date);
  });

  test('It throws when beforeCreate fails to return a model', async () => {
    const Lists = Klein.model('lists', {
      hooks: {
        beforeCreate(model) {
          model = model.set('name', 'some value');
          // Nothing was returned!?!
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-create-throws';
    FS.removeSync(process.env.APP_ROOT);
    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    try {
      await Lists.create({ name: 'New List' });
    } catch (ex) {
      expect(ex.message).toMatch(/must return a model/);
    }
  });

  test('It throws when beforeSave fails to return a model', async () => {
    const Lists = Klein.model('lists', {
      hooks: {
        beforeSave(model) {
          model = model.set('name', 'some value');
          // Nothing was returned!?!
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save-throws';
    FS.removeSync(process.env.APP_ROOT);
    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    try {
      await Lists.create({ name: 'New List' });
    } catch (ex) {
      expect(ex.message).toMatch(/must return a model/);
    }
  });

  test('It exposes beforeSave', async () => {
    const Lists = Klein.model('lists', {
      hooks: {
        beforeSave(model) {
          return model.set('saveCount', model.get('saveCount', 0) + 1);
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string', 'saveCount:integer']], { knex: Klein.knex });

    let list = await Lists.create({ name: 'New List' });

    expect(list.get('saveCount')).not.toBeUndefined();
    expect(list.get('saveCount')).toBe(1);

    list = await Lists.save(list);

    expect(list.get('saveCount')).toBe(2);
  });

  test('It exposes afterCreate', async () => {
    let value = false;
    const Lists = Klein.model('lists', {
      hooks: {
        afterCreate(model) {
          value = true;
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    let list = await Lists.create({ name: 'New List' });

    expect(list.get('name')).toBe('New List');
    expect(value).toBeTruthy();
  });

  test('It exposes afterSave', async () => {
    let value = false;
    const Lists = Klein.model('lists', {
      hooks: {
        afterSave(model) {
          value = true;
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    let list = await Lists.create({ name: 'New List' });

    expect(list.get('name')).toBe('New List');
    expect(value).toBeTruthy();
  });

  test('It exposes beforeDestroy', async () => {
    let value = false;
    const Lists = Klein.model('lists', {
      hooks: {
        beforeDestroy(model) {
          value = true;
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    let list = await Lists.create({ name: 'New List' });
    await Lists.destroy(list);

    expect(value).toBeTruthy();
  });

  test('It exposes afterDestroy', async () => {
    let value = false;
    const Lists = Klein.model('lists', {
      hooks: {
        afterDestroy(model) {
          value = true;
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    let list = await Lists.create({ name: 'New List' });
    await Lists.destroy(list);

    expect(value).toBeTruthy();
  });

  test('It runs a bunch of hooks', async () => {
    let beforeCreate = 0;
    let beforeSave = 0;
    let afterSave = 0;
    let afterCreate = 0;
    let beforeDestroy = 0;
    let afterDestroy = 0;
    let order = 1;
    const Lists = Klein.model('lists', {
      hooks: {
        beforeCreate(model) {
          beforeCreate = order++;
          return model;
        },
        beforeSave(model) {
          beforeSave = order++;
          return model;
        },
        afterSave() {
          afterSave = order++;
        },
        afterCreate() {
          afterCreate = order++;
        },
        beforeDestroy() {
          beforeDestroy = order++;
        },
        afterDestroy(model) {
          afterDestroy = order++;
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-before-save';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string']], { knex: Klein.knex });

    let list = await Lists.create({ name: 'New List' });
    await Lists.destroy(list);

    expect(beforeCreate).toBe(1);
    expect(beforeSave).toBe(2);
    expect(afterSave).toBe(3);
    expect(afterCreate).toBe(4);
    expect(beforeDestroy).toBe(5);
    expect(afterDestroy).toBe(6);
  });

  test('It is compatible with custom types', async () => {
    const Lists = Klein.model('lists', {
      type: {
        factory: (instance) => {
          return Immutable.Map({ custom: true, wrapped: Immutable.fromJS(instance) })
        },
        serialize: (instance) => {
          return instance.get('wrapped').toJS()
        }
      },
      hooks: {
        beforeCreate(model) {
          expect(model.get('custom')).toBeTruthy()
          return model.setIn(['wrapped', 'dueDate'], new Date(2017, 0, 1));
        }
      }
    });

    process.env.APP_ROOT = '/tmp/klein/hooks-custom-types';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.setupDatabase([['list', 'name:string', 'dueDate:timestamp']], { knex: Klein.knex });

    const list = await Lists.create({ name: 'New List' });

    expect(list.getIn(['wrapped', 'dueDate'])).not.toBeUndefined();
    expect(list.getIn(['wrapped', 'dueDate'])).toBeInstanceOf(Date);
  });
});
