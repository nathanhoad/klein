const Immutable = require('immutable');
const FS = require('fs-extra');
const uuid = require('uuid/v4');
const Sinon = require('sinon');

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

test('It can load belongsTo, hasOne, and hasMany relations', async () => {
  const Users = Klein.model('users', {
    relations: {
      team: { belongsTo: 'team' }
    }
  });
  const Teams = Klein.model('teams', {
    relations: {
      users: { hasMany: 'users' },
      profile: { hasOne: 'profile' }
    }
  });
  const Profiles = Klein.model('profiles', {
    relations: {
      team: { belongsTo: 'team' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/belongs-to';
  FS.removeSync(process.env.APP_ROOT);

  const newTeams = [
    {
      id: uuid(),
      name: 'Awesome'
    },
    {
      id: uuid(),
      name: 'Gamers'
    }
  ];

  const newUsers = [
    {
      name: 'Nathan',
      teamId: newTeams[0].id
    },
    {
      name: 'Lilly',
      teamId: newTeams[0].id
    },
    {
      name: 'Ben',
      teamId: newTeams[1].id
    }
  ];

  const newProfiles = [
    {
      bio: 'We are the best, obviously',
      teamId: newTeams[0].id
    },
    {
      bio: 'Overcooked is our religion',
      teamId: newTeams[1].id
    }
  ];

  await Helpers.setupDatabase(
    [['users', 'name:string', 'teamId:uuid'], ['teams', 'name:string'], ['profiles', 'bio:string', 'teamId:uuid']],
    {
      knex: Klein.knex
    }
  );
  await Users.create(newUsers);

  let teams = await Teams.create(newTeams);
  let profiles = await Profiles.create(newProfiles);
  let users = await Users.include('team').all();
  expect(users.count()).toBe(3);

  let nathan = users.find(u => u.get('name') === 'Nathan');
  expect(nathan).toBeTruthy();
  expect(nathan.getIn(['team', 'name'])).toBe(newTeams[0].name);

  let lilly = users.find(u => u.get('name') === 'Lilly');
  expect(lilly).toBeTruthy();
  expect(lilly.getIn(['team', 'name'])).toBe(newTeams[0].name);

  let ben = users.find(u => u.get('name') === 'Ben');
  expect(ben).toBeTruthy();
  expect(ben.getIn(['team', 'name'])).toBe(newTeams[1].name);

  teams = await Teams.include('users').all();
  expect(teams.count()).toBe(2);
  expect(
    teams
      .find(t => t.get('name') === newTeams[0].name)
      .get('users')
      .count()
  ).toBe(2);
  expect(
    teams
      .find(t => t.get('name') === newTeams[1].name)
      .get('users')
      .count()
  ).toBe(1);

  teams = await Teams.include('profile').all();

  expect(teams.count()).toBe(2);
  expect(teams.find(t => t.get('name') == newTeams[0].name).getIn(['profile', 'bio'])).toBe(newProfiles[0].bio);
  expect(teams.find(t => t.get('name') == newTeams[1].name).getIn(['profile', 'bio'])).toBe(newProfiles[1].bio);

  teams = await Teams.where({ name: newTeams[0].name }).all();
  expect(teams.count()).toBe(1);
  expect(teams.first().get('users')).toBeUndefined();
  expect(teams.first().get('profile')).toBeUndefined();
});

test('It can load belongsTo, hasOne, and hasMany relations with different keys', async () => {
  const Users = Klein.model('users', {
    relations: {
      team: { belongsTo: 'team', foreignKey: 'team_id' }
    }
  });
  const Teams = Klein.model('teams', {
    relations: {
      users: { hasMany: 'users', foreignKey: 'team_id' },
      profile: { hasOne: 'profile', foreignKey: 'team_id' }
    }
  });
  const Profiles = Klein.model('profiles', {
    relations: {
      team: { belongsTo: 'teams', foreignKey: 'team_id' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/belongs-to-with-different-keys';
  FS.removeSync(process.env.APP_ROOT);

  const newTeams = [
    {
      id: uuid(),
      name: 'Awesome'
    },
    {
      id: uuid(),
      name: 'Gamers'
    }
  ];

  const newUsers = [
    {
      name: 'Nathan',
      team_id: newTeams[0].id
    },
    {
      name: 'Lilly',
      team_id: newTeams[0].id
    },
    {
      name: 'Ben',
      team_id: newTeams[1].id
    }
  ];

  const newProfiles = [
    {
      bio: 'We are the best, obviously',
      team_id: newTeams[0].id
    },
    {
      bio: 'Overcooked is our religion',
      team_id: newTeams[1].id
    }
  ];

  await Helpers.setupDatabase(
    [['users', 'name:string', 'team_id:uuid'], ['teams', 'name:string'], ['profiles', 'bio:string', 'team_id:uuid']],
    {
      knex: Klein.knex
    }
  );
  await Users.create(newUsers);
  await Teams.create(newTeams);
  await Profiles.create(newProfiles);

  let users = await Users.include('team').all();

  expect(users.count()).toBe(3);

  let nathan = users.find(u => u.get('name') === 'Nathan');
  expect(nathan).toBeTruthy();
  expect(nathan.getIn(['team', 'name'])).toBe(newTeams[0].name);

  let lilly = users.find(u => u.get('name') === 'Lilly');
  expect(lilly).toBeTruthy();
  expect(lilly.getIn(['team', 'name'])).toBe(newTeams[0].name);

  let ben = users.find(u => u.get('name') === 'Ben');
  expect(ben).toBeTruthy();
  expect(ben.getIn(['team', 'name'])).toBe(newTeams[1].name);

  let teams = await Teams.include('users').all();

  expect(teams.count()).toBe(2);
  expect(
    teams
      .find(t => t.get('name') === newTeams[0].name)
      .get('users')
      .count()
  ).toBe(2);
  expect(
    teams
      .find(t => t.get('name') === newTeams[1].name)
      .get('users')
      .count()
  ).toBe(1);

  teams = await Teams.include('profile').all();
  expect(teams.count()).toBe(2);
  expect(teams.find(t => t.get('name') == newTeams[0].name).getIn(['profile', 'bio'])).toBe(newProfiles[0].bio);
  expect(teams.find(t => t.get('name') == newTeams[1].name).getIn(['profile', 'bio'])).toBe(newProfiles[1].bio);
});

test('It can load belongsTo, hasOne, and hasMany relations for model with custom instances', async () => {
  const testType = (name) => ({
    factory(props) {
      return Immutable.Map({ type: name, wrapped: Immutable.fromJS(props) });
    },
    instanceOf(maybeInstance) {
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === name;
    },
    serialize(instance) {
      return instance.get('wrapped').toJS();
    }
  });

  const Users = Klein.model('users', {
    type: testType('user'),
    relations: {
      team: { belongsTo: 'team' }
    }
  });
  const Teams = Klein.model('teams', {
    type: testType('team'),
    relations: {
      users: { hasMany: 'users' },
      profile: { hasOne: 'profile' }
    }
  });
  const Profiles = Klein.model('profiles', {
    type: testType('profile'),

    relations: {
      team: { belongsTo: 'team' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/relations-load-custom-types';
  FS.removeSync(process.env.APP_ROOT);

  const newTeams = [
    {
      id: uuid(),
      name: 'Awesome'
    },
    {
      id: uuid(),
      name: 'Gamers'
    },
    {
      id: uuid(),
      name: 'Eat Veggies'
    }
  ];

  const newUsers = [
    {
      name: 'Nathan',
      teamId: newTeams[0].id
    },
    {
      name: 'Lilly',
      teamId: newTeams[0].id
    },
    {
      name: 'Ben',
      teamId: newTeams[1].id
    },
    {
      name: 'Coco',
      teamId: null
    }
  ];

  const newProfiles = [
    {
      bio: 'We are the best, obviously',
      teamId: newTeams[0].id
    },
    {
      bio: 'Overcooked is our religion',
      teamId: newTeams[1].id
    }
  ];

  await Helpers.setupDatabase(
    [['users', 'name:string', 'teamId:uuid'], ['teams', 'name:string'], ['profiles', 'bio:string', 'teamId:uuid']],
    {
      knex: Klein.knex
    }
  );
  await Users.create(newUsers);

  let teams = await Teams.create(newTeams);
  let profiles = await Profiles.create(newProfiles);
  let users = await Users.include('team').all();

  expect(users.count()).toBe(4);

  let nathan = users.find(u => u.getIn(['wrapped', 'name']) === 'Nathan');
  expect(nathan).toBeTruthy();
  expect(nathan.getIn(['wrapped', 'team', 'wrapped', 'name'])).toBe(newTeams[0].name);

  let lilly = users.find(u => u.getIn(['wrapped', 'name']) === 'Lilly');
  expect(lilly).toBeTruthy();
  expect(lilly.getIn(['wrapped', 'team', 'wrapped', 'name'])).toBe(newTeams[0].name);

  let ben = users.find(u => u.getIn(['wrapped', 'name']) === 'Ben');
  expect(ben).toBeTruthy();
  expect(ben.getIn(['wrapped', 'team', 'wrapped', 'name'])).toBe(newTeams[1].name);

  let coco = users.find(u => u.getIn(['wrapped', 'name']) === 'Coco');
  expect(coco).toBeTruthy();
  expect(coco.getIn(['wrapped', 'team'])).toBeUndefined();

  teams = await Teams.include('users').all();
  expect(teams.count()).toBe(3);
  expect(
    teams
      .find(t => t.getIn(['wrapped', 'name']) === newTeams[0].name)
      .getIn(['wrapped', 'users'])
      .count()
  ).toBe(2);
  expect(
    teams
      .find(t => t.getIn(['wrapped','name']) === newTeams[1].name)
      .getIn(['wrapped', 'users'])
      .count()
  ).toBe(1);

  teams = await Teams.include('profile').all();

  expect(teams.count()).toBe(3);
  expect(teams.find(t => t.getIn(['wrapped', 'name']) == newTeams[0].name).getIn(['wrapped', 'profile', 'wrapped', 'bio'])).toBe(newProfiles[0].bio);
  expect(teams.find(t => t.getIn(['wrapped', 'name']) == newTeams[1].name).getIn(['wrapped', 'profile', 'wrapped', 'bio'])).toBe(newProfiles[1].bio);
  expect(teams.find(t => t.getIn(['wrapped', 'name']) == newTeams[2].name).getIn(['wrapped', 'profile'])).toBeUndefined();
});

test('It can load hasAndBelongsToMany relations', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasAndBelongsToMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      users: { hasAndBelongsToMany: 'users' }
    }
  });
  const ProjectsUsers = Klein.model('projects_users');

  process.env.APP_ROOT = '/tmp/klein/has-and-belongs-to-many';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = [
    {
      id: uuid(),
      name: 'Awesome Game'
    },
    {
      id: uuid(),
      name: 'Design'
    }
  ];

  const newUsers = [
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

  const NewProjectsUsers = [
    // Nathan is on Awesome Game
    { projectId: newProjects[0].id, userId: newUsers[0].id },
    // Nathan is on Design
    { projectId: newProjects[1].id, userId: newUsers[0].id },

    // Lilly is on Awesome Game
    { projectId: newProjects[0].id, userId: newUsers[1].id },

    // Ben is on Design
    { projectId: newProjects[1].id, userId: newUsers[2].id }
  ];

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['projects_users', 'userId:uuid', 'projectId:uuid'], ['projects', 'name:string']],
    { knex: Klein.knex }
  );

  await Users.create(newUsers);
  await Projects.create(newProjects);
  await ProjectsUsers.create(NewProjectsUsers);

  let users = await Users.include('projects').all();
  expect(users.count()).toBe(3);
});

test('It can load hasAndBelongsToMany relations with different keys', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: {
        hasAndBelongsToMany: 'projects',
        through: 'memberships',
        primaryKey: 'userId',
        foreignKey: 'projectId'
      }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      users: {
        hasAndBelongsToMany: 'users',
        through: 'memberships',
        primaryKey: 'projectId',
        foreignKey: 'userId'
      }
    }
  });
  const Memberships = Klein.model('memberships');

  process.env.APP_ROOT = '/tmp/klein/has-and-belongs-to-many-with-different-keys';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = [
    {
      id: uuid(),
      name: 'Awesome Game'
    },
    {
      id: uuid(),
      name: 'Design'
    }
  ];

  const newUsers = [
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

  const new_memberships = [
    // Nathan is on Awesome Game
    { projectId: newProjects[0].id, userId: newUsers[0].id },
    // Nathan is on Design
    { projectId: newProjects[1].id, userId: newUsers[0].id },

    // Lilly is on Awesome Game
    { projectId: newProjects[0].id, userId: newUsers[1].id },

    // Ben is on Design
    { projectId: newProjects[1].id, userId: newUsers[2].id }
  ];

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['memberships', 'userId:uuid', 'projectId:uuid'], ['projects', 'name:string']],
    { knex: Klein.knex }
  );

  await Users.create(newUsers);
  await Projects.create(newProjects);
  await Memberships.create(new_memberships);

  let users = await Users.include('projects').all();
  expect(users.count()).toBe(3);
});

test('It can load hasAndBelongsToMany relations for model with custom instances', async () => {
  const testType = (name) => ({
    factory(props) {
      return Immutable.Map({ type: name, wrapped: Immutable.fromJS(props) });
    },
    instanceOf(maybeInstance) {
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === name;
    },
    serialize(instance) {
      return instance.get('wrapped').toObject();
    }
  });

  const Users = Klein.model('users', {
    type: testType('user'),
    relations: {
      projects: { hasAndBelongsToMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    type: testType('project'),
    relations: {
      users: { hasAndBelongsToMany: 'users' }
    }
  });
  const ProjectsUsers = Klein.model('projects_users');

  process.env.APP_ROOT = '/tmp/klein/has-and-belongs-to-many';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = [
    {
      id: uuid(),
      name: 'Awesome Game'
    },
    {
      id: uuid(),
      name: 'Design'
    }
  ];

  const newUsers = [
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

  const NewProjectsUsers = [
    // Nathan is on Awesome Game
    { projectId: newProjects[0].id, userId: newUsers[0].id },
    // Nathan is on Design
    { projectId: newProjects[1].id, userId: newUsers[0].id },

    // Lilly is on Awesome Game
    { projectId: newProjects[0].id, userId: newUsers[1].id },

    // Ben is on Design
    { projectId: newProjects[1].id, userId: newUsers[2].id }
  ];

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['projects_users', 'userId:uuid', 'projectId:uuid'], ['projects', 'name:string']],
    { knex: Klein.knex }
  );

  await Users.create(newUsers);
  await Projects.create(newProjects);
  await ProjectsUsers.create(NewProjectsUsers);

  let users = await Users.include('projects').all();
  expect(users.count()).toBe(3);
  expect(users.first().get('type')).toBe('user');
});

test('It can save an object that has a hasOne relation on it', async () => {
  const Users = Klein.model('users', {
    relations: {
      profile: { hasOne: 'profile' }
    }
  });
  const Profiles = Klein.model('profiles', {
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/save-has-one';
  FS.removeSync(process.env.APP_ROOT);

  const initialProfile = Immutable.fromJS({
    bio: 'Working on Awesome Game'
  });

  const replacementProfile = Immutable.fromJS({
    bio: 'Working on Design'
  });

  const profileWithId = Immutable.fromJS({
    id: uuid(),
    name: 'Working on Art'
  });

  const newUser = {
    name: 'Nathan'
  };

  await Helpers.setupDatabase([['users', 'name:string'], ['profiles', 'bio:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let user = await Users.create(newUser);

  expect(typeof user.get('profile')).toBe('undefined');

  user = user.set('profile', initialProfile);
  user = await Users.save(user);

  expect(user.get('profile')).toBeTruthy();

  let profile = await Profiles.where({ bio: initialProfile.get('bio') })
    .include('user')
    .first();
  expect(user.getIn(['profile', 'id'])).toBe(profile.get('id'));
  expect(profile.getIn(['user', 'id'])).toBe(user.get('id'));
  expect(profile.get('createdAt')).toEqual(user.get('updatedAt'));

  user = user.set('profile', replacementProfile);
  user = await Users.save(user);

  let otherProfile = await Profiles.where({ bio: replacementProfile.get('bio') })
    .include('user')
    .first();
  expect(user.getIn(['profile', 'id'])).toBe(otherProfile.get('id'));
  expect(otherProfile.getIn(['user', 'id'])).toBe(user.get('id'));

  profile = await Profiles.include('user').find(profile.get('id'));
  expect(profile.get('user')).toBeFalsy();

  user = user.set('profile', profileWithId);
  user = await Users.save(user);

  expect(user.getIn(['profile', 'id'])).toBe(profileWithId.get('id'));


  let existingProfile = await Profiles.create(initialProfile)
  user = user.set('profile', existingProfile.set('bio', 'Working on updates'));
  user = await Users.save(user)

  expect(user.getIn(['profile', 'id'])).toBe(existingProfile.get('id'));
  expect(user.getIn(['profile', 'bio'])).toBe('Working on updates');

  let previousUser = user;
  user = await Users.save(user, { touch: false });
  expect(user.getIn(['profile', 'updatedAt'])).toBeTruthy();
  expect(user.getIn(['profile', 'updatedAt'])).toEqual(previousUser.getIn(['profile', 'updatedAt']));

  const testDate = new Date(2019, 3, 10);
  user = await Users.save(user, { touch: testDate });
  expect(user.getIn(['profile', 'updatedAt'])).toEqual(testDate);

  user = user.set('profile', null);
  user = await Users.save(user);

  expect(user.get('profile')).toBeNull();
});

test('It can save an object that has a hasOne relation on it for model with custom instance', async () => {
  const testType = (name) => ({
    factory(props) {
      return Immutable.Map({ type: name, wrapped: Immutable.fromJS(props) });
    },
    instanceOf(maybeInstance) {
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === name;
    },
    serialize(instance) {
      return instance.get('wrapped').toObject();
    }
  });

  const Users = Klein.model('users', {
    type: testType('user'),
    relations: {
      profile: { hasOne: 'profile' }
    }
  });
  const Profiles = Klein.model('profiles', {
    type: testType('profile'),
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/save-has-one';
  FS.removeSync(process.env.APP_ROOT);

  const initialProfile = Immutable.fromJS({
    type: 'profile',
    wrapped: {
      bio: 'Working on Awesome Game'
    }
  });

  const replacementProfile = Immutable.fromJS({
    type: 'profile',
    wrapped: {
      bio: 'Working on Design'
    }
  });

  const newUser = {
    name: 'Nathan'
  };

  await Helpers.setupDatabase([['users', 'name:string'], ['profiles', 'bio:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let user = await Users.create(newUser);

  expect(typeof user.getIn(['wrapped', 'profile'])).toBe('undefined');

  user = user.setIn(['wrapped', 'profile'], initialProfile);
  user = await Users.save(user);

  expect(user.getIn(['wrapped', 'profile'])).toBeTruthy();

  let profile = await Profiles.where({ bio: initialProfile.getIn(['wrapped', 'bio']) })
    .include('user')
    .first();
  expect(user.getIn(['wrapped', 'profile', 'wrapped', 'id'])).toBe(profile.getIn(['wrapped', 'id']));
  expect(profile.getIn(['wrapped', 'user', 'wrapped', 'id'])).toBe(user.getIn(['wrapped', 'id']));

  user = user.setIn(['wrapped', 'profile'], replacementProfile);
  user = await Users.save(user);

  let otherProfile = await Profiles.where({ bio: replacementProfile.getIn(['wrapped', 'bio']) })
    .include('user')
    .first();
  expect(user.getIn(['wrapped', 'profile', 'wrapped', 'id'])).toBe(otherProfile.getIn(['wrapped', 'id']));
  expect(otherProfile.getIn(['wrapped', 'user', 'wrapped', 'id'])).toBe(user.getIn(['wrapped', 'id']));

  profile = await Profiles.include('user').find(profile.getIn(['wrapped', 'id']));
  expect(profile.getIn(['wrapped', 'user', 'wrapped'])).toBeFalsy();
});

test('It can save an object that has hasAndBelongsToMany relations on it', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasAndBelongsToMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      users: { hasAndBelongsToMany: 'users' }
    }
  });
  const ProjectsUsers = Klein.model('projects_users');

  process.env.APP_ROOT = '/tmp/klein/save-has-and-belongs-to-many';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = Immutable.fromJS([
    {
      name: 'Awesome Game'
    },
    {
      id: uuid(),
      name: 'Design'
    }
  ]);

  const persistedProject = Immutable.fromJS({
    name: 'Persisted'
  });

  const newUser = {
    name: 'Nathan'
  };

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['projects_users', 'userId:uuid', 'projectId:uuid'], ['projects', 'name:string']],
    { knex: Klein.knex }
  );

  let project = await Projects.create(persistedProject);
  let user = await Users.create(newUser);

  // Add the first two unsaved projects
  user = user.set('projects', newProjects);
  user = await Users.save(user);
  expect(user.get('projects').count()).toBe(2);

  // Add the third, already saved project
  user = user.set('projects', user.get('projects').push(project));
  user = await Users.save(user);

  expect(user.get('projects').count()).toBe(3);
  expect(user.get('projects').find(p => p.get('id') === project.get('id'))).not.toBeNull();

  let users = await Users.include('projects').all();

  expect(
    users
      .first()
      .get('projects')
      .count()
  ).toBe(3);

  project = users
    .first()
    .get('projects')
    .find(p => p.get('name') === newProjects.first().get('name'));

  expect(typeof project.get('id') !== 'undefined').toBeTruthy();
  expect(project.get('updatedAt')).toEqual(users.first().get('updatedAt'));

  // Make sure subsequent saves don't add duplicates and respects touch option
  const testDate = new Date(2019, 3, 10);
  user = await Users.save(users.first(), { touch: testDate });
  expect(user.get('projects').count()).toBe(3);

  let projectsUsers = await ProjectsUsers.all();
  expect(projectsUsers.count()).toBe(3);

  project = await Projects.find(project.get('id'));

  expect(project.get('updatedAt')).toEqual(testDate);

  let previousProject = project;
  user = await Users.save(user, { touch: false });
  project = await Projects.find(project.get('id'));

  expect(project.get('updatedAt')).toEqual(previousProject.get('updatedAt'));
});

test('It can save an object that has hasAndBelongsToMany relations on it for model with custom instance', async () => {
  const testType = (name) => ({
    factory(props) {
      return Immutable.Map({ type: name, wrapped: Immutable.fromJS(props) });
    },
    instanceOf(maybeInstance) {
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === name;
    },
    serialize(instance) {
      return instance.get('wrapped').toObject();
    }
  });

  const Users = Klein.model('users', {
    type: testType('user'),
    relations: {
      projects: { hasAndBelongsToMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    type: testType('project'),
    relations: {
      users: { hasAndBelongsToMany: 'users' }
    }
  });
  const ProjectsUsers = Klein.model('projects_users');

  process.env.APP_ROOT = '/tmp/klein/save-has-and-belongs-to-many';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = Immutable.fromJS([
    {
      type: 'project',
      wrapped: {
        name: 'Awesome Game'
      }
    },
    {
      type: 'project',
      wrapped: {
        id: uuid(),
        name: 'Design'
      }
    }
  ]);

  const persistedProject = Immutable.fromJS({
    type: 'project',
    wrapped: {
      name: 'Persisted'
    }
  });

  const newUser = {
    name: 'Nathan'
  };

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['projects_users', 'userId:uuid', 'projectId:uuid'], ['projects', 'name:string']],
    { knex: Klein.knex }
  );

  let project = await Projects.create(persistedProject);
  let user = await Users.create(newUser);

  // Add the first two unsaved projects
  user = user.setIn(['wrapped', 'projects'], newProjects);
  user = await Users.save(user);
  expect(user.getIn(['wrapped', 'projects']).count()).toBe(2);
  expect(user.getIn(['wrapped', 'projects']).first().get('type')).toBe('project')

  // Add the third, already saved project
  user = user.setIn(['wrapped', 'projects'], user.getIn(['wrapped', 'projects']).push(project));
  user = await Users.save(user);

  expect(user.getIn(['wrapped', 'projects']).count()).toBe(3);
  expect(user.getIn(['wrapped', 'projects']).find(p => p.getIn(['wrapped', 'id']) === project.getIn(['wrapped', 'id']))).not.toBeNull();

  let users = await Users.include('projects').all();

  expect(
    users
      .first()
      .getIn(['wrapped', 'projects'])
      .count()
  ).toBe(3);

  project = users
    .first()
    .getIn(['wrapped', 'projects'])
    .find(p => p.getIn(['wrapped', 'name']) === newProjects.first().getIn(['wrapped', 'name']));

  expect(typeof project.getIn(['wrapped', 'id']) !== 'undefined').toBeTruthy();

  // Make sure subsequent saves don't add duplicates
  user = await Users.save(users.first());
  expect(user.getIn(['wrapped', 'projects']).count()).toBe(3);

  let projectsUsers = await ProjectsUsers.all();
  expect(projectsUsers.count()).toBe(3);
});

test('It can save an object that has hasMany relations on it', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/saving-has-many';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = Immutable.fromJS([
    {
      name: 'Awesome Game'
    },
    {
      id: uuid(),
      name: 'Design'
    }
  ]);

  const persistedProject = Immutable.fromJS({
    name: 'Persisted'
  });

  const newUser = {
    name: 'Nathan'
  };

  await Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let project = await Projects.create(persistedProject);
  let user = await Users.create(newUser);

  // Add the first two unsaved projects
  user = user.set('projects', newProjects);
  user = await Users.save(user);

  expect(user.get('projects').filter((project) => project.get('id')).count()).toBe(2);
  expect(user.get('projects').first().get('updatedAt')).toEqual(user.get('updatedAt'));

  // Add the third, already saved project
  user = user.set('projects', user.get('projects').push(project));
  user = await Users.save(user);

  expect(user.get('projects').count()).toBe(3);
  expect(user.get('projects').find(p => p.get('id') === project.get('id'))).not.toBeNull();

  let users = await Users.include('projects').all();

  expect(
    users
      .first()
      .get('projects')
      .count()
  ).toBe(3);

  project = users
    .first()
    .get('projects')
    .find(p => p.get('name') === newProjects.first().get('name'));

  expect(typeof project.get('id')).not.toBe('undefined');

  const testDate = new Date(2019, 3, 10);
  user = await Users.save(users.first(), { touch: testDate });

  project = await Projects.find(project.get('id'));

  expect(project.get('updatedAt')).toEqual(testDate);

  project = await Projects.find(project.get('id'));
  user = await Users.first();
  expect(project.get('userId')).toBe(user.get('id'));

  let previousProject = project;
  user = await Users.save(user, { touch: false });
  project = await Projects.find(project.get('id'));
  expect(project.get('updatedAt')).toEqual(previousProject.get('updatedAt'));
});

test('It can save an object that has hasMany relations on it and one of them also has a hasMany relation on it', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      user: { belongsTo: 'user' },
      lists: { hasMany: 'lists' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/saving-has-many-has-many';
  FS.removeSync(process.env.APP_ROOT);

  const newUser = {
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

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['projects', 'name:string', 'userId:uuid'], ['lists', 'name:string', 'projectId:uuid']],
    { knex: Klein.knex }
  );

  let user = await Users.create(newUser);
  let projects = user.get('projects');
  expect(projects.count()).toBe(2);

  let projectWithLists = projects.find(p => p.has('lists'));
  expect(projectWithLists.get('lists').count()).toBe(3);
  expect(projectWithLists.getIn(['lists', 0, 'name'])).toBe(newUser.projects[1].lists[0].name);

  let project = await Projects.include('lists').reload(projectWithLists);
  expect(project.get('lists').count()).toBe(3);

  const Lists = Klein.model('lists');
  const firstList = project.getIn(['lists', 0]);
  let list = await Lists.find(firstList.get('id'));
  expect(list.get('id')).toBe(firstList.get('id'));
});

test('It can save an object that has hasMany relations on it for model with custom instance', async () => {
  const testType = (name) => ({
    factory(props) {
      return Immutable.Map({ type: name, wrapped: Immutable.fromJS(props) });
    },
    instanceOf(maybeInstance) {
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === name;
    },
    serialize(instance) {
      return instance.get('wrapped').toObject();
    }
  });

  const Users = Klein.model('users', {
    type: testType('user'),
    relations: {
      projects: { hasMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    type: testType('project'),
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/saving-has-many';
  FS.removeSync(process.env.APP_ROOT);

  const newProjects = Immutable.fromJS([
    {
      type: 'project',
      wrapped: { 
        name: 'Awesome Game' 
      }
    },
    {
      type: 'project',
      wrapped: {
        id: uuid(),
        name: 'Design'
      }
    }
  ]);

  const persistedProject = Immutable.fromJS({
    type: 'project', 
    wrapped: {
      name: 'Persisted'
    }
  });

  const newUser = {
    name: 'Nathan'
  };

  await Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let project = await Projects.create(persistedProject);
  let user = await Users.create(newUser);

  // Add the first two unsaved projects
  user = user.setIn(['wrapped', 'projects'], newProjects);
  user = await Users.save(user);

  expect(user.getIn(['wrapped', 'projects']).filter((project) => project.getIn(['wrapped', 'id'])).count()).toBe(2);

  // Add the third, already saved project
  user = user.setIn(['wrapped', 'projects'], user.getIn(['wrapped', 'projects']).push(project));
  user = await Users.save(user);

  expect(user.getIn(['wrapped', 'projects']).count()).toBe(3);
  expect(user.getIn(['wrapped', 'projects']).find(p => p.getIn(['wrapped', 'id']) === project.getIn(['wrapped' ,'id']))).not.toBeNull();

  let users = await Users.include('projects').all();

  expect(
    users
      .first()
      .getIn(['wrapped', 'projects'])
      .count()
  ).toBe(3);

  project = users
    .first()
    .getIn(['wrapped', 'projects'])
    .find(p => p.getIn(['wrapped', 'name']) === newProjects.first().getIn(['wrapped', 'name']));

  expect(typeof project.getIn(['wrapped', 'id'])).not.toBe('undefined');

  project = await Projects.find(project.getIn(['wrapped', 'id']));
  user = await Users.first();
  expect(project.getIn(['wrapped', 'userId'])).toBe(user.getIn(['wrapped', 'id']));
});

test('It can save an object that has a belongsTo relations on it', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/saving-belongs-to';
  FS.removeSync(process.env.APP_ROOT);

  const newProject = Immutable.fromJS({
    id: uuid(),
    name: 'Awesome Game'
  });

  let initialUser = Immutable.fromJS({
    name: 'Nathan'
  });

  let replacementUser = Immutable.fromJS({
    name: 'Lilly'
  });

  await Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let project = await Projects.create(newProject);
  // User is nothing initially
  expect(typeof project.get('user')).toBe('undefined');

  project = project.set('user', initialUser);
  project = await Projects.save(project);
  // User was persisted and attached to the project
  initialUser = await Users.where({ name: initialUser.get('name') })
    .include('projects')
    .first();
  expect(project.getIn(['user', 'id'])).toBe(initialUser.get('id'));
  expect(initialUser.getIn(['projects', 0, 'id'])).toBe(project.get('id'));
  expect(initialUser.get('createdAt')).toEqual(project.get('updatedAt'));

  project = project.set('user', replacementUser);
  project = await Projects.save(project);
  replacementUser = await Users.where({ name: replacementUser.get('name') })
    .include('projects')
    .first();
  expect(project.getIn(['user', 'id'])).toBe(replacementUser.get('id'));
  expect(replacementUser.getIn(['projects', 0, 'id'])).toBe(project.get('id'));

  // Check that the initialUser projects is now empty
  initialUser = await Users.include('projects').find(initialUser.get('id'));
  expect(initialUser.get('projects').count()).toBe(0);

  const testDate = new Date(2019, 3, 10);
  project = await Projects.save(project, { touch: testDate });
  replacementUser = await Users.find(replacementUser.get('id'));
  expect(replacementUser.get('updatedAt')).toEqual(testDate);

  let previousUser = replacementUser;
  project = await Projects.save(project, { touch: false });
  replacementUser = await Users.find(previousUser.get('id'));
  expect(replacementUser.get('updatedAt')).toEqual(previousUser.get('updatedAt'));

  project = project.set('user', null);
  project = await Projects.save(project);
  replacementUser = await Users.where({ name: replacementUser.get('name') })
    .include('projects')
    .first();
  expect(project.get('user')).toBe(null);
  expect(replacementUser.get('projects').count()).toBe(0);
});

test('It can save an object that has a belongsTo relations on it for model with custom instance', async () => {
  const testType = (name) => ({
    factory(props) {
      return Immutable.Map({ type: name, wrapped: Immutable.fromJS(props) });
    },
    instanceOf(maybeInstance) {
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === name;
    },
    serialize(instance) {
      return instance.get('wrapped').toObject();
    }
  });

  const Users = Klein.model('users', {
    type: testType('user'),
    relations: {
      projects: { hasMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    type: testType('project'),
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/saving-belongs-to';
  FS.removeSync(process.env.APP_ROOT);

  const newProject = Immutable.fromJS({
    type: 'project',
    wrapped: {
      id: uuid(),
      name: 'Awesome Game'
    }
  });

  let initialUser = Immutable.fromJS({
    type: 'user',
    wrapped: { 
      name: 'Nathan'
    }
  });

  let replacementUser = Immutable.fromJS({
    type: 'user',
    wrapped: {
      name: 'Lilly'
    }
  });

  await Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let project = await Projects.create(newProject);
  // User is nothing initially
  expect(typeof project.getIn(['wrapped', 'user'])).toBe('undefined');

  project = project.setIn(['wrapped', 'user'], initialUser);
  project = await Projects.save(project);
  // User was persisted and attached to the project
  initialUser = await Users.where({ name: initialUser.getIn(['wrapped', 'name']) })
    .include('projects')
    .first();
  expect(project.getIn(['wrapped', 'user', 'wrapped', 'id'])).toBe(initialUser.getIn(['wrapped', 'id']));
  expect(initialUser.getIn(['wrapped', 'projects', 0, 'wrapped', 'id'])).toBe(project.getIn(['wrapped', 'id']));

  project = project.setIn(['wrapped', 'user'], replacementUser);
  project = await Projects.save(project);
  replacementUser = await Users.where({ name: replacementUser.getIn(['wrapped', 'name']) })
    .include('projects')
    .first();
  expect(project.getIn(['wrapped', 'user', 'wrapped', 'id'])).toBe(replacementUser.getIn(['wrapped', 'id']));
  expect(replacementUser.getIn(['wrapped', 'projects', 0, 'wrapped', 'id'])).toBe(project.getIn(['wrapped', 'id']));

  // Check that the initialUser projects is now empty
  initialUser = await Users.include('projects').find(initialUser.getIn(['wrapped', 'id']));
  expect(initialUser.getIn(['wrapped', 'projects']).count()).toBe(0);

  project = project.setIn(['wrapped', 'user'], null);
  project = await Projects.save(project);
  replacementUser = await Users.where({ name: replacementUser.getIn(['wrapped', 'name']) })
    .include('projects')
    .first();
  expect(project.getIn(['wrapped', 'user'])).toBe(null);
  expect(replacementUser.getIn(['wrapped', 'projects']).count()).toBe(0);
});

test('It can save an object and touch timestamps of existing belongsTo relations', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasMany: 'projects' }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      user: { belongsTo: 'user', touch: true }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/saving-belongs-to';
  FS.removeSync(process.env.APP_ROOT);

  const newProject = Immutable.fromJS({
    id: uuid(),
    name: 'Awesome Game'
  });

  let initialUser = Immutable.fromJS({
    name: 'Nathan'
  });

  let replacementUser = Immutable.fromJS({
    name: 'Lilly'
  });

  await Helpers.setupDatabase([['users', 'name:string'], ['projects', 'name:string', 'userId:uuid']], {
    knex: Klein.knex
  });

  let user = await Users.create(initialUser.set('projects', Immutable.List([newProject])));
  
  let project = await Projects.where({ name: newProject.get('name') }).first();
  expect(project).toBeTruthy();
  
  project = await Projects.save(project);

  let previousUser = user;
  user = await Users.find(user.get('id'));

  expect(user.get('updatedAt')).toEqual(project.get('updatedAt'));
  expect(user.get('updatedAt').valueOf()).toBeGreaterThan(previousUser.get('updatedAt').valueOf());

  project = await Projects.save(project.set('user', null));
  project = await Projects.find(project.get('id'));
  project = await Projects.save(project);
  
  previousUser = user;
  user = await Users.find(user.get('id'));

  expect(user.get('updatedAt')).toEqual(previousUser.get('updatedAt'));

  project = await Projects.save(project.set('user', user));
  user = await Users.include('projects').find(user.get('id'))
  
  Sinon.spy(Users, 'save');
  user = await Users.save(user);
  expect(Users.save.calledOnce).toBe(true);
  Users.save.restore();
});

test('It can destroy dependent objects when destroying the parent', async () => {
  const Users = Klein.model('users', {
    relations: {
      projects: { hasMany: 'projects', dependent: true },
      profile: { hasOne: 'profile', dependent: true }
    }
  });
  const Projects = Klein.model('projects', {
    relations: {
      user: { belongsTo: 'user' }
    }
  });
  const Profiles = Klein.model('profiles', {
    relations: {
      user: { belongsTo: 'user' }
    }
  });

  process.env.APP_ROOT = '/tmp/klein/destroying-relations';
  FS.removeSync(process.env.APP_ROOT);

  const newProject = Immutable.fromJS({ id: uuid(), name: 'Awesome Game' });
  const newUser = Immutable.fromJS({ name: 'Nathan' });
  const newProfile = Immutable.fromJS({ bio: 'Working on Awesome Game' });

  await Helpers.setupDatabase(
    [['users', 'name:string'], ['projects', 'name:string', 'userId:uuid'], ['profiles', 'bio:string', 'userId:uuid']],
    {
      knex: Klein.knex
    }
  );

  let project = await Projects.create(newProject);
  let profile = await Profiles.create(newProfile);
  let user = await Users.create(newUser);

  user = user.set('projects', Immutable.List([project])).set('profile', profile);
  user = await Users.save(user);

  // Destroy the user (and the dependent project)
  user = await Users.destroy(user);
  project = await Projects.reload(project);
  expect(project).toBeNull();
  profile = await Profiles.reload(profile);
  expect(profile).toBeNull();
});
