const Knex = require('knex');
const Inflect = require('i')();
const Log = require('./log');
const FS = require('fs-extra');

const { appRoot, loadConfig, saveTemplate, justFilename } = require('./util');



function newMigration (args) {
    args = args || [];
    const config = loadConfig(args);

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
        
        let table_name = Inflect.tableize(name);
        
        let migration_name = Inflect.dasherize(name);
        let migration_template = 'migration.js';
        
        let add_columns = '';
        let drop_columns = '';
        
        if (args.includes('model')) {
            migration_name = `create-${Inflect.dasherize(Inflect.pluralize(name))}`;
            migration_template = 'model-migration.js';
            
            // Convert name:string counter:integer -> table.string('name'), table.integer('counter')
            add_columns = args.filter(c => c.includes(':')).map(c => {
                let cs = c.split(':');
                return `table.${cs[1]}('${cs[0]}');`;
            }).join('\n\t\t\t');
            
        } else {
            let matches = name.match(/^add\-(.*?)-to-(.*?)$/);
            if (matches && matches.length == 3) {
                table_name = matches[2];
                
                // Convert add-name-and-counter-to-users -> table.string('name'), table.string('counter')
                let columns = matches[1].split('-and-').map(c => Inflect.underscore(c));
                add_columns = columns.map(c => {
                    return `table.string('${c}');`;
                }).join('\n\t\t\t');
                
                drop_columns = `table.dropColumns(${columns.map(c => `'${c}'`).join()});`;
            } else {
                table_name = name.split('-')[name.split('-').length - 1];
            }
        }

        config.knex.migrate.make(migration_name, options).then((migration_path) => {
            saveTemplate(migration_template, {
                table: table_name,
                add_columns: add_columns,
                drop_columns: drop_columns
            }, migration_path);
            Log.info('Created migration', Log.bold(justFilename(migration_path, options.directory)));

            return resolve([migration_path]);

        }).catch((err) => {
            Log.error(err.message);
            return reject(err);
        });
    });
}


function newModel (args) {
    args = args || [];
    const config = loadConfig(args);

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
        
        saveTemplate('model.js', {
            table: table_name
        }, model_path);
        Log.info("Created model", Log.bold(justFilename(model_path, config.models_path)));
        files = files.concat(model_path);

        return resolve(files);
    });
}



function migrate (args) {
    args = args || [];
    let config = loadConfig(args);
    
    var options = {
        directory: config.migrations_path,
        models: config.models_path,
        tableName: 'schema_migrations'
    }
    
    return new Promise((resolve, reject) => {
        config.knex.migrate.latest(options).then((results) => {
            let files = [];
            
            if (results[1].length == 0) {
                Log.muted('No migrations to run');
            } else {
                Log.info(Log.bold(`Migrating group ${results[0]}`));
                results[1].forEach((migration_path) => {
                    Log.info(Log.gray(justFilename(migration_path, config.migrations_path)));
                    files.push(migration_path);
                });
            }
            return resolve(files);
            
        }).catch((err) => {
            Log.error(err);
            return reject(err);
        });
    });
}


function rollback (args) {
    args = args || [];
    let config = loadConfig(args);
    
    var options = {
        directory: config.migrations_path,
        models: config.models_path,
        tableName: 'schema_migrations'
    }
    
    return new Promise((resolve, reject) => {
        config.knex.migrate.rollback(options).then((results) => {
            let files = [];
            
            if (results[1].length == 0) {
                Log.muted('Nothing to roll back');
            } else {
                Log.warning(Log.bold(`Rolling back group ${results[0]}`));
                results[1].forEach((migration_path) => {
                    Log.warning(Log.gray(justFilename(migration_path, config.migrations_path)));
                    files.push(migration_path);
                });
            }
            return resolve(files);
            
        }).catch((err) => {
            Log.error(err);
            return reject(err);
        });
    });
}


function version (args) {
    args = args || [];
    let config = loadConfig(args);
    
    var options = {
        directory: config.migrations_path,
        models: config.models_path,
        tableName: 'schema_migrations'
    }
    
    return new Promise((resolve, reject) => {
        config.knex.migrate.currentVersion(options).then((version) => {
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


function schemaForTable (args) {
    args = args || [];
    let config = loadConfig(args);
    
    let table = args[0];
    
    return config.knex.raw(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = '${table}';`).then((result) => {
        let columns = [];
        result.rows.forEach((column) => {
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
        
        return Promise.resolve({ table: table, columns: columns });
    });
}


function schema (args) {
    args = args || [];
    let config = loadConfig(args);
    
    let table = args[0];
    return new Promise((resolve, reject) => {
        if (table) {
            return schemaForTable(config, [table]).then((schema) => {
                Log.info(Log.bold(schema.table.toUpperCase()));
                
                schema.columns.forEach((column) => {
                    Log.info(`${column.name}:`, Log.yellow(column.type), Log.gray(column.meta));
                });
                
                return resolve([schema]);
            });
            
        } else {
            return config.knex.raw("select table_name from information_schema.tables where table_schema = 'public'").then((result) => {
                let queries = [];
                
                result.rows.forEach((table) => {
                    if (table.table_name.includes('schema_migrations')) return;
                    queries.push(schemaForTable([table.table_name]));
                });
                
                // return resolve(Promise.all(queries));
                return Promise.all(queries).then((schemas) => {
                    schemas.forEach((schema, index) => {
                        Log.info(Log.bold(schema.table.toUpperCase()));
                        
                        schema.columns.forEach((column) => {
                            Log.info(`${column.name}:`, Log.yellow(column.type), Log.gray(column.meta));
                        });
                        
                        if (index < schemas.length - 1) {
                            Log.info('');
                        }
                    });
                    
                    return resolve(schemas);
                });
            });
        }
    });
}
    

    
module.exports = {
    newMigration,
    newModel: (args) => {
        return newMigration(args.concat('model')).then(migration_files => {
            return newModel(args).then(model_files => {
                return migration_files.concat(model_files);
            });
        })
    },
    migrate,
    rollback,
    version,
    schema
};
