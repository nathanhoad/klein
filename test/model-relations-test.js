const { test } = require('ava');
const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');

const Log = require('../tasks/log');
Log.silent = true;
const Helpers = require('./helpers');
const Tasks = require('../tasks');

const Klein = require('../lib').connect();


test('It can load belongs_to and has_many relations', t => {
    const Users = Klein.model('users', {
        relations: {
            team: { belongs_to: 'team' }
        }
    });
    const Teams = Klein.model('teams', {
        relations: {
            users: { has_many: 'users' }
        }
    });
    
    process.env.APP_ROOT = '/tmp/klein/belongs-to';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_teams = [
        {
            id: uuid(),
            name: 'Awesome'
        },
        {
            id: uuid(),
            name: 'Gamers'
        }
    ];
    
    const new_users = [
        {
            name: 'Nathan', 
            team_id: new_teams[0].id
        },
        {
            name: 'Lilly',
            team_id: new_teams[0].id
        },
        {
            name: 'Ben',
            team_id: new_teams[1].id
        }
    ];
    
    return Helpers.setupDatabase([
        ['users', 'name:string', 'team_id:uuid'],
        ['teams', 'name:string']
    ]).then(() => {
        return Users.create(new_users);
    }).then(users => {
        return Teams.create(new_teams);
    }).then(teams => {
        return Users.include('team').all();
    }).then(users => {
        
        t.is(users.count(), 3);
        
        let nathan = users.find(u => u.get('name') == 'Nathan');
        t.truthy(nathan);
        t.is(nathan.getIn(['team', 'name']), new_teams[0].name);
        
        let lilly = users.find(u => u.get('name') == 'Lilly');
        t.truthy(lilly);
        t.is(lilly.getIn(['team', 'name']), new_teams[0].name);
        
        let ben = users.find(u => u.get('name') == 'Ben');
        t.truthy(ben);
        t.is(ben.getIn(['team', 'name']), new_teams[1].name);
        
        return Teams.include('users').all();
    }).then(teams => {
        
        t.is(teams.count(), 2);
        
        t.is(teams.find(t => t.get('name') == new_teams[0].name).get('users').count(), 2);
        t.is(teams.find(t => t.get('name') == new_teams[1].name).get('users').count(), 1);
        
    });
});


test('It can load has_many_through relations', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_and_belongs_to_many: 'projects' }
        }
    });
    const Projects = Klein.model('projects', {
        relations: {
            users: { has_and_belongs_to_many: 'users' }
        }
    });
    const ProjectsUsers = Klein.model('projects_users');
    
    process.env.APP_ROOT = '/tmp/klein/belongs-to';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_projects = [
        {
            id: uuid(),
            name: 'Awesome Game'
        },
        {
            id: uuid(),
            name: 'Design'
        }
    ];
    
    const new_users = [
        {
            name: 'Nathan'
        },
        {
            name: 'Lilly'
        },
        {
            name: 'Ben'
        }
    ];
    
    const new_projects_users = [
        // Nathan is on Awesome Game
        { project_id: new_projects[0].id, user_id: new_users[0].id },
        // Nathan is on Design
        { project_id: new_projects[1].id, user_id: new_users[0].id },
        
        // Lilly is on Awesome Game
        { project_id: new_projects[0].id, user_id: new_users[1].id },
        
        // Ben is on Design
        { project_id: new_projects[1].id, user_id: new_users[2].id }
    ];
    
    return Helpers.setupDatabase([
        ['users', 'name:string'],
        ['projects_users', 'user_id:uuid', 'project_id:uuid'],
        ['projects', 'name:string']
    ]).then(() => {
        
        return Users.create(new_users);
        
    }).then(users => {
        
        return Projects.create(new_projects);
        
    }).then(projects => {
        
        return ProjectsUsers.create(new_projects_users);
        
    }).then(projects_users => {
        
        return Users.include('projects').all();
        
    }).then(users => {
        
        t.is(users.count(), 3);
        
    });
});



