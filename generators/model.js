const Generator = require('yeoman-generator');
const guessRootPath = require('guess-root-path');
const Path = require('path');
const Inflect = require('i')();
const Chalk = require('chalk');
const FS = require('fs-extra');
const Prettier = require('prettier');
const { guessColumns, guessTableName, ensureRootPath, getConfig } = require('../util');

/**
 * Generate a model
 * 
 * Could be:
 * 
 *  klein g model
 *  klein g model users
 *  klein g model users firstName:string lastName:string
 */
module.exports = class extends Generator {
  constructor(args, opts) {
    super(args, opts);

    this.timestamp = new Date().toJSON().replace(/[^0-9]+/g, '');

    this.argument('tableName', { required: false });
  }

  async initializing() {
    this.destinationRoot(await ensureRootPath());
  }

  async prompting() {
    if (!this.options.tableName || this.options.tableName.includes(':')) {
      this.options = Object.assign(
        {},
        this.options,
        await this.prompt([
          {
            type: 'input',
            name: 'tableName',
            message: 'What is this model called?'
          }
        ])
      );
    }

    this.options.tableName = Inflect.tableize(this.options.tableName.replace(/ +/g, '_'));

    this.options.migrationName = 'create-' + Inflect.dasherize(this.options.tableName);
    this.options.migrationFilename = this.timestamp + '-' + this.options.migrationName + '.js';

    this.options.filename = Inflect.dasherize(this.options.tableName) + '.js';
  }

  async writing() {
    const config = await getConfig();

    // Guess column from name intent unless there are manual columns
    let columns = guessColumns(this.options._, this.options.name);

    // See if we need to add createdAt or updatedAt
    if (!config.timestamps || config.timestamps.createdAt) {
      columns.push({
        type: 'timestamp',
        name: config.timestamps ? config.timestamps.createdAt : 'createdAt',
        index: true
      });
    }
    if (!config.timestamps || config.timestamps.updatedAt) {
      columns.push({
        type: 'timestamp',
        name: config.timestamps ? config.timestamps.updatedAt : 'updatedAt',
        index: true
      });
    }

    let indices = columns.filter(c => c.index);

    // Copy files
    const migrationFilename = this.destinationPath(`${config.migrationsPath}/${this.options.migrationFilename}`);
    this.fs.copyTpl(this.templatePath('migration.js'), migrationFilename, {
      createTable: true,
      tableName: this.options.tableName,
      columns,
      indices
    });
    this._prettify(migrationFilename);

    const modelFilename = this.destinationPath(`${config.modelsPath}/${this.options.filename}`);
    this.fs.copyTpl(this.templatePath('model.js'), modelFilename, {
      tableName: this.options.tableName,
      tableProperties: this.options.tableProperties,
      timestamps: config.timestamps
    });
    this._prettify(modelFilename);
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
    this.log('\n 👍 ', 'Created model for', Chalk.bold(this.options.tableName), '\n');
  }
};
