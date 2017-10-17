const Knex = require('knex');
const Inflect = require('i')();
const Log = require('./log');
const FS = require('fs-extra');

const { appRoot, loadConfig, saveTemplate, justFilename } = require('./util');

function newMigration(args, config) {
  args = args || [];
  config = loadConfig(config);

  return new Promise((resolve, reject) => {
    if (args.length == 0) {
      Log.error('No name specified');
      return reject(new Error('No name specified'));
    }

    if (args.includes('no-migration')) {
      Log.muted('Skipping migration');
      return resolve([]);
    }

    const options = {
      tableName: 'schema_migrations',
      directory: config.migrationsPath
    };

    let name = args[0].replace(/\s/g, '-');

    let tableName = Inflect.tableize(name.replace('create-', ''));

    let migrationName = Inflect.dasherize(name);
    let migrationTemplate = 'migration.js';

    let action = 'table';

    // Convert name:string counter:integer -> table.string('name'), table.integer('counter')
    let addColumns = args
      .filter(c => c.includes(':'))
      .map(c => {
        let cs = c.split(':');
        return `table.${cs[1]}('${cs[0]}');`;
      })
      .join(' ');
    let indices = args
      .filter(c => c.includes(':') && c.includes('_id:'))
      .map(c => `table.index('${c.split(':')[0]}');`)
      .join(' ');
    let dropColumns = `table.dropColumns(${args
      .filter(c => c.includes(':'))
      .map(c => `'${c.split(':')[0]}'`)
      .join(', ')});`;

    if (args.includes('model') || name.includes('create-')) {
      migrationName = `create-${Inflect.dasherize(Inflect.pluralize(name))}`;
      migrationTemplate = 'model-migration.js';
      //   if (indices.length > 0) indices = '\n\t\t\t' + indices;

      if (config.timestamps.createdAt || config.timestamps.updatedAt) {
        addColumns += '\n';
        if (config.timestamps.createdAt) {
          addColumns += `\ntable.timestamp('${config.timestamps.createdAt}');`;
          indices += `\ntable.index('${config.timestamps.createdAt}');`;
        }
        if (config.timestamps.updatedAt) {
          addColumns += `\ntable.timestamp('${config.timestamps.updatedAt}');`;
          indices += `\ntable.index('${config.timestamps.updatedAt}');`;
        }
        addColumns += '\n';
      }
    } else {
      //   if (indices.length > 0) indices = '\n\t\t\t\n\t\t\t' + indices;

      let matches = name.match(/^add\-(.*?)-to-(.*?)$/);
      if (matches && matches.length == 3) {
        tableName = Inflect.underscore(matches[2]);

        // Convert add-name-and-counter-to-users -> table.string('name'), table.string('counter')
        // only if we didn't specify fields as arguments
        if (addColumns === '') {
          let columns = matches[1].split('-and-').map(c => Inflect.underscore(c));
          addColumns = columns
            .map(c => {
              return `table.string('${c}');`;
            })
            .join(' ');

          let indices = columns
            .filter(c => c.includes('_id:'))
            .map(c => `table.index('${c.split(':')[0]}');`)
            .join(' ');
          //   if (indices.length > 0) indices = '\n\t\t\t\n\t\t\t' + indices;

          dropColumns = `table.dropColumns(${columns.map(c => `'${c}'`).join(', ')});`;
        }
      } else {
        tableName = Inflect.underscore(name.replace('create-', ''));
      }
    }

    config.knex.migrate
      .make(migrationName, options)
      .then(migrationPath => {
        saveTemplate(
          migrationTemplate,
          {
            action: action,
            table: tableName,
            addColumns: addColumns,
            dropColumns: dropColumns,
            indices: indices
          },
          migrationPath
        );
        Log.info('Created migration', Log.bold(justFilename(migrationPath, options.directory)));

        return resolve([migrationPath]);
      })
      .catch(err => {
        Log.error(err.message);
        return reject(err);
      });
  });
}

function newModel(args, config) {
  args = args || [];
  config = loadConfig(config);

  return new Promise((resolve, reject) => {
    let files = [];

    if (args.length == 0) {
      Log.error('No name specified');
      return reject(new Error('No name specified'));
    }

    if (args.includes('no-model')) {
      Log.muted('Skipping creating model');
      return resolve([]);
    }

    // Set up the model
    let name = args[0].toLowerCase();
    FS.mkdirsSync(config.modelsPath);

    let tableName = Inflect.tableize(name);
    let modelPath = `${config.modelsPath}/${Inflect.dasherize(tableName)}.js`;

    // Don't overwrite the model thats already there
    if (FS.existsSync(modelPath)) {
      Log.warning(Log.bold(tableName), 'model exists');
      return resolve([]);
    }

    // See if we need timestamps
    let modelProperties = [];
    if (
      config.timestamps === false ||
      (config.timestamps.createdAt === false && config.timestamps.updatedAt === false)
    ) {
      modelProperties = `, { \ntimestamps: false\n }`;
    } else {
      if (config.timestamps.createdAt !== 'createdAt') {
        modelProperties.push(`\ncreatedAt: '${config.timestamps.createdAt}'`);
      }
      if (config.timestamps.updatedAt !== 'updatedAt') {
        modelProperties.push(`\nupdatedAt: '${config.timestamps.updatedAt}'`);
      }

      if (modelProperties.length > 0) {
        modelProperties = `, {\ntimestamps: {${modelProperties.join(',')}\n}\n}`;
      } else {
        modelProperties = '';
      }
    }

    saveTemplate(
      'model.js',
      {
        table: tableName,
        modelProperties
      },
      modelPath
    );
    Log.info('Created model', Log.bold(justFilename(modelPath, config.modelsPath)));
    files = files.concat(modelPath);

    return resolve(files);
  });
}

