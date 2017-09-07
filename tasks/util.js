require('dotenv').load({ silent: true });

const Path = require('path');
const FS = require('fs-extra');
const Knex = require('knex');

function appRoot() {
    if (process.env.APP_ROOT) return process.env.APP_ROOT;

    let current_directory = process.cwd();
    let project_directory = null;

    let levels = 50;
    while (current_directory.length > 0 && !project_directory && levels-- > 0) {
        if (
            FS.readdirSync(current_directory).includes('node_modules') ||
            FS.readdirSync(current_directory).includes('package.json')
        ) {
            project_directory = current_directory;
        } else {
            current_directory = Path.dirname(current_directory);
        }
    }

    return project_directory;
}

function loadConfig(config) {
    if (typeof config === 'undefined') config = {};

    const app_root = config.app_root || appRoot();

    let migrations_path = `${app_root}/migrations`;
    let models_path = `${app_root}/app/server/models`;

    // Models
    if (FS.existsSync(`${app_root}/models`)) {
        models_path = `${app_root}/models`;
    } else if (FS.existsSync(`${app_root}/app/models`)) {
        models_path = `${app_root}/app/models`;
    }

    // Migrations
    if (FS.existsSync(`${app_root}/app/migrations`)) {
        migrations_path = `${app_root}/app/migrations`;
    } else if (FS.existsSync(`${app_root}/app/server/migrations`)) {
        migrations_path = `${app_root}/app/server/migrations`;
    }

    // See if we can load anything from the projects package.json
    try {
        const package_config = require(`${app_root}/package.json`);
        config = Object.assign({}, package_config.klein, config);

        if (config.migrations_path) migrations_path = `${app_root}/${config.migrations_path}`;
        if (config.models_path) models_path = `${app_root}/${config.models_path}`;
    } catch (e) {
        // Do nothing
    }

    return {
        app_root,
        migrations_path: migrations_path,
        models_path: models_path,
        timestamps:
            typeof config.timestamps !== 'undefined'
                ? config.timestamps
                : {
                      created_at: 'created_at',
                      updated_at: 'updated_at'
                  },
        knex:
            config.knex ||
            Knex({
                client: 'pg',
                connection: process.env.DATABASE_URL
            }),
        knex_test:
            config.knex_test ||
            (process.env.TEST_DATABASE_URL
                ? Knex({
                      client: 'pg',
                      connection: process.env.TEST_DATABASE_URL
                  })
                : null)
    };
}

function saveTemplate(contents_or_filename, replacements, save_to_file) {
    let template = '';

    if (contents_or_filename.includes('\n')) {
        template = contents_or_filename;
    } else {
        template = FS.readFileSync(`${__dirname}/templates/${contents_or_filename}`, 'utf8');
    }

    // Change tabs to spaces
    replacements['\t'] = '    ';

    Object.keys(replacements).forEach(find => {
        template = template.replace(new RegExp('{{' + find.toUpperCase() + '}}', 'g'), replacements[find]);
    });

    FS.mkdirsSync(Path.dirname(save_to_file));
    FS.writeFileSync(save_to_file, template);

    return template;
}

function justFilename(thing_path, things_path) {
    return thing_path.replace(new RegExp(things_path + '/?'), '');
}

module.exports = { appRoot, loadConfig, saveTemplate, justFilename };
