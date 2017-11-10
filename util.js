const Path = require('path');
const FS = require('fs-extra');
const guessRootPath = require('guess-root-path');

// Convert name:string counter:integer -> table.string('name'), table.integer('counter')
// Convert add-something-and-other-thing-to-table -> table.string('something'), table.string('otherThing')
function guessColumns(array, string) {
  array = array.filter(a => a.includes(':'));

  if (array && array.length > 0) {
    return array.map(c => {
      let [name, type, index] = c.split(':');

      if (name.toLowerCase().match(/at$/) || name.toLowerCase().match(/id$/)) {
        index = true;
      } else {
        index = !!index;
      }

      return {
        type,
        name,
        index
      };
    });
  } else {
    const matches = (string || '').match(/^(add|update)\-(.*?)-(to|for|on)-(.*?)$/);

    if (!matches || matches.length < 5) return [];

    return matches[2].split('-and-').map(c => {
      const name = Inflect.camelize(Inflect.underscore(c), false);
      const index = name.toLowerCase().match(/at$/) || name.toLowerCase().match(/id$/);

      return {
        type: 'string',
        name,
        index
      };
    });
  }
}

/**
 * Guess the name of the table based on the name of the migration
 * @param {string} migrationName
 */
function guessTableName(migrationName) {
  let tableName = '';
  let matches = migrationName.match(/^(.*?)-(to|for|on)-(.*?)$/);
  if (matches && matches.length == 4) {
    tableName = Inflect.underscore(matches[3]);
  }

  return tableName;
}

/**
 * Find the project root and make sure it is an actual path
 * @returns {string} The projects root directory
 */
async function ensureRootPath() {
  const root = process.env.APP_ROOT || guessRootPath() + '/tmp';
  await FS.ensureDir(root);

  return root;
}

/**
 * Load configuration options from whereever we can find it. We should end up
 * with something like this:
 * {
 *    rootPath: '/somewhere/blah',
 *    migrationsPath: '/somewhere/blah/migrations',
 *    modelsPath: '/somewhere/blah/server/models',
 *    timestamps: {
 *      createdAt: 'created_at',
 *      updatedAt: 'updated_at'
 *    }
 * }
 * @param {Object?} overrides Any config that you might already have
 * @returns {Object}
 */
async function getConfig(overrides) {
  overrides = overrides || {};

  let rootPath = await ensureRootPath();

  // See if there is anything helpful in the package.json
  let packageJson;
  try {
    packageJson = require(`${rootPath}/package.json`).klein;
  } catch (ex) {
    packageJson = {};
  }

  let migrationsPath =
    packageJson.migrationsPath ||
    firstPathThatExists(rootPath, [
      'migrations',
      Path.join('db', 'migrations'),
      Path.join('src', 'migrations'),
      Path.join('server', 'migrations')
    ]);

  let modelsPath =
    packageJson.modelsPath ||
    firstPathThatExists(rootPath, [
      Path.join('server', 'models'),
      Path.join('src', 'models'),
      Path.join('db', 'models'),
      `models`
    ]);

  let timestamps = packageJson.timestamps;
  if (typeof timestamps === 'object') {
    // Possible values are true (createdAt), "some string", or false
    timestamps.createdAt = timestamps.createdAt === true ? 'createdAt' : timestamps.createdAt;
    timestamps.updatedAt = timestamps.updatedAt === true ? 'updatedAt' : timestamps.updatedAt;
  } else if (timestamps === false) {
    timestamps = {
      createdAt: false,
      updatedAt: false
    };
  } else if (typeof timestamps === 'undefined') {
    timestamps = {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt'
    };
  }

  return Object.assign({ rootPath, migrationsPath, modelsPath, timestamps }, overrides);
}

/**
 * Get the first path that exists
 * @param {Array} paths A list of paths ordered with most important first
 * @returns {String} The first path that exists or, if none exist, the first path
 */
function firstPathThatExists(basePath, paths) {
  return paths.find(path => FS.existsSync(Path.join(basePath, path))) || paths[0];
}

module.exports = { guessColumns, guessTableName, ensureRootPath, getConfig };
