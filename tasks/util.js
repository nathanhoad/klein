const Path = require('path');
const FS = require('fs-extra');
const Knex = require('knex');


function appRoot () {
    if (process.env.APP_ROOT) return process.env.APP_ROOT;
    
    let current_directory = process.cwd();
    let project_directory = null;

    let levels = 50;
    while (current_directory.length > 0 && !project_directory && levels-- > 0) {
        if (FS.readdirSync(current_directory).includes('node_modules') || FS.readdirSync(current_directory).includes('package.json')) {
            project_directory = current_directory;
        } else {
            current_directory = Path.dirname(current_directory);
        }
    }
    
    return project_directory;
}


function loadConfig (args) {
    const app_root = appRoot();
    
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
    
    return {
        app_root: args.app_root || app_root,
        migrations_path: args.migrations_path || migrations_path,
        models_path: args.models_path || models_path,
        knex: args.knex || Knex({
            client: 'pg',
            connection: process.env.DATABASE_URL
        })
    }
}


function saveTemplate (contents_or_filename, replacements, save_to_file) {
    let template = '';

    if (contents_or_filename.includes('\n')) {
        template = contents_or_filename;
    } else {
        template = FS.readFileSync(`${__dirname}/templates/${contents_or_filename}`, 'utf8');
    }
    
    // Change tabs to spaces
    replacements['\t'] = '    ';

    Object.keys(replacements).forEach((find) => {
        template = template.replace(new RegExp('{{' + find.toUpperCase() + '}}', 'g'), replacements[find]);
    });

    FS.mkdirsSync(Path.dirname(save_to_file));
    FS.writeFileSync(save_to_file, template);

    return template;
}


function justFilename (thing_path, things_path) {
    return thing_path.replace(new RegExp(things_path + '/?'), '');
}


module.exports = { appRoot, loadConfig, saveTemplate, justFilename };
