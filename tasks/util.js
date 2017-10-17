require('dotenv').load({ silent: true });

const Path = require('path');
const FS = require('fs-extra');
const Knex = require('knex');
const Prettier = require('prettier');

function guessAppPath() {
  if (process.env.APP_ROOT) return process.env.APP_ROOT;

  let currentDirectory = process.cwd();
  let projectDirectory = null;

  let levels = 50;
  while (currentDirectory.length > 0 && !projectDirectory && levels-- > 0) {
    if (
      FS.readdirSync(currentDirectory).includes('node_modules') ||
      FS.readdirSync(currentDirectory).includes('package.json')
    ) {
      projectDirectory = currentDirectory;
    } else {
      currentDirectory = Path.dirname(currentDirectory);
    }
  }

  return projectDirectory;
}

function loadConfig(config) {
  if (typeof config === 'undefined') config = {};

  const appRootPath = config.appRootPath || guessAppPath();

  let migrationsPath = `${appRootPath}/migrations`;
  let modelsPath = `${appRootPath}/app/server/models`;

  // Models
  if (FS.existsSync(`${appRootPath}/models`)) {
    modelsPath = `${appRootPath}/models`;
  } else if (FS.existsSync(`${appRootPath}/app/models`)) {
    modelsPath = `${appRootPath}/app/models`;
  }

  // Migrations
  if (FS.existsSync(`${appRootPath}/app/migrations`)) {
    migrationsPath = `${appRootPath}/app/migrations`;
  } else if (FS.existsSync(`${appRootPath}/app/server/migrations`)) {
    migrationsPath = `${appRootPath}/app/server/migrations`;
  }

  // See if we can load anything from the projects package.json
  try {
    const packageConfig = require(`${appRootPath}/package.json`);
    config = Object.assign({}, packageConfig.klein, config);

    if (config.migrationsPath) migrationsPath = `${appRootPath}/${config.migrationsPath}`;
    if (config.modelsPath) modelsPath = `${appRootPath}/${config.modelsPath}`;
  } catch (e) {
    // Do nothing
  }

  return {
    appRootPath,
    migrationsPath: migrationsPath,
    modelsPath: modelsPath,
    timestamps:
      typeof config.timestamps !== 'undefined'
        ? config.timestamps
        : {
            createdAt: 'createdAt',
            updatedAt: 'updatedAt'
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

function saveTemplate(contentsOrFilename, replacements, saveToFile) {
  let template = '';

  if (contentsOrFilename.includes('\n')) {
    template = contentsOrFilename;
  } else {
    template = FS.readFileSync(`${__dirname}/templates/${contentsOrFilename}`, 'utf8');
  }

  // Change tabs to spaces
  replacements['\t'] = '    ';

  Object.keys(replacements).forEach(find => {
    template = template.replace(new RegExp('{{' + find.toUpperCase() + '}}', 'g'), replacements[find]);
  });

  // Make the file pretty
  Prettier.format(template, {
    printWidth: 120,
    tabWidth: 2,
    singleQuote: true
  });

  FS.mkdirsSync(Path.dirname(saveToFile));
  FS.writeFileSync(saveToFile, template);

  return template;
}

function justFilename(thingPath, thingsPath) {
  return thingPath.replace(new RegExp(thingsPath + '/?'), '');
}

module.exports = { guessAppPath, loadConfig, saveTemplate, justFilename };
