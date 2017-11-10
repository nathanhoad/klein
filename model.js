const Immutable = require('immutable');
const Inflect = require('i')();
const uuid = require('uuid/v4');

class Model {
  /**
   * Create a new model for the given table
   * @param {string} tableName 
   * @param {object} args 
   * @constructor
   */
  constructor(tableName, args) {
    this.tableName = tableName;
    this.klein = args.klein;
    this.args = args;

    // `timestamps` can be either a hash of { createdAt, updatedAt } or false
    const timestamps = args.timestamps === false ? { createdAt: false, updatedAt: false } : args.timestamps;
    this.timestampFields = Object.assign(
      {},
      {
        createdAt: 'createdAt',
        updatedAt: 'updatedAt'
      },
      timestamps
    );

    this.defaults = Object.assign(
      {},
      {
        id: this.klein.uuid
      },
      args.defaults
    );
    this.contexts = args.contexts || {};

    this._availableRelations = args._availableRelations || {};
    this._includedRelations = args._includedRelations || [];
    this.relations = args.relations || {};
    Object.keys(this.relations).forEach(relationName => {
      let relation = this.relations[relationName];

      relation.name = relationName;

      if (relation.hasAndBelongsToMany) {
        relation.many = true;
        relation.type = 'hasAndBelongsToMany';
        // through table name will generally be a combination of the two tables (alpha sorted)
        relation.throughTable = relation.through || [this.tableName, Inflect.pluralize(relationName)].sort().join('_');
        relation.table = relation.table || Inflect.pluralize(relationName);
        relation.sourceKey = relation.primaryKey || `${Inflect.singularize(this.tableName)}Id`;
        relation.key = relation.foreignKey || `${Inflect.singularize(relationName)}Id`;
        relation.dependent = false;
      } else if (relation.belongsTo) {
        relation.many = false;
        relation.type = 'belongsTo';
        relation.table = relation.table || Inflect.pluralize(relation.belongsTo);
        relation.key = relation.foreignKey || `${Inflect.singularize(relationName)}Id`;
        relation.dependent = false;
      } else if (relation.hasMany) {
        relation.many = true;
        relation.type = 'hasMany';
        relation.table = relation.table || Inflect.pluralize(relation.hasMany);
        relation.key = relation.foreignKey || `${Inflect.singularize(this.tableName)}Id`;
        relation.dependent = relation.dependent === true;
      }

      this._availableRelations[relationName] = relation;
    });
  }

  /**
     * Get the current internal knex instance
     * @param {string} table 
     * @param {object} options 
     * @returns {knex}
     */
  knex(table, options) {
    if (!this.hasConnection()) throw new Error('Klein must be connected before a model has access to Knex');

    if (options && options.transaction) {
      return this.klein.knex(table).transacting(options.transaction);
    } else {
      return this.klein.knex(table);
    }
  }

  /**
   * Check to see if knex has been connected yet
   * @returns {boolean}
   */
  hasConnection() {
    return this.klein && this.klein.knex;
  }

  /**
   * Get the schema for the related table (lazy loaded)
   * @async
   * @returns {object} The schema
   */
  async schema() {
    if (!this._schema) {
      this._schema = await this.knex(this.tableName).columnInfo();
    }

    return this._schema;
  }

  /**
   * Start a new query chain
   * @returns {knex}
   */
  query() {
    if (!this.hasConnection()) throw new Error('Klein must be connected before querying a model');

    if (this.args.defaultScope) {
      return this.args.defaultScope;
    } else {
      return this.knex(this.tableName).select();
    }
  }

  /**
   * Create new records
   * @async
   * @param {*} properties A hash or array of hashes of properties for the new objects
   * @param {*} options 
   * @returns {(Immutable.Map|Immutable.List)}
   */
  async create(properties, options) {
    if (typeof options === 'undefined') options = {};
    options.exists = false;

    // If given an array it should return a List
    const isArray = properties instanceof Array || properties instanceof Immutable.List;

    if (isArray) {
      const instances = await Promise.all(properties.map(p => this.save(p, options)));
      return Immutable.List(instances);
    } else {
      return this.save(properties, options);
    }
  }

