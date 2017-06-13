const { test } = require('ava');
const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');

const Log = require('../tasks/log');
Log.silent = true;
const Helpers = require('./helpers');

const Klein = require('../auto');
const DisconnectedKlein = Klein.create()


test('It can build independent queries', t => {
    const Users = Klein.model('users');
    
    const where = Users.where({ email: 'test@test.com' }).toString();
    t.is(where, `select * from "users" where "email" = 'test@test.com'`);
    
    const where_like = Users.where('email', 'like', '%test%').toString();
    t.is(where_like, `select * from "users" where "email" like '%test%'`);
    
    const paging = Users.where({ name: 'Test'}).page(3, 20).toString();
    t.is(paging, `select * from "users" where "name" = 'Test' limit 20 offset 40`);
    
    const order = Users.order('created_at desc').toString();
    t.is(order, `select * from "users" order by created_at desc`);
    
    const where_in = Users.whereIn('name', ['Nathan', 'Lilly']).toString();
    t.is(where_in, `select * from "users" where "name" in ('Nathan', 'Lilly')`);
    
    const where_not_in = Users.whereNotIn('name', ['Nathan', 'Lilly']).toString();
    t.is(where_not_in, `select * from "users" where "name" not in ('Nathan', 'Lilly')`);
    
    const where_null = Users.whereNull('name').toString();
    t.is(where_null, `select * from "users" where "name" is null`);
    
    const where_not_null = Users.whereNotNull('name').toString();
    t.is(where_not_null, `select * from "users" where "name" is not null`);
});

test('It throws an error when building independent queries without being connected', t => {
    const Users = DisconnectedKlein.model('users')

    const expected_error = /Klein must be connected/

    t.throws(() => {
        Users.where({ email: 'test@test.com'})
    }, expected_error)
})


test.serial('It can create a new instance', t => {
    const Tasks = require('../tasks');
    
    process.env.APP_ROOT = '/tmp/klein/new-instance';
    FS.removeSync(process.env.APP_ROOT);
    
    return Helpers.setupDatabase([
        ['list', 'name:string', 'tasks:jsonb']
    ]).then(() => {
        const Lists = Klein.model('lists');
        
        const new_list = { 
            name: 'Todo', 
            tasks: ['first', 'second', 'third'] 
        };
        
        return Lists.create(new_list).then(list => {
            t.is(list.get('name'), new_list.name);
            t.is(list.get('tasks').count(), new_list.tasks.length);
        });
    });
});


test.serial('It can save/restore/destroy an instance', t => {
    const Lists = Klein.model('lists');
    
    const Tasks = require('../tasks');
    
    process.env.APP_ROOT = '/tmp/klein/save-and-restore-instance';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_list = {
        name: 'Todo', 
        tasks: ['first', 'second', 'third'] 
    };
    
    return Helpers.setupDatabase([
        ['list', 'name:string', 'tasks:jsonb']
    ]).then(() => {
        
        return Lists.create(new_list);
        
    }).then(list => {
        
        return Lists.find(list.get('id'));
        
    }).then(list => {
        t.is(list.get('name'), new_list.name);
        t.is(list.get('tasks').count(), new_list.tasks.length);
        t.is(list.getIn(['tasks', 0]), new_list.tasks[0]);
        
        list = list.set('name', 'New Name');
        list = list.set('tasks', list.get('tasks').push('fourth'));
        
        return Lists.save(list);
    }).then(list => {
        
        return Lists.where({ name: 'New Name' }).first();
        
    }).then(list => {
        
        t.is(list.get('name'), 'New Name');
        t.is(list.get('tasks').count(), new_list.tasks.length + 1);
        t.is(list.get('tasks').last(), 'fourth');
        
        return Lists.destroy(list);
        
    }).then(deleted_list => {
        
        return Lists.reload(deleted_list).then(list => {
            
            t.is(list, null);
            
        });
    });
});