async function migrate(args, config) {
  args = args || [];
  config = loadConfig(config);

  var options = {
    directory: config.migrationsPath,
    models: config.modelsPath,
    tableName: 'schema_migrations'
  };

  let results = await config.knex.migrate.latest(options);
  let files = [];

  if (results[1].length == 0) {
    Log.muted('No migrations to run');
  } else {
    Log.info(Log.bold(`Migrating group ${results[0]}`));
    results[1].forEach(migrationPath => {
      Log.info(Log.gray(justFilename(migrationPath, config.migrationsPath)));
      files.push(migrationPath);
    });
  }

  // Run the migration on the test database if there is one
  if (config.knexTest) {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    results = await config.knexTest.migrate.latest(options);
    process.env.NODE_ENV = previousEnv;
  }

  return files;
}

async function rollback(args, config) {
  args = args || [];
  config = loadConfig(config);

  var options = {
    directory: config.migrationsPath,
    models: config.modelsPath,
    tableName: 'schema_migrations'
  };

  let results = await config.knex.migrate.rollback(options);
  let files = [];

  if (results[1].length == 0) {
    Log.muted('Nothing to roll back');
  } else {
    Log.warning(Log.bold(`Rolling back group ${results[0]}`));
    results[1].forEach(migrationPath => {
      Log.warning(Log.gray(justFilename(migrationPath, config.migrationsPath)));
      files.push(migrationPath);
    });
  }

  // Run the same rollback on the test database if there is one
  if (config.knexTest) {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    results = await config.knexTest.migrate.rollback(options);
    process.env.NODE_ENV = previousEnv;
  }

  return files;
}

function version(args, config) {
  args = args || [];
  config = loadConfig(config);

  var options = {
    directory: config.migrationsPath,
    models: config.modelsPath,
    tableName: 'schema_migrations'
  };

  return config.knex.migrate.currentVersion(options).then(version => {
    if (version == 'none') {
      version = null;
      Log.muted('No migrations have been run');
    } else {
      Log.info('Database is at version', Log.bold(version));
    }

    return version;
  });
}

function getTableNames(args, config) {
  args = args || [];
  config = loadConfig(config);

  return config.knex
    .raw("select table_name from information_schema.tables where table_schema = 'public'")
    .then(result => {
      return result.rows.map(row => row.table_name);
    });
}

function schemaForTable(args, config) {
  args = args || [];
  config = loadConfig(config);

  let table = args[0];

  return config
    .knex(table)
    .columnInfo()
    .then(info => {
      let columns = [];
      Object.keys(info).forEach(key => {
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

        columns.push({
          name: key,
          type: column.type,
          meta: meta
        });
      });

      return { table: table, columns: columns };
    });
}

async function schema(args, config) {
  args = args || [];
  config = loadConfig(config);

  let table = args[0];
  if (table) {
    let schema = await schemaForTable([table], config);

    Log.info(Log.bold(schema.table.toUpperCase()));
    schema.columns.forEach(column => {
      Log.info(`${column.name}:`, Log.yellow(column.type), Log.gray(column.meta));
    });

    return [schema];
  } else {
    let queries = (await getTableNames(args, config))
      .map(tableName => {
        if (tableName.includes('schema_migrations')) return null;
        return schemaForTable([tableName], config);
      })
      .filter(q => q);

    let schemas = await Promise.all(queries);
    schemas.forEach((schema, index) => {
      Log.info(Log.bold(schema.table.toUpperCase()));

      schema.columns.forEach(column => {
        Log.info(`${column.name}:`, Log.yellow(column.type), Log.gray(column.meta));
      });

      if (index < schemas.length - 1) {
        Log.info('');
      }
    });

    return schemas;
  }
}

function emptyDatabase(args, config) {
  args = args || [];
  config = loadConfig(config);

  return config.knexTest
    .raw("select table_name from information_schema.tables where table_schema = 'public'")
    .then(result => {
      let rows = result.rows;

      if (!args.includes('include_schema')) {
        rows = rows.filter(t => !t.table_name.includes('schema_migrations'));
      }

      return Promise.all(
        rows.map(t => {
          if (args.includes('drop')) {
            return config.knexTest.schema.dropTable(t.table_name);
          } else {
            return config.knexTest(t.table_name).truncate();
          }
        })
      );
    });
}

module.exports = {
  newMigration,
  newModel: async (args, config) => {
    const migrationFiles = await newMigration(args.concat('model'), config);
    const modelFiles = await newModel(args, config);

    return migrationFiles.concat(modelFiles);
  },
  migrate,
  rollback,
  version,
  schema,
  emptyDatabase,

  unknown(command) {
    Log.error(`Unkown command '${command}'`);
    return Promise.resolve();
  }
};