  /**
   * Remove a record from the database
   * @async
   * @param {Immutable.Map} model 
   * @param {*} options 
   * @returns {Immutable.Map} The now non-persisted record
   */
  async destroy(model, options) {
    if (!this.hasConnection()) throw new Error('Klein must be connected before destroying a model');

    await this.knex(this.tableName)
      .where({ id: model.get('id') })
      .del();

    // Check over dependent hasMany (and hasAndBelongsToMany join) relations
    const dependentRelations = Object.keys(this._availableRelations)
      .map(k => this._availableRelations[k])
      .filter(r => r.dependent || r.type == 'hasAndBelongsToMany');

    if (dependentRelations.length == 0) return model;

    await Promise.all(
      dependentRelations.map(dr => {
        // if hasAndBelongsToMany then remove rows from the join table
        const table = dr.type == 'hasAndBelongsToMany' ? dr.throughTable : dr.table;
        const key = dr.type == 'hasAndBelongsToMany' ? dr.sourceKey : dr.key;

        return this.knex(table, options)
          .where(key, model.get('id'))
          .del();
      })
    );

    return model;
  }

  /**
   * Persist a record
   * @param {*} model The hash or Immutable.Map to persist
   * @param {*} options 
   * @returns {Immutable.Map}
   */
  async save(model, options) {
    if (!this.hasConnection()) throw new Error('Klein must be connected before saving a model');

    if (typeof options === 'undefined') options = {};

    let properties = model.toJS ? model.toJS() : Object.assign({}, model);

    // Detach relations because they can't be saved against this record
    let relations = {};
    Object.keys(properties).forEach(propertyName => {
      if (Object.keys(this._availableRelations).includes(propertyName)) {
        relations[propertyName] = properties[propertyName];
        delete properties[propertyName];
      }
    });

    // Convert everything to something we can put into the database
    properties = this._serialize(properties);
    this._updateTimestamp(properties, 'updatedAt');

    // Check if the record has already been persisted
    const exists =
      typeof options.exists === 'boolean'
        ? options.exists
        : await this.knex(this.tableName, options)
            .where({ id: properties.id || null })
            .then(rows => {
              return rows.length > 0;
            });

    // Save or create the model
    let results;
    if (exists) {
      results = await this.knex(this.tableName, options)
        .where({ id: properties.id })
        .update(properties, '*');
    } else {
      this._updateTimestamp(properties, 'created_at');
      results = await this.knex(this.tableName, options).insert(properties, '*');
    }

    let object = Object.assign({}, results[0]);

    // Reattach any relations that were on the model before
    Object.keys(relations).forEach(propertyName => {
      object[propertyName] = relations[propertyName];
    });
    object = await this._saveRelations(object, options);

    return Immutable.fromJS(object);
  }

  /**
   * Find a record by its ID
   * @param {*} id 
   * @param {*} options 
   * @returns {Immutable.Map}
   */
  find(id, options) {
    return this.where({ id: id }).first(options);
  }

  /**
   * 
   * @param {*} model 
   * @param {*} options 
   */
  reload(model, options) {
    return this.where({ id: model.get('id') }).first(options);
  }

  /**
   * Add a WHERE clause to the query
   * @returns {Model}
   */
  where() {
    const args = Array.from(arguments);
    let query = this.query().clone();

    if (args.length == 1) {
      query = query.where(args[0]);
    } else {
      query = query.where(args[0], args[1], args[2]);
    }

    return this._chain(query);
  }

  /**
   * Add a WHERE IN clause to the query
   * @param {*} column The column to match against
   * @param {*} values The values to match with the column
   * @returns {Model}
   */
  whereIn(column, values) {
    let query = this.query()
      .clone()
      .whereIn(column, values);
    return this._chain(query);
  }