test('It throws when saving/restoring/destroying instances without being connected', t => {
    const Lists = DisconnectedKlein.model('lists')

    const expected_error = /Klein must be connected/

    const new_list = {
        name: 'Todo', 
        tasks: ['first', 'second', 'third'] 
    }

    const saved_list = Immutable.Map({
        id: uuid(),
        name: 'Todo', 
        tasks: ['first', 'second', 'third']    
    })

    t.throws(() => {
        Lists.create(new_list)
    }, expected_error)

    t.throws(() => {
        Lists.find('some-id')
    }, expected_error)

    t.throws(() => {
        Lists.save(saved_list)
    }, expected_error)

    t.throws(() => {
        Lists.destroy(saved_list)
    }, expected_error)

    t.throws(() => {
        Lists.reload(saved_list)
    }, expected_error)
})


test.serial('It can save/restore a collection', t => {
    const Lists = Klein.model('lists');
    
    const Tasks = require('../tasks');
    
    process.env.APP_ROOT = '/tmp/klein/save-and-restore-collection';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_lists = [
        {
            name: 'Todo', 
            tasks: ['first', 'second', 'third'] 
        },
        {
            name: 'Done',
            tasks: ['one', 'two']
        }
    ];
    
    return Helpers.setupDatabase([
        ['list', 'name:string', 'tasks:jsonb']
    ]).then(() => {
        return Lists.create(new_lists);
    }).then(lists => {
        
        t.is(lists.getIn([0, 'name']), new_lists[0].name);
        
        return Lists.all();
        
    }).then(lists => {
        t.is(lists.count(), 2);
        t.is(lists.getIn([1, 'tasks', 0]), new_lists[1].tasks[0]);
    });
});


test.serial('It can create instances with defaults', t => {
    const Lists = Klein.model('lists', {
        defaults: {
            name: 'Untitled List',
            tasks_count: (properties) => {
                return properties.tasks.length;
            }
        }
    });
    
    const Tasks = require('../tasks');
    
    process.env.APP_ROOT = '/tmp/klein/save-and-restore-defaults';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_list = {
        tasks: ['first', 'second', 'third'] 
    };
    
    return Helpers.setupDatabase([
        ['list', 'name:string', 'tasks:jsonb', 'tasks_count:integer']
    ]).then(() => {
        
        return Lists.create(new_list);
        
    }).then(list => {
        return Lists.find(list.get('id'));
    }).then(list => {
        
        t.is(list.get('name'), Lists.defaults.name);
        t.is(list.get('tasks_count'), new_list.tasks.length);
        
    });
});


test('It can convert a model to json', t => {
    const Users = Klein.model('users', {
        contexts: {
            special (instance) {
                return instance.merge({
                    is_special: true
                });
            },
            simple: ['first_name', 'last_name'],
            everything: '*'
        }
    });
    
    const user = Immutable.fromJS({
        first_name: 'Nathan',
        last_name: 'Hoad',
        email: 'test@test.com',
        created_at: new Date()
    });
    
    const json1 = Users.json(user, 'special');
    t.is(json1 instanceof Object, true);
    t.is(json1.first_name, user.get('first_name'));
    t.is(json1.is_special, true);
    
    const json2 = Users.json(user, 'simple');
    t.is(json2 instanceof Object, true);
    t.is(Object.keys(json2).length, Users.contexts.simple.length);
    t.is(json2.first_name, user.get('first_name'));
    
    const json3 = Users.json(user, 'everything');
    t.is(json3 instanceof Object, true);
    t.is(Object.keys(json3).length, Object.keys(user.toJS()).length);
    t.is(json3.first_name, user.get('first_name'));
    t.is(json3.email, user.get('email'));
    
    const json4 = Users.json(user);
    t.is(json4 instanceof Object, true);
    t.is(Object.keys(json4).length, Object.keys(user.toJS()).length);
    t.is(json4.first_name, user.get('first_name'));
    t.is(json4.email, user.get('email'));
    
    function name (instance) {
        return Immutable.Map({
            name: instance.get('first_name') + ' ' + instance.get('last_name')
        });
    }
    
    const json5 = Users.json(user, name);
    t.is(json5 instanceof Object, true);
    t.is(Object.keys(json5).length, 1);
    t.is(json5.name, user.get('first_name') + ' ' + user.get('last_name'));
});


