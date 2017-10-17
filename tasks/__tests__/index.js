const FS = require('fs-extra');
const Helpers = require('./_helpers');

const Log = require('../log');
Log.silent = true;

let knex;

beforeEach(() => {
  knex = Helpers.knex();
});

afterEach(() => {
  return knex.destroy();
});

describe('Migrations', () => {
  test('It can create a new migration', async () => {
    const Tasks = require('..');
    process.env.APP_ROOT = '/tmp/klein/new-migration';
    FS.removeSync(process.env.APP_ROOT);
    const files = await Tasks.newMigration(['add-name-to-users'], { knex, knexTest: knex });
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\d+_add-name-to-users\.js/);
    var fileContents = FS.readFileSync(files[0], 'utf8');
    expect(fileContents).toContain('up(knex, Promise) {');
    expect(fileContents).toContain('down(knex, Promise) {');
    expect(fileContents).toContain(`return knex.schema.table('users', table => {`);
    expect(fileContents).toContain(`table.string('name');`);
  });

  test('It can create a new migration with supplied column details', async () => {
    const Tasks = require('..');
    process.env.APP_ROOT = '/tmp/klein/new-migration-with-columns';
    FS.removeSync(process.env.APP_ROOT);

    const files = await Tasks.newMigration(['add-age-to-users', 'age:integer'], { knex, knexTest: knex });
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\d+_add-age-to-users\.js/);

    var fileContents = FS.readFileSync(files[0], 'utf8');

    expect(fileContents).toContain('up(knex, Promise) {');
    expect(fileContents).toContain('down(knex, Promise) {');

    expect(fileContents).toContain(`return knex.schema.table('users', table => {`);
    expect(fileContents).toContain(`table.integer('age');`);
  });
});

describe('Models', () => {
  test('It can create a new model', async () => {
    const Tasks = require('..');

    process.env.APP_ROOT = '/tmp/klein/new-model';
    FS.removeSync(process.env.APP_ROOT);

    const files = await Tasks.newModel(['users', 'firstName:string', 'lastName:string', 'credit:integer'], {
      knex,
      knexTest: knex
    });
    expect(files.length).toBe(2);
    expect(files[0]).toMatch(/\d+_create-users\.js/);
    expect(files[1]).toMatch(/users\.js/);

    var fileContents = FS.readFileSync(files[0], 'utf8');

    expect(fileContents).toContain('up(knex, Promise) {');
    expect(fileContents).toContain('down(knex, Promise) {');

    expect(fileContents).toContain(`return knex.schema.createTable('users', table => {`);
    expect(fileContents).toContain(`table.string('firstName');`);
    expect(fileContents).toContain(`table.string('lastName');`);
    expect(fileContents).toContain(`table.integer('credit');`);

    var fileContents = FS.readFileSync(files[1], 'utf8');

    expect(fileContents).toContain(`module.exports = Klein.model('users');`);
  });

  test('It can create a new model with different timestamp names', async () => {
    const Tasks = require('..');

    process.env.APP_ROOT = '/tmp/klein/new-model-with-different-timestamps';
    FS.removeSync(process.env.APP_ROOT);

    const files = await Tasks.newModel(['users', 'name:string'], {
      knex,
      knexTest: knex,
      timestamps: { createdAt: 'created', updatedAt: 'updated' }
    });

    expect(files.length).toBe(2);
    expect(files[0]).toMatch(/\d+_create-users\.js/);
    expect(files[1]).toMatch(/users\.js/);

    var fileContents = FS.readFileSync(files[0], 'utf8');

    expect(fileContents).toContain('up(knex, Promise) {');
    expect(fileContents).toContain('down(knex, Promise) {');

    expect(fileContents).toContain(`return knex.schema.createTable('users', table => {`);
    expect(fileContents).toContain(`table.string('name');`);
    expect(fileContents).toContain(`table.timestamp('created');`);
    expect(fileContents).toContain(`table.timestamp('updated');`);
    expect(fileContents).toContain(`table.index('created');`);
    expect(fileContents).toContain(`table.index('updated');`);

    var fileContents = FS.readFileSync(files[1], 'utf8');

    expect(fileContents).toContain(`module.exports = Klein.model('users', {`);
    expect(fileContents).toContain(`timestamps: {`);
    expect(fileContents).toContain(`createdAt: 'created'`);
    expect(fileContents).toContain(`updatedAt: 'updated'`);
  });

  test('It can create a new model without timestamps', async () => {
    const Tasks = require('..');

    process.env.APP_ROOT = '/tmp/klein/new-model-without-timestamps';
    FS.removeSync(process.env.APP_ROOT);

    const files = await Tasks.newModel(['users', 'name:string'], {
      knex,
      knexTest: knex,
      timestamps: { createdAt: false, updatedAt: false }
    });

    expect(files.length).toBe(2);
    expect(files[0]).toMatch(/\d+_create-users\.js/);
    expect(files[1]).toMatch(/users\.js/);

    var fileContents = FS.readFileSync(files[0], 'utf8');

    expect(fileContents).toContain('up(knex, Promise) {');
    expect(fileContents).toContain('down(knex, Promise) {');

    expect(fileContents).toContain(`return knex.schema.createTable('users', table => {`);
    expect(fileContents).toContain(`table.string('name');`);
    expect(fileContents).not.toContain(`table.timestamp('createdAt');`);
    expect(fileContents).not.toContain(`table.timestamp('updatedAt');`);
    expect(fileContents).not.toContain(`table.index('createdAt');`);
    expect(fileContents).not.toContain(`table.index('updatedAt');`);

    var fileContents = FS.readFileSync(files[1], 'utf8');

    expect(fileContents).toContain(`module.exports = Klein.model('users', {`);
    expect(fileContents).toContain(`timestamps: false`);
    expect(fileContents).not.toContain(`createdAt: 'createdAt'`);
    expect(fileContents).not.toContain(`updatedAt: 'updatedAt'`);
  });
});