  /**
   * Add a WHERE NOT IN clause to the query
   * @param {*} column The column to match against
   * @param {Array} values The values to match with the columm
   * @returns {Model}
   */
  whereNotIn(column, values) {
    let query = this.query()
      .clone()
      .whereNotIn(column, values);
    return this._chain(query);
  }

  /**
   * Add a WHERE NULL clause to the query
   * @param {*} column The column to match against
   */
  whereNull(column) {
    let query = this.query()
      .clone()
      .whereNull(column);
    return this._chain(query);
  }

  /**
   * Add a WHERE NOT NULL clause to the query
   * @param {*} column 
   */
  whereNotNull(column) {
    let query = this.query()
      .clone()
      .whereNotNull(column);
    return this._chain(query);
  }

  /**
   * Include related models
   * @param {*}
   */
  include() {
    this.args._includedRelations = Array.from(arguments);
    return this._chain(this.query().clone());
  }

  /**
   * Execute the query and return the first result
   * @param {Object} options 
   * @returns {*}
   */
  first(options) {
    let query = this.query().clone();

    if (options && options.transaction) {
      query = query.transacting(options.transaction);
    }

    return query.limit(1).then(results => {
      if (results.length == 0) return null;

      return this._includeRelations(results, options).then(results => {
        let result = Object.assign({}, results[0]);

        return Immutable.fromJS(result);
      });
    });
  }

  /**
   * Execute the query and return all results
   * @param {Object} options 
   * @returns {Promise}
   */
  all(options) {
    let query = this.query().clone();

    if (options && options.transaction) {
      query = query.transacting(options.transaction);
    }

    return query.then(results => {
      results = results.map(r => Object.assign({}, r));

      return this._includeRelations(results, options).then(results => {
        return Immutable.fromJS(results);
      });
    });
  }

  /**
   * Execute a delete query
   * @param {Object} options 
   */
  delete(options) {
    let query = this.query().clone();

    if (options && options.transaction) {
      query = query.transacting(options.transaction);
    }

    return query.del();
  }

  /**
   * Limit the number of results returned
   * @param {number} n 
   * @param {number} perPage 
   * @returns {Model}
   */
  page(n, perPage) {
    if (typeof perPage === 'undefined') perPage = 20;

    let query = this.query()
      .clone()
      .limit(perPage);

    if (typeof perPage !== 'undefined') {
      query = query.offset((n - 1) * perPage);
    }

    return this._chain(query);
  }

  /**
   * Order the results of a query
   * @param {string} fieldOrRaw
   * @param {string?} direction
   * @returns {Model}
   */
  order() {
    const args = Array.from(arguments);
    let query = this.query().clone();

    if (args.length == 1) {
      query = query.orderByRaw(args[0]);
    } else {
      query = query.orderBy(args[0], args[1]);
    }

    return this._chain(query);
  }

  /**
   * Convert an instance or collection to JSON
   * @param {*} instance_or_list 
   * @param {*} context 
   * @returns {Object}
   */
  json(instance_or_list, context) {
    if (typeof context === 'undefined') context = 'default';

    // If a List is given then map over the items
    if (instance_or_list instanceof Immutable.List || instance_or_list instanceof Array) {
      const list = instance_or_list.map(instance => this.json(instance, context));
      return list.toJS ? list.toJS() : list;
    }

    // If a normal map is given
    let instance = instance_or_list;

    // Map the instance depending on the given context

    // Given a literal function as the context
    if (context instanceof Function) {
      instance = context(instance);
    } else {
      const context_mapper = this.contexts[context];

      // The context defined on the model is a function
      if (context_mapper instanceof Function) {
        instance = context_mapper(instance);

        // The context defined on the model is a list of fields
      } else if (context_mapper instanceof Array) {
        if (context_mapper.length > 0 && context_mapper[0] !== '*') {
          // Add any requested fields to the new contextualised object
          let newInstance = Immutable.Map();
          context_mapper.forEach(key => {
            if (!instance.has(key)) return;

            // If its a relation check to see if the relation has the same context
            if (Object.keys(this._availableRelations).includes(key)) {
              const RelatedModel = this.klein.model(this._availableRelations[key].table);
              newInstance = newInstance.set(key, RelatedModel.json(instance.get(key), context));

              // Just add normal fields
            } else {
              newInstance = newInstance.set(key, instance.get(key));
            }
          });
          instance = newInstance;
        }
      }
    }

    return instance.toJS ? instance.toJS() : instance;
  }