test('it can convert a list of models to json', t => {
    const Users = Klein.model('users', {
        contexts: {
            special (instance) {
                return instance.merge({
                    is_special: true
                });
            }
        }
    });
    
    const users = Immutable.fromJS([
        {
            first_name: 'Nathan',
            last_name: 'Hoad',
            email: 'test@test.com',
            created_at: new Date()
        },
        {
            first_name: 'Lilly',
            last_name: 'Piri',
            email: 'lilly@test.com',
            created_at: new Date()
        }
    ]);
    
    const json1 = Users.json(users, 'special');
    
    t.is(json1.length, 2);
    t.is(json1 instanceof Array, true);
    t.is(json1[0].first_name, users.getIn([0, 'first_name']));
    t.is(json1[0].is_special, true);
    t.is(json1[1].first_name, users.getIn([1, 'first_name']));
    t.is(json1[1].is_special, true);
    
    const json2 = Users.json(users);
    t.is(json2.length, 2);
    t.is(json2 instanceof Array, true);
    t.is(json2[0].first_name, users.getIn([0, 'first_name']));
    t.is(Object.keys(json2[0]).length, Object.keys(users.get(0).toJS()).length);
    t.is(json2[1].first_name, users.getIn([1, 'first_name']));
    t.is(Object.keys(json2[1]).length, Object.keys(users.get(1).toJS()).length);
});


test('It defaults to using the default context if it exists', t => {
    const Users = Klein.model('users', {
        contexts: {
            default (user) {
                return user.merge({
                    used_default: true
                });
            }
        }
    });
    
    const user = Immutable.fromJS({
        first_name: 'Nathan',
        last_name: 'Hoad',
        email: 'test@test.com',
        created_at: new Date()
    });
    
    const json1 = Users.json(user);
    t.is(json1.used_default, true);
    
    const json2 = Users.json([user, user]);
    t.is(json2[0].used_default, true);
});


test('It can convert a model to json that has relations on it', t => {
    const Users = Klein.model('users', {
        contexts: {
            simple: ['first_name', 'last_name', 'hats'],
            special (props) {
                props = props.filter((v, k) => ['first_name', 'email', 'hats'].includes(k));
                
                if (props.has('hats')) {
                    props = props.set('hats', Klein.model('hats').json(props.get('hats'), 'simple'));
                }
                
                return props;
            }
        },
        relations: {
            hats: { has_many: 'hats' }
        }
    });
    
    const Hats = Klein.model('hats', {
        contexts: {
            simple: ['type']
        },
        relations: {
            user: { belongs_to: 'users' }
        }
    });
    
    const user_with_hats = Immutable.fromJS({
        first_name: 'Nathan',
        last_name: 'Hoad',
        email: 'test@test.com',
        created_at: new Date(),
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
        first_name: 'Nathan',
        last_name: 'Hoad',
        email: 'test@test.com',
        created_at: new Date()
    });
    
    const json1 = Users.json(user_with_hats, 'simple');
    t.is(json1 instanceof Object, true);
    t.is(json1.first_name, user_with_hats.get('first_name'));
    t.is(json1.hats.length, 2);
    t.is(json1.hats[0].type, user_with_hats.getIn(['hats', 0, 'type']));
    t.is(json1.hats[0].size, undefined);
    
    const json2 = Users.json(user_with_hats, 'special');
    t.is(json2 instanceof Object, true);
    t.is(json2.first_name, user_with_hats.get('first_name'));
    t.is(json2.hats.length, 2);
    t.is(json2.hats[0].type, user_with_hats.getIn(['hats', 0, 'type']));
    t.is(json2.hats[0].size, undefined);
});



test('It can use alternative timestamps', t => {
    const Users = Klein.model('users', {
        timestamps: {
            created_at: 'createdAt',
            updated_at: 'updatedAt'
        }
    });
    
    const Tasks = require('../tasks');
    
    process.env.APP_ROOT = '/tmp/klein/alternative-timestamps';
    FS.removeSync(process.env.APP_ROOT);
    
    return Helpers.setupDatabase([
        ['users', 'name:string']
    ], { timestamps: { created_at: 'createdAt', updated_at: 'updatedAt' }}).then(() => {
        return Users.save({
            name: 'Nathan'
        });
    }).then(user => {
        
        t.is(user.get('name'), 'Nathan');
        t.true(user.has('createdAt'));
        t.false(user.has('created_at'));
        t.true(user.has('updatedAt'));
        t.false(user.has('updated_at'));
        
    });
})