describe('Migrating', () => {
  test('It can migrate and roll back', async () => {
    const Tasks = require('..');

    process.env.APP_ROOT = '/tmp/klein/migrate-and-rollback';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.emptyDatabase(knex);
    await Tasks.newModel(['users'], { knex, knexTest: knex });

    let files = await Tasks.migrate([], { knex, knexTest: knex });
    expect(files.length).toBe(1);

    await Tasks.newMigration(['add-name-to-users'], { knex, knexTest: knex });

    files = await Tasks.migrate([], { knex, knexTest: knex });
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\d+_add-name-to-users\.js/);

    fiels = await Tasks.rollback([], { knex, knexTest: knex });
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\d+_add-name-to-users\.js/);
  });

  test('It can get the current schema version', async () => {
    const Tasks = require('..');

    process.env.APP_ROOT = '/tmp/klein/schema-version';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.emptyDatabase(knex);
    await Tasks.newModel(['users'], { knex, knexTest: knex });

    let files = await Tasks.migrate([], { knex, knexTest: knex });
    let version = await Tasks.version([], { knex, knexTest: knex });

    expect(version).toBe(files[0].match(/\d{14}/)[0]);
  });

  test('It can get the schema for a table', async () => {
    const Tasks = require('..');

    process.env.APP_ROOT = '/tmp/klein/table-schema';
    FS.removeSync(process.env.APP_ROOT);

    await Helpers.emptyDatabase(knex);
    await Tasks.newModel(['users', 'firstName:string', 'lastName:string', 'credit:integer'], { knex, knexTest: knex });
    await Tasks.migrate([], { knex, knexTest: knex });

    let schema = await Tasks.schema([], { knex, knexTest: knex });
    expect(schema instanceof Array).toBeTruthy();

    let users_table = schema[0];

    expect(users_table.table).toBe('users');
    expect(users_table.columns[1].name).toBe('firstName');
    expect(users_table.columns[1].type).toBe('character varying');

    expect(users_table.columns[2].name).toBe('lastName');
    expect(users_table.columns[2].type).toBe('character varying');

    expect(users_table.columns[3].name).toBe('credit');
    expect(users_table.columns[3].type).toBe('integer');

    expect(users_table.columns[4].name).toBe('createdAt');
    expect(users_table.columns[4].type).toBe('timestamp with time zone');

    expect(users_table.columns[5].name).toBe('updatedAt');
    expect(users_table.columns[5].type).toBe('timestamp with time zone');
  });
});
