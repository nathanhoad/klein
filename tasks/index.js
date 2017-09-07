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
            directory: config.migrations_path
        };

        let name = args[0].replace(/\s/g, '-');

        let table_name = Inflect.tableize(name.replace('create-', ''));

        let migration_name = Inflect.dasherize(name);
        let migration_template = 'migration.js';

        let action = 'table';

        // Convert name:string counter:integer -> table.string('name'), table.integer('counter')
        let add_columns = args
            .filter(c => c.includes(':'))
            .map(c => {
                let cs = c.split(':');
                return `table.${cs[1]}('${cs[0]}');`;
            })
            .join('\n\t\t\t');
        let indices = args
            .filter(c => c.includes(':') && c.includes('_id:'))
            .map(c => `table.index('${c.split(':')[0]}');`)
            .join('\n\t\t\t');
        let drop_columns = `table.dropColumns(${args
            .filter(c => c.includes(':'))
            .map(c => `'${c.split(':')[0]}'`)
            .join(', ')});`;

        if (args.includes('model') || name.includes('create-')) {
            migration_name = `create-${Inflect.dasherize(Inflect.pluralize(name))}`;
            migration_template = 'model-migration.js';
            if (indices.length > 0) indices = '\n\t\t\t' + indices;

            if (config.timestamps.created_at || config.timestamps.updated_at) {
                add_columns += '\n';
                if (config.timestamps.created_at) {
                    add_columns += `\n\t\t\ttable.timestamp('${config.timestamps.created_at}');`;
                    indices += `\n\t\t\ttable.index('${config.timestamps.created_at}');`;
                }
                if (config.timestamps.updated_at) {
                    add_columns += `\n\t\t\ttable.timestamp('${config.timestamps.updated_at}');`;
                    indices += `\n\t\t\ttable.index('${config.timestamps.updated_at}');`;
                }
                add_columns += '\n';
            }
        } else {
            if (indices.length > 0) indices = '\n\t\t\t\n\t\t\t' + indices;

            let matches = name.match(/^add\-(.*?)-to-(.*?)$/);
            if (matches && matches.length == 3) {
                table_name = Inflect.underscore(matches[2]);

                // Convert add-name-and-counter-to-users -> table.string('name'), table.string('counter')
                // only if we didn't specify fields as arguments
                if (add_columns === '') {
                    let columns = matches[1].split('-and-').map(c => Inflect.underscore(c));
                    add_columns = columns
                        .map(c => {
                            return `table.string('${c}');`;
                        })
                        .join('\n\t\t\t');

                    let indices = columns
                        .filter(c => c.includes('_id:'))
                        .map(c => `table.index('${c.split(':')[0]}');`)
                        .join('\n\t\t\t');
                    if (indices.length > 0) indices = '\n\t\t\t\n\t\t\t' + indices;

                    drop_columns = `table.dropColumns(${columns.map(c => `'${c}'`).join(', ')});`;
                }
            } else {
                table_name = Inflect.underscore(name.replace('create-', ''));
            }
        }

        config.knex.migrate
            .make(migration_name, options)
            .then(migration_path => {
                saveTemplate(
                    migration_template,
                    {
                        action: action,
                        table: table_name,
                        add_columns: add_columns,
                        drop_columns: drop_columns,
                        indices: indices
                    },
                    migration_path
                );
                Log.info('Created migration', Log.bold(justFilename(migration_path, options.directory)));

                return resolve([migration_path]);
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
        FS.mkdirsSync(config.models_path);

        let table_name = Inflect.tableize(name);
        let model_path = `${config.models_path}/${Inflect.dasherize(table_name)}.js`;

        // Don't overwrite the model thats already there
        if (FS.existsSync(model_path)) {
            Log.warning(Log.bold(table_name), 'model exists');
            return resolve([]);
        }

        // See if we need timestamps
        let model_properties = [];
        if (
            config.timestamps === false ||
            (config.timestamps.created_at === false && config.timestamps.updated_at === false)
        ) {
            model_properties = `, {\n\ttimestamps: false\n }`;
        } else {
            if (config.timestamps.created_at !== 'created_at') {
                model_properties.push(`\n\t\tcreated_at: '${config.timestamps.created_at}'`);
            }
            if (config.timestamps.updated_at !== 'updated_at') {
                model_properties.push(`\n\t\tupdated_at: '${config.timestamps.updated_at}'`);
            }

            if (model_properties.length > 0) {
                model_properties = `, {\n\ttimestamps: {${model_properties.join('')}\n\t}\n}`;
            } else {
                model_properties = '';
            }
        }

        saveTemplate(
            'model.js',
            {
                table: table_name,
                model_properties
            },
            model_path
        );
        Log.info('Created model', Log.bold(justFilename(model_path, config.models_path)));
        files = files.concat(model_path);

        return resolve(files);
    });
}

