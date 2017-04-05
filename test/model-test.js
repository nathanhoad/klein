const { test } = require('ava');
const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');

const Log = require('../tasks/log');
Log.silent = true;
const Helpers = require('./helpers');

const Klein = require('../lib').connect();


test('It can build independent queries', t => {
    const Users = Klein.model('users');
    
    const q1 = Users.where({ email: 'test@test.com' }).toString();
    t.is(q1, `select * from "users" where "email" = 'test@test.com'`);
    
    const q2 = Users.where('email', 'like', '%test%').toString();
    t.is(q2, `select * from "users" where "email" like '%test%'`);
    
    const q3 = Users.where({ name: 'Test'}).page(2, 20).toString();
    t.is(q3, `select * from "users" where "name" = 'Test' limit 2 offset 40`);
    
    const q4 = Users.order('created_at desc').toString();
    t.is(q4, `select * from "users" order by created_at desc`);
});


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