  /**
   * Get the current query as a string
   * @returns {string}
   */
  toString() {
    return this.query().toString();
  }

  // INTERNAL HELPERS

  /**
   * Clone the Model with an updated query
   * @param {Object} query 
   * @returns {Model}
   */
  _chain(query) {
    const args = Object.assign({}, this.args, {
      defaultScope: query
    });

    return new Model(this.tableName, args);
  }

  /**
   * Create a clone of an Immutable Map or JSON Object as a JSON Object with stringified JSON fields
   * @param {Immutable.Map|Object} model 
   * @returns {Object}
   */
  _serialize(model) {
    let properties = model.toJS ? model.toJS() : Object.assign({}, model);

    // Merge with default properties
    if (typeof properties.id === 'undefined' && typeof this.defaults.id !== 'undefined') {
      properties.id = this.defaults.id(properties);
    }

    let defaultValue;
    Object.keys(this.defaults).forEach(key => {
      if (key !== 'id' && typeof this.defaults[key] !== 'undefined') {
        defaultValue = this.defaults[key];
        if (typeof properties[key] === 'undefined') {
          properties[key] = typeof defaultValue === 'function' ? defaultValue(properties) : defaultValue;
        }
      }
    });

    // Convert any json properties to stringified json
    Object.keys(properties).forEach(key => {
      if (typeof properties[key] === 'object') {
        properties[key] = JSON.stringify(properties[key]);
      }

      // Also set any 'null' strings to actual null
      if (properties[key] === 'null') {
        properties[key] = null;
      }
    });

    return properties;
  }

  /**
   * Save any relations on a model
   * @param {Immutable.Map|Object} model The model that has relations
   * @param {Object} options 
   * @returns {Object} The serialized model
   */
  async _saveRelations(model, options) {
    let properties = model.toJS ? model.toJS() : model;

    const propertiesThatAreRelations = Object.keys(properties).filter(p =>
      Object.keys(this._availableRelations).includes(p)
    );

    let savedRelations = await Promise.all(
      propertiesThatAreRelations.map(propertyName => {
        const relation = this._availableRelations[propertyName];
        const propertyValue = properties[propertyName];

        // If there is no relation with that name then throw an error
        if (typeof relation == 'undefined') return rejectProperty(new Error(`'${propertyName}' is not a relation`));

        // check the relation type to see what else needs to be created/saved
        switch (relation.type) {
          case 'hasMany':
            return this._saveHasManyRelation(model, relation, propertyValue, options);
          case 'belongsTo':
            return this._saveBelongsToRelation(model, relation, propertyValue, options);
          case 'hasAndBelongsToMany':
            return this._saveHasAndBelongsToManyRelation(model, relation, propertyValue, options);

          default:
            return null;
        }
      })
    );

    // Swap the properties that were saved with their new saved versions
    savedRelations.forEach(savedRelation => {
      if (!savedRelation) return;
      properties[savedRelation.name] = savedRelation.value;

      if (savedRelation.belongsToKey) {
        properties[savedRelation.belongsToKey] = savedRelation.belongsToValue;
      }
    });

    return properties;
  }

