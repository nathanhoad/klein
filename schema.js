require('dotenv').load({ silent: true });

const Knex = require('knex');
const { getConfig } = require('./util');
const Chalk = require('chalk');

class Schema {
  constructor(config) {
    this.config = config || {};
  }

  /**
   * Print a message to stdout
   * @param {string|Function} type 
   * @param {string?} label 
   * @param {string} message 
   */
  log(type, label, message) {
    if (this.config.log === false) return;

    const l = this.config.log === true || typeof this.config.log === 'undefined' ? console.log : this.config.log;

    if (type === '') {
      l('');
    }

    if (type === 'done') {
      l('\n 👍 ', message, '\n');
    } else if (type === 'wait') {
      l('\n ✋ ', message);
    } else {
      label = label.substr(0, 9);
      label = '         '.slice(0, 9 - label.length) + label;
      l(type(label) + ' ' + message);
    }
  }

  /**
 * Get the config needed to run tasks with Knex
 * @param {Object?} config 
 * @returns {Object}
 */
  async getKnexConfig(config) {
    config = await getConfig(config);

    return {
      options: {
        directory: `${config.rootPath}/${config.migrationsPath}`,
        models: `${config.rootPath}/${config.modelsPath}`,
        tableName: 'schema_migrations'
      },
      knex:
        config.knex ||
        Knex({
          client: 'pg',
          connection: process.env.DATABASE_URL
        }),
      knexTest:
        config.knexTest ||
        (process.env.TEST_DATABASE_URL
          ? Knex({
              client: 'pg',
              connection: process.env.TEST_DATABASE_URL
            })
          : null)
    };
  }

  /**
 * Migrate to the latest schema group
 * @param {Array?} args Any command line arguments
 * @param {Object?} config 
 * @returns {Array} The filenames of the migrations that were run
 */
  async migrate(args, config) {
    args = args || [];
    config = await this.getKnexConfig(config);

    let results = await config.knex.migrate.latest(config.options);
    let files = [];

    if (results[1].length == 0) {
      this.log('wait', null, 'No migrations to run');
    } else {
      results[1].forEach(migrationPath => {
        this.log(Chalk.green, 'migrate', migrationPath.replace(config.options.directory + '/', ''));
        files.push(migrationPath);
      });

      // Run the migration on the test database if there is one
      if (config.knexTest) {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        results = await config.knexTest.migrate.latest(config.options);
        process.env.NODE_ENV = previousEnv;
      }

      this.log('done', null, `Migrated group ${results[0]}`);
    }

    return files;
  }

  /**
 * Rollback the most recent schema group
 * @param {Array?} args Any command line arguments
 * @param {Object?} config 
 * @returns {Array} The filenames of the migrations that were rolled back
 */
  async rollback(args, config) {
    args = args || [];
    config = await this.getKnexConfig(config);

    let results = await config.knex.migrate.rollback(config.options);
    let files = [];

    if (results[1].length == 0) {
      this.log('wait', null, 'Nothing to roll back');
    } else {
      results[1].forEach(migrationPath => {
        this.log(Chalk.yellow, 'rollback', migrationPath.replace(config.options.directory + '/', ''));
        files.push(migrationPath);
      });

      // Run the same rollback on the test database if there is one
      if (config.knexTest) {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        results = await config.knexTest.migrate.rollback(config.options);
        process.env.NODE_ENV = previousEnv;
      }
    }

    this.log('done', null, `Rolled back group ${results[0]}`);

    return files;
  }

  /**
 * Get the current schema version
 * @param {Array?} args Any command line arguments
 * @param {Object?} config 
 * @returns {String} The current schema version
 */
  async version(args, config) {
    args = args || [];
    config = await this.getKnexConfig(config);

    let version = await config.knex.migrate.currentVersion(config.options);

    if (version == 'none') {
      this.log('wait', null, 'No migrations have been run');
      return null;
    }

    this.log(Chalk.green, 'version', version);
    return version;
  }

  /**
 * Get a list of all tables in the database
 * @param {Array?} args Any command line arguments
 * @param {Object?} config 
 * @returns {Array<String>} The list of table names
 */
  async getTableNames(args, config) {
    args = args || [];
    config = await this.getKnexConfig(config);

    return (await config.knex.raw(
      "select table_name from information_schema.tables where table_schema = 'public'"
    )).rows.map(row => row.table_name);
  }

  /**
 * Get the schema for a table
 * @param {String} table The name of the table
 * @returns {Array} The schema information for each column
 */
  async schemaForTable(table, knex) {
    const info = await knex(table).columnInfo();
    const columns = Object.keys(info).map(key => {
      let meta = [];
      let column = info[key];

      if (column.nullable == 'NO') {
        meta.push('not nullable');
      }
      if (column.defaultValue) {
        meta.push(`default ${column.defaultValue}`);
      }

      if (meta.length > 0) {
        meta = `(${meta.join(', ')})`;
      } else {
        meta = '';
      }

      return {
        name: key,
        type: column.type,
        meta
      };
    });

    return columns;
  }

  /**
 * 
 * @param {Array?} args Any command line arguments
 * @param {*} config 
 * @returns {Array} The schema for any requested table/s
 */
  async schema(args, config) {
    args = args || [];
    config = await this.getKnexConfig(config);

    let table = args[0];
    if (table) {
      let schema = await this.schemaForTable(table, config.knex);
      this.log(Chalk.green, 'schema', Chalk.bold(table.toUpperCase()));
      schema.columns.forEach(column => {
        this.log(Chalk.gray, 'schema', column.name + ': ' + Chalk.yellow(column.type), Chalk.gray(column.meta));
      });
      return [schema];
    } else {
      let queries = (await this.getTableNames(args, config))
        .map(tableName => {
          if (tableName.includes('schema_migrations')) return null;
          return this.schemaForTable(tableName);
        })
        .filter(q => q);

      let schemas = await Promise.all(queries);
      schemas.forEach((schema, index) => {
        this.log(Chalk.green, 'schema', Chalk.bold(schema.table.toUpperCase()));
        schema.columns.forEach(column => {
          this.log(Chalk.gray, 'schema', column.name + ': ' + Chalk.yellow(column.type), Chalk.gray(column.meta));
        });
        if (index < schemas.length - 1) {
          this.log('');
        }
      });

      return schemas;
    }
  }

  /**
 * 
 * @param {Array?} args Any command line arguments
 * @param {Object?} config 
 */
  async emptyDatabase(args, config) {
    args = args || [];
    config = await this.getKnexConfig(config);

    let tableNames = (await config.knexTest.raw(
      "select table_name from information_schema.tables where table_schema = 'public'"
    )).rows;

    if (!args.includes('--include-schema')) {
      tableNames = tableNames.filter(t => !t.table_name.includes('schema_migrations'));
    }

    return Promise.all(
      tableNames.map(t => {
        if (args.includes('--drop')) {
          return config.knexTest.schema.dropTable(t.table_name);
        } else {
          return config.knexTest(t.table_name).truncate();
        }
      })
    );
  }
}

module.exports = new Schema();
module.exports.createSchema = config => new Schema(config);