function migrate(args, config) {
    args = args || [];
    config = loadConfig(config);

    var options = {
        directory: config.migrations_path,
        models: config.models_path,
        tableName: 'schema_migrations'
    };

    return new Promise((resolve, reject) => {
        return config.knex.migrate
            .latest(options)
            .then(results => {
                let files = [];

                if (results[1].length == 0) {
                    Log.muted('No migrations to run');
                } else {
                    Log.info(Log.bold(`Migrating group ${results[0]}`));
                    results[1].forEach(migration_path => {
                        Log.info(Log.gray(justFilename(migration_path, config.migrations_path)));
                        files.push(migration_path);
                    });
                }

                if (config.knex_test) {
                    const previousEnv = process.env.NODE_ENV;
                    process.env.NODE_ENV = 'test';
                    config.knex_test.migrate.latest(options).then(results => {
                        process.env.NODE_ENV = previousEnv;
                        return resolve(files);
                    });
                } else {
                    return resolve(files);
                }
            })
            .catch(err => {
                Log.error(err);
                return reject(err);
            });
    });
}

function rollback(args, config) {
    args = args || [];
    config = loadConfig(config);

    var options = {
        directory: config.migrations_path,
        models: config.models_path,
        tableName: 'schema_migrations'
    };

    return new Promise((resolve, reject) => {
        config.knex.migrate
            .rollback(options)
            .then(results => {
                let files = [];

                if (results[1].length == 0) {
                    Log.muted('Nothing to roll back');
                } else {
                    Log.warning(Log.bold(`Rolling back group ${results[0]}`));
                    results[1].forEach(migration_path => {
                        Log.warning(Log.gray(justFilename(migration_path, config.migrations_path)));
                        files.push(migration_path);
                    });
                }

                if (config.knex_test) {
                    const previousEnv = process.env.NODE_ENV;
                    process.env.NODE_ENV = 'test';
                    config.knex_test.migrate.rollback(options).then(results => {
                        process.env.NODE_ENV = previousEnv;
                        return resolve(files);
                    });
                } else {
                    return resolve(files);
                }
            })
            .catch(err => {
                Log.error(err);
                return reject(err);
            });
    });
}

function version(args, config) {
    args = args || [];
    config = loadConfig(config);

    var options = {
        directory: config.migrations_path,
        models: config.models_path,
        tableName: 'schema_migrations'
    };

    return new Promise((resolve, reject) => {
        config.knex.migrate.currentVersion(options).then(version => {
            if (version == 'none') {
                version = null;
                Log.muted('No migrations have been run');
            } else {
                Log.info('Database is at version', Log.bold(version));
            }

            return resolve(version);
        });
    });
}

function schemaForTable(args, config) {
    args = args || [];
    config = loadConfig(config);

    let table = args[0];

    return config.knex
        .raw(
            `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = '${table}';`
        )
        .then(result => {
            let columns = [];
            result.rows.forEach(column => {
                let meta = [];

                if (column.is_nullable == 'NO') {
                    meta.push('not nullable');
                }
                if (column.column_default) {
                    meta.push(`default ${column.column_default}`);
                }

                if (meta.length > 0) {
                    meta = `(${meta.join(', ')})`;
                } else {
                    meta = '';
                }

                columns.push({
                    name: column.column_name,
                    type: column.data_type,
                    meta: meta
                });
            });

            return { table: table, columns: columns };
        });
}

function schema(args, config) {
    args = args || [];
    config = loadConfig(config);

    let table = args[0];
    if (table) {
        return schemaForTable(config, [table]).then(schema => {
            Log.info(Log.bold(schema.table.toUpperCase()));

            schema.columns.forEach(column => {
                Log.info(`${column.name}:`, Log.yellow(column.type), Log.gray(column.meta));
            });

            return [schema];
        });
    } else {
        return config.knex
            .raw("select table_name from information_schema.tables where table_schema = 'public'")
            .then(result => {
                let queries = [];

                result.rows.forEach(table => {
                    if (table.table_name.includes('schema_migrations')) return;
                    queries.push(schemaForTable([table.table_name]));
                });

                // return resolve(Promise.all(queries));
                return Promise.all(queries).then(schemas => {
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
                });
            });
    }
}

function emptyDatabase(args, config) {
    args = args || [];
    config = loadConfig(config);

    return config.knex_test
        .raw("select table_name from information_schema.tables where table_schema = 'public'")
        .then(result => {
            let rows = result.rows;

            if (!args.includes('include_schema')) {
                rows = rows.filter(t => !t.table_name.includes('schema_migrations'));
            }

            return Promise.all(
                rows.map(t => {
                    if (args.includes('drop')) {
                        return config.knex_test.schema.dropTable(t.table_name);
                    } else {
                        return config.knex_test(t.table_name).truncate();
                    }
                })
            );
        });
}

module.exports = {
    newMigration,
    newModel: (args, config) => {
        return newMigration(args.concat('model'), config).then(migration_files => {
            return newModel(args, config).then(model_files => {
                return migration_files.concat(model_files);
            });
        });
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