  /**
   * Save a hasMany relation
   * @param {Immutable.Map|Object} model The model that has the relation
   * @param {Object} relation The relation information
   * @param {Array} relatedObjects The actual related objects
   * @param {Object} options 
   */
  async _saveHasManyRelation(model, relation, relatedObjects, options) {
    model = model.toJS ? model.toJS() : model;

    // Get or make a Klein Model for the related table
    const RelatedModel = this.klein.model(relation.table);

    // find any objects that have already been persisted
    let newRelatedObjectsIds = relatedObjects.map(r => r.id).filter(id => id && typeof id !== 'undefined');

    // Unset any objects that have this model as their relation id
    await this.knex(relation.table, options)
      .where(relation.key, model.id)
      .whereNotIn('id', newRelatedObjectsIds)
      .update({ [relation.key]: null });

    // Find any related objects that are already in the database
    let existingRelatedObjectIds = await this.knex(relation.table, options)
      .select('id')
      .whereIn('id', newRelatedObjectsIds);

    const savedRelatedObjects = await Promise.all(
      relatedObjects.map(relatedObject => {
        relatedObject[relation.key] = model.id;
        // save/update the related object (which will then in turn save any relations on itself)
        return RelatedModel.save(
          relatedObject,
          Object.assign({}, options, {
            exists: newRelatedObjectsIds.includes(relatedObject.id)
          })
        );
      })
    );

    return {
      name: relation.name,
      value: savedRelatedObjects
    };
  }

  /**
   * Save a belongsTo relation
   * @param {Immutable.Map|Object} model The model with relation
   * @param {Object} relation The relationship information
   * @param {Object} relatedObject The actual related object
   * @param {Object} options eg. options.transaction
   */
  async _saveBelongsToRelation(model, relation, relatedObject, options) {
    model = model.toJS ? model.toJS() : model;

    const RelatedModel = this.klein.model(relation.table);
    const object = await RelatedModel.save(relatedObject);

    await this.knex(this.tableName, options)
      .where({ id: model.id })
      .update({ [relation.key]: object.get('id') });

    return {
      name: relation.name,
      value: object,
      // Return with the information to update the current model
      belongsToKey: relation.key,
      belongsToValue: object.get('id')
    };
  }

  /**
   * Save a hasAndBelongsToMany relationship on this model
   * @param {Immutable.Map|Object} model The model with relations
   * @param {Object} relation The relation information
   * @param {Array} relatedObjects The actual related objects
   * @param {Object} options eg. options.transaction
   */
  async _saveHasAndBelongsToManyRelation(model, relation, relatedObjects, options) {
    model = model.toJS ? model.toJS() : model;

    const RelatedModel = this.klein.model(relation.table);

    // eg. Users.save(user) where user.has('projects')
    // relation_ids would be project_ids
    let newRelationIds = relatedObjects.map(r => r.id).filter(id => id && typeof id !== 'undefined');
    // Find any join rows that already exist so that we don't create them again
    // eg. projects_users records for this user
    const existingRelatedObjectIds = (await this.knex(relation.throughTable, options)
      .select(relation.key)
      .where(relation.sourceKey, model.id)).map(r => r[relation.key]);

    // Delete any join rows that have been removed
    // eg. remove any projects_users the are no long attached to the user
    await this.knex(relation.throughTable, options)
      .where(relation.sourceKey, model.id)
      .whereNotIn(relation.key, newRelationIds)
      .del();

    // Work out which related rows already exist
    // eg. which projects already exist
    const existingRelatedIds = (await this.knex(relation.table, options)
      .select('id')
      .whereIn('id', newRelationIds)).map(r => r.id);

    // For each related thing create it if it doesn't exist and create a join record if it doesn't exist
    // eg. for each project, create it if it doesn't exist and create a projects_users for it if that doesn't exist
    const savedRelatedObjects = await Promise.all(
      relatedObjects.map(async relatedObject => {
        // create the relatedObject first so that we have an id for the join row
        const relatedModel = await RelatedModel.save(
          relatedObject,
          Object.assign({}, options, {
            exists: existingRelatedIds.includes(relatedObject.id)
          })
        );

        // See if we need to insert a new join row
        if (!existingRelatedObjectIds.includes(relatedModel.get('id'))) {
          const newJoinRow = {
            id: uuid(),
            [relation.key]: relatedModel.get('id'),
            [relation.sourceKey]: model.id
          };
          this._updateTimestamp(newJoinRow, 'updatedAt');
          this._updateTimestamp(newJoinRow, 'created_at');
          await this.knex(relation.throughTable, options).insert(newJoinRow, 'id');
        }

        return relatedObject;
      })
    );

    return {
      name: relation.name,
      value: savedRelatedObjects
    };
  }