test('It can save an object that has has_and_belongs_to_many relations on it', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_and_belongs_to_many: 'projects' }
        }
    });
    const Projects = Klein.model('projects', {
        relations: {
            users: { has_and_belongs_to_many: 'users' }
        }
    });
    
    process.env.APP_ROOT = '/tmp/klein/belongs-to';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_projects = Immutable.fromJS([
        {
            name: 'Awesome Game'
        },
        {
            id: uuid(),
            name: 'Design'
        }
    ]);
    
    const persisted_project = Immutable.fromJS({
        name: 'Persisted'
    });
    
    const new_user = {
        name: 'Nathan'
    };
    
    return Helpers.setupDatabase([
        ['users', 'name:string'],
        ['projects_users', 'user_id:uuid', 'project_id:uuid'],
        ['projects', 'name:string']
    ]).then(() => {
        
        return Projects.create(persisted_project);
        
    }).then(project => {
        
        return Users.create(new_user).then(user => {
            // Add the first two unsaved projects
            user = user.set('projects', new_projects);
            return Users.save(user);
        }).then(user => {
            
            t.is(user.get('projects').count(), 2);
            
            // Add the third, already saved project
            user = user.set('projects', user.get('projects').push(project));
            return Users.save(user);
        }).then(user => {
            
            t.is(user.get('projects').count(), 3);
            t.not(user.get('projects').find(p => p.get('id') == project.get('id')), null);

            return Users.include('projects').all();
        }).then(users => {
            t.is(users.first().get('projects').count(), 3);
            
            let project = users.first().get('projects').find(p => p.get('name') == new_projects.first().get('name'));
            
            t.true(typeof project.get('id') !== "undefined");
            
        });
    });
});


test('It can save an object that has has_many relations on it', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_many: 'projects' }
        }
    });
    const Projects = Klein.model('projects', {
        relations: {
            user: { belongs_to: 'user' }
        }
    });
    
    process.env.APP_ROOT = '/tmp/klein/saving-has-many';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_projects = Immutable.fromJS([
        {
            name: 'Awesome Game'
        },
        {
            id: uuid(),
            name: 'Design'
        }
    ]);
    
    const persisted_project = Immutable.fromJS({
        name: 'Persisted'
    });
    
    const new_user = {
        name: 'Nathan'
    };
    
    return Helpers.setupDatabase([
        ['users', 'name:string'],
        ['projects', 'name:string', 'user_id:uuid']
    ]).then(() => {
        return Projects.create(persisted_project);
    }).then(project => {
        return Users.create(new_user).then(user => {
            // Add the first two unsaved projects
            user = user.set('projects', new_projects);
            return Users.save(user);
        }).then(user => {
            
            t.is(user.get('projects').count(), 2);
            
            // Add the third, already saved project
            user = user.set('projects', user.get('projects').push(project));
            return Users.save(user);
        }).then(user => {
            
            t.is(user.get('projects').count(), 3);
            t.not(user.get('projects').find(p => p.get('id') == project.get('id')), null);
            
            return Users.include('projects').all();
        }).then(users => {
            
            t.is(users.first().get('projects').count(), 3);
            
            let project = users.first().get('projects').find(p => p.get('name') == new_projects.first().get('name'));
            
            t.true(typeof project.get('id') !== "undefined");
            
            return Projects.find(project.get('id')).then(project => {
                return Users.first().then(user => {
                
                    t.is(project.get('user_id'), user.get('id'));
                    
                });
            });
        });
    });
});


