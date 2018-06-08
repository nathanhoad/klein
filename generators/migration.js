const Generator = require('yeoman-generator');
const Path = require('path');
const Inflect = require('i')();
const Chalk = require('chalk');
const Prettier = require('prettier');
const { guessColumns, guessTableName, ensureRootPath, getConfig } = require('../util');

/**
 * Generate a migration
 */
module.exports = class extends Generator {
  constructor(args, opts) {
    super(args, opts);

    this.timestamp = new Date().toJSON().replace(/[^0-9]+/g, '');

    this.argument('name', { required: false });
  }

  async initializing() {
    this.destinationRoot(await ensureRootPath());
  }

  async prompting() {
    if (!this.options.name || this.options.name.includes(':')) {
      this.options = Object.assign(
        {},
        this.options,
        await this.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Describe this migration',
            default: 'new-migration'
          }
        ])
      );
    }

    this.options.name = Inflect.dasherize(
      this.options.name
        .toLowerCase()
        .replace(/[^0-9a-z\-]/g, '_')
        .replace(/\s+/, '_')
    );
    this.options.filename = this.timestamp + '-' + this.options.name + '.js';

    this.options.tableName = guessTableName(this.options.name);
    if (!this.options.tableName) {
      this.options.tableName = guessTableName(this.options.name);
      if (!this.options.tableName) {
        this.options = Object.assign(
          {},
          this.options,
          await this.prompt({
            type: 'input',
            name: 'tableName',
            message: 'Which table is this migration for?',
            default: null
          })
        );
      }
    }
  }

  async writing() {
    const config = await getConfig();

    // Guess column from name intent unless there are manual columns
    let columns = guessColumns(this.options._, this.options.name);
    let indices = columns.filter(c => c.index);

    // Copy files
    const migrationFilename = this.destinationPath(`${config.migrationsPath}/${this.options.filename}`);
    this.fs.copyTpl(this.templatePath('migration.js'), migrationFilename, {
      createTable: this.options.filename.startsWith('create-'),
      tableName: this.options.tableName,
      columns,
      indices
    });
    this._prettify(migrationFilename);
  }

  _prettify(template) {
    this.fs.write(
      template,
      Prettier.format(this.fs.read(template), {
        printWidth: 120,
        tabWidth: 2,
        singleQuote: true
      })
    );
  }

  end() {
    this.log('\n 👍 ', 'Created', Chalk.bold(this.options.filename), '\n');
  }
};