  /**
   * For each relation requested via `.include` find the related rows and attach them to the matching Model rows
   * @param {Array} results The results from a Knex query
   * @param {Object} options eg. options.transaction
   */
  async _includeRelations(results, options) {
    if (results.length == 0) return Promise.resolve(results);
    if (this._includedRelations.length == 0) return Promise.resolve(results);

    let ids = results.map(r => r.id);
    const relations = await Promise.all(
      this._includedRelations.map(async relationName => {
        const relation = this._availableRelations[relationName];

        // If there is no relation with that name then throw an error
        if (typeof relation == 'undefined') throw new Error(`'${relationName}' is not a relation`);

        if (relation.type === 'hasMany') {
          // eg.
          // Department has many Users
          const relatedRows = (await this.knex(relation.table, options)
            .select('*')
            .whereIn(relation.key, ids)).map(r => Object.assign({}, r));
          return { name: relationName, properties: relation, rows: relatedRows };
        } else if (relation.type === 'hasAndBelongsToMany') {
          // eg.
          // User has many Projects (through users_projects)
          // Project has many Users (through users_projects)
          let throughIds = await this.knex(relation.throughTable, options)
            .select(relation.sourceKey, relation.key)
            .whereIn(relation.sourceKey, ids);
          let joins = throughIds.map(r => Object.assign({}, r));
          throughIds = throughIds.map(r => r[relation.key]);
          const relatedRows = (await this.knex(relation.table, options)
            .select('*')
            .whereIn('id', throughIds)).map(r => Object.assign({}, r));
          return {
            name: relationName,
            properties: relation,
            joins: joins,
            rows: relatedRows
          };
        } else if (relation.type === 'one') {
          // Not sure when this would ever be used
          const relatedRows = (await this.knex(relation.table, options)
            .select('*')
            .whereIn(relation.key, ids)
            .limit(1)).map(r => Object.assign({}, r));
          return { name: relationName, properties: relation, rows: relatedRows };
        } else if (relation.type === 'belongsTo') {
          // eg.
          // User belongs to Department
          // Project belongs to User (eg. created_by_user_id)
          const relationIds = results.map(r => r[relation.key]);
          const relatedRows = (await this.knex(relation.table, options)
            .select('*')
            .whereIn('id', relationIds)).map(r => Object.assign({}, r));
          return { name: relationName, properties: relation, rows: relatedRows };
        } else {
          // No matching type?
          return { name: relationName, properties: relation, rows: [] };
        }
      })
    );

    // Graft the relations onto the matching results
    return results.map(result => {
      relations.forEach(relation => {
        switch (relation.properties.type) {
          case 'belongsTo':
            result[relation.name] = relation.rows.find(r => r.id === result[relation.properties.key]);
            break;

          case 'hasMany':
            result[relation.name] = relation.rows.filter(r => r[relation.properties.key] === result.id);
            break;

          case 'hasAndBelongsToMany':
            // Make a list of rows that match up with the result
            const joinIds = relation.joins
              ? relation.joins
                  .filter(j => j[relation.properties.sourceKey] == result.id)
                  .map(j => j[relation.properties.key])
              : [];
            result[relation.name] = relation.rows.filter(r => joinIds.includes(r.id));
            break;
        }
      });
      return result;
    });
  }

  /**
   * Update the timestamps 
   * @param {Object} properties 
   * @param {String} field 
   */
  _updateTimestamp(properties, field) {
    if (this.timestampFields[field]) {
      properties[this.timestampFields[field]] = new Date();
    }
  }
}

module.exports = Model;