test('It can save an object that has has_many relations on it and one of them also has a has_many relation on it', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_many: 'projects' }
        }
    });
    const Projects = Klein.model('projects', {
        relations: {
            user: { belongs_to: 'user' },
            lists: { has_many: 'lists' }
        }
    });
    
    process.env.APP_ROOT = '/tmp/klein/saving-has-many-has-many';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_user = {
        name: 'Nathan',
        projects: [
            {
                name: 'Awesome Game'
            },
            {
                name: 'Design',
                lists: [
                    {
                        name: 'To Do'
                    },
                    {
                        name: 'Doing'
                    },
                    {
                        name: 'Done'
                    }
                ]
            }
        ]
    };
    
    return Helpers.setupDatabase([
        ['users', 'name:string'],
        ['projects', 'name:string', 'user_id:uuid'],
        ['lists', 'name:string', 'project_id:uuid']
    ]).then(() => {
        return Users.create(new_user);
    }).then(user => {
        let projects = user.get('projects');
        
        t.is(projects.count(), 2);
        
        let project_with_lists = projects.find(p => p.has('lists'));
        
        t.is(project_with_lists.get('lists').count(), 3);
        t.is(project_with_lists.getIn(['lists', 0, 'name']), new_user.projects[1].lists[0].name);
        
        return Projects.include('lists').reload(project_with_lists).then(project => {
            
            t.is(project.get('lists').count(), 3);
            
            const Lists = Klein.model('lists');
            const first_list = project.getIn(['lists', 0]);
            return Lists.find(first_list.get('id')).then(list => {
                
                t.is(list.get('id'), first_list.get('id'));
                
            });
        });
    });
});


test('It can save an object that has a belongs_to relations on it', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_many: 'projects' }
        }
    });
    const Projects = Klein.model('projects', {
        relations: {
            user: { belongs_to: 'user' }
        }
    });
    
    process.env.APP_ROOT = '/tmp/klein/saving-belongs-to';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_project = Immutable.fromJS({
        id: uuid(),
        name: 'Awesome Game'
    });
    
    const initial_user = Immutable.fromJS({
        name: 'Nathan'
    });
    
    const replacement_user = Immutable.fromJS({
        name: 'Lilly'
    });
    
    return Helpers.setupDatabase([
        ['users', 'name:string'],
        ['projects', 'name:string', 'user_id:uuid']
    ]).then(() => {
        
        return Projects.create(new_project);
        
    }).then(project => {
        
        // User is nothing initially
        t.true(typeof project.get('user') === "undefined");
        
        project = project.set('user', initial_user);
        return Projects.save(project).then(project => {
            // User was persisted and attached to the project
            return Users.where({ name: initial_user.get('name') }).include('projects').first().then(initial_user => {
                
                t.is(project.getIn(['user', 'id']), initial_user.get('id'));
                t.is(initial_user.getIn(['projects', 0, 'id']), project.get('id'));
                
                project = project.set('user', replacement_user);
                return Projects.save(project).then(project => {
                    return Users.where({ name: replacement_user.get('name') }).include('projects').first().then(replacement_user => {
                        
                        t.is(project.getIn(['user', 'id']), replacement_user.get('id'));
                        t.is(replacement_user.getIn(['projects', 0, 'id']), project.get('id'));
                        
                        // Check that the initial_user projects is now empty
                        return Users.include('projects').find(initial_user.get('id')).then(initial_user => {
                            
                            t.is(initial_user.get('projects').count(), 0);
                            
                        });
                    });
                });
            });
        });
    });
});


test('It can destroy dependent objects when destroying the parent', t => {
    const Users = Klein.model('users', {
        relations: {
            projects: { has_many: 'projects', dependent: true }
        }
    });
    const Projects = Klein.model('projects', {
        relations: {
            user: { belongs_to: 'user' }
        }
    });
    
    process.env.APP_ROOT = '/tmp/klein/saving-belongs-to';
    FS.removeSync(process.env.APP_ROOT);
    
    const new_project = Immutable.fromJS({ id: uuid(), name: 'Awesome Game' });
    const new_user = Immutable.fromJS({ name: 'Nathan' });
    
    return Helpers.setupDatabase([
        ['users', 'name:string'],
        ['projects', 'name:string', 'user_id:uuid']
    ]).then(() => {
        return Projects.create(new_project);
    }).then(project => {
        return Users.create(new_user).then(user => {
            // Add project to user
            project = project.set('user', user);
            return Projects.save(project).then(project => {
                // Destroy the user (and the dependent project)
                return Users.destroy(user).then(user => {
                    return Projects.reload(project).then(project => {
                        
                        t.is(project, null);
                        
                    });
                });
            });
        });
    });
});
