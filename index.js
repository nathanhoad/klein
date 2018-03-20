require('dotenv').load({ silent: true });

const knex = require('knex');
const uuid = require('uuid/v4');
const Model = require('./model');

class Klein {
  constructor() {
    this.models = {};
  }

  /**
     * Connect Klein to a database
     * @param {*} databaseUrlOrKnex 
     * @param {string} client 
     * @return {Knex}
     */
  connect(databaseUrlOrKnex, client) {
    if (databaseUrlOrKnex instanceof String || typeof databaseUrlOrKnex == 'undefined') {
      const defaultDatabaseUrl =
        process.env.NODE_ENV == 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

      this.knex = knex({
        connection: typeof databaseUrlOrKnex === 'string' ? databaseUrlOrKnex : defaultDatabaseUrl,
        client: typeof client === 'string' ? client : 'pg',
        returning: '*'
      });
    } else {
      this.knex = databaseUrlOrKnex;
    }

    return this;
  }

  /**
     * Destroys the current connection to the database
     */
  async disconnect() {
    if (this.knex) {
      await this.knex.destroy();
      this.knex = null;
    }
  }

  /**
     * Define or register a model
     * @param {string} tableName 
     * @param {object} args
     * @return {Model} 
     */
  model(tableName, args) {
    // If we already know about this model and no args are given then return the previously defined model
    if (typeof args === 'undefined' && typeof this.models[tableName] !== 'undefined') return this.models[tableName];

    // Create a new model
    args = Object.assign({}, { klein: this }, args);
    const model = new Model(tableName, args);

    // Keep a registry of defined models
    this.models[tableName] = model;

    return model;
  }

  /**
     * Generate a new uuid v4
     * @return {string}
     */
  uuid() {
    return uuid();
  }

  /**
     * Wrap a transaction
     * @param {*} handler 
     */
  transaction(handler) {
    if (!this.knex) throw new Error('Klein must be connected before creating a transaction');

    return this.knex.transaction(handler);
  }
}

const defaultInstance = new Klein();
defaultInstance.create = () => {
  return new Klein();
};

module.exports = defaultInstance;
