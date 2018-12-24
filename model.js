const Immutable = require('immutable');
const Inflect = require('i')();
const uuid = require('uuid/v4');
const _isPlainObject = require('lodash.isplainobject');

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

    this.hooks = args.hooks || {};
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
      } else if (relation.hasOne) {
        relation.many = false;
        relation.type = 'hasOne';
        relation.table = relation.table || Inflect.pluralize(relation.hasOne);
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
   * Get the schema for the related table (lazy loaded and cached)
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
   * @param {Object?} options 
   * @returns {Immutable.Map} The now non-persisted record
   */
  async destroy(model, options) {
    if (!this.hasConnection()) throw new Error('Klein must be connected before destroying a model');

    // Run the hook if there is one
    const shouldDestroy = await this._hook('beforeDestroy', model);
    if (shouldDestroy === false) return model;

    await this.knex(this.tableName)
      .where({ id: model.get('id') })
      .del();

    // Check over dependent hasMany (and hasAndBelongsToMany join) relations
    const dependentRelations = Object.keys(this._availableRelations)
      .map(k => this._availableRelations[k])
      .filter(r => r.dependent || r.type == 'hasAndBelongsToMany');

    if (dependentRelations.length > 0) {
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
    }

    this._hook('afterDestroy', model);

    return model;
  }

  /**
   * Persist a record
   * @param {Immutable.Map|Object} model The object or Immutable.Map to persist
   * @param {Object?} options 
   * @returns {Immutable.Map}
   */
  async save(model, options) {
    if (!this.hasConnection()) throw new Error('Klein must be connected before saving a model');

    if (typeof options === 'undefined') options = {};

    let properties = Object.assign({}, this._serialize(model));

    // Detach relations because they can't be saved against this record
    let relations = {};
    Object.keys(properties).forEach(propertyName => {
      if (Object.keys(this._availableRelations).includes(propertyName)) {
        relations[propertyName] = properties[propertyName];
        delete properties[propertyName];
      }
    });

    // Convert everything to something we can put into the database
    properties = this._prepareFields(properties);
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

    // Run any applicable hooks
    if (!exists) {
      properties = await this._hook('beforeCreate', properties);
    }
    properties = await this._hook('beforeSave', properties, exists);

    // Strip any uknown fields
    const fields = Object.keys(await this.schema());
    Object.keys(properties).forEach(p => {
      if (!fields.includes(p)) {
        delete properties[p];
      }
    });

    // Save or create the model
    let results;
    if (exists) {
      results = await this.knex(this.tableName, options)
        .where({ id: properties.id })
        .update(properties, '*');
    } else {
      this._updateTimestamp(properties, 'createdAt');
      results = await this.knex(this.tableName, options).insert(properties, '*');
    }

    let object = Object.assign({}, results[0]);

    // Reattach any relations that were on the model before
    Object.keys(relations).forEach(propertyName => {
      object[propertyName] = relations[propertyName];
    });
    object = await this._saveRelations(object, options);

    this._hook('afterSave', object, exists);
    if (!exists) {
      this._hook('afterCreate', object);
    }

    return this._factory(object);
  }

  /**
   * Find a record by its ID
   * @param {String} id A UUID
   * @param {Object?} options 
   * @returns {Immutable.Map}
   */
  find(id, options) {
    return this.where({ id: id }).first(options);
  }

  /**
   * 
   * @param {Immutable.Map} model 
   * @param {Object?} options 
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
   * @param {String} column The column to match against
   * @param {String} values The values to match with the column
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
   * @param {String} column The column to match against
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
   * @param {String} column The column to match against
   */
  whereNull(column) {
    let query = this.query()
      .clone()
      .whereNull(column);
    return this._chain(query);
  }

  /**
   * Add a WHERE NOT NULL clause to the query
   * @param {String} column 
   */
  whereNotNull(column) {
    let query = this.query()
      .clone()
      .whereNotNull(column);
    return this._chain(query);
  }

  /**
   * Include related models
   */
  include() {
    this.args._includedRelations = Array.from(arguments);
    return this._chain(this.query().clone());
  }

  /**
   * Execute the query and return the first result
   * @param {Object} options 
   * @returns {Promise<Immutable.Map>}
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

        return this._factory(result);
      });
    });
  }

  /**
   * Execute the query and return all results
   * @param {Object} options 
   * @returns {Promise<Immutable.List>}
   */
  all(options) {
    let query = this.query().clone();

    if (options && options.transaction) {
      query = query.transacting(options.transaction);
    }

    return query.then(results => {
      results = results.map(r => Object.assign({}, r));

      return this._includeRelations(results, options).then(results => {
        return Immutable.List(results.map((r) => this._factory(r)));
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
   * @param {Imutable.Map|Immutable.List} instanceOrList 
   * @param {String|Function} context 
   * @returns {Object}
   */
  json(instanceOrList, context) {
    if (typeof context === 'undefined') context = 'default';

    // If a List is given then map over the items
    if (instanceOrList instanceof Immutable.List || instanceOrList instanceof Array) {
      const list = instanceOrList.map(instance => this.json(instance, context));
      return list.toJS ? list.toJS() : list;
    }

    // If a normal map is given
    let instance = instanceOrList;

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
   * Create instance of the model
   * @param {Object} properties
   * @returns {Model}
   */
  _factory(properties) {
    const immutable = Immutable.fromJS(properties);
    
    if (this.args.type && typeof this.args.type.factory === 'function') {
      return this.args.type.factory(immutable);
    } else {
      return immutable;
    }
  }

  /**
   * Serialize model to plain object
   * @param {Model|Object}
   * @return {Object}
   */
  _serialize(model) {
    if (!this._instanceOf(model)) return model;

    if (this.args.type && typeof this.args.type.serialize === 'function') {
      let result = this.args.type.serialize(model);
      if (!_isPlainObject(result)) {
        throw new Error(`serialize of '${this.tableName}' Klein.model must return a plain object`);
      }
      return result;
    } else {
      return model.toJS();
    }
  }

  /**
   * Determine whether the given object is considered an instance of the model
   * @param {Immutable.Map|Object}
   * @return {boolean}
   */
  _instanceOf(maybeModel) {
    if (this.args.type && typeof this.args.type.instanceOf === 'function') {
      return !!this.args.type.instanceOf(maybeModel);
    } else {
      return !!maybeModel.toJS;
    }
  }

  /**
   * Create a clone of an Immutable Map or JSON Object as a JSON Object with stringified JSON fields
   * @param {Immutable.Map|Object} model 
   * @returns {Object}
   */
  _prepareFields(model) {
    let properties = Object.assign({}, this._serialize(model))

    if (typeof properties.id === 'undefined') {
      if (typeof this.args.generateId === 'function') {
        properties.id = this.args.generateId(properties);
      } else {
        properties.id = uuid();
      }
    }

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
   * Run a hook
   * @param {String} hook The name of the hook to run
   * @param {Object} properties The current properties
   * @param {any} extraInfo An extra param to pass to the hook
   * @returns {Promise<Object>} The updated properties
   */
  async _hook(hook, properties, extraInfo) {
    const hookFn = this.hooks[hook];

    if (typeof hookFn !== 'function') return properties;

    // Convert to Immutable for the hook
    properties = await hookFn(this._instanceOf(properties) ? properties : this._factory(properties), extraInfo);

    // beforeCreate and beforeSave must return something
    if (typeof properties !== 'object' && ['beforeSave', 'beforeCreate'].includes(hook)) {
      throw new Error('beforeCreate and beforeSave hooks must return a model');
    }

    if (typeof properties === 'object') {
      // Convert back to raw to give back to the model
      return this._serialize(properties);
    }

    return true;
  }

  /**
   * Save any relations on a model
   * @param {Immutable.Map|Object} model The model that has relations
   * @param {Object} options 
   * @returns {Object} The serialized model
   */
  async _saveRelations(model, options) {
    let properties = this._serialize(model);

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
          case 'hasOne':
            return this._saveHasOneRelation(model, relation, propertyValue, options);

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
    model = this._serialize(model);

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
      .whereIn('id', newRelatedObjectsIds)
      .then((results) => results.map((result) => result.id));

    const savedRelatedObjects = await Promise.all(
      relatedObjects.map(relatedObject => {
        relatedObject[relation.key] = model.id;
        // save/update the related object (which will then in turn save any relations on itself)
        return RelatedModel.save(
          relatedObject,
          Object.assign({}, options, {
            exists: existingRelatedObjectIds.includes(relatedObject.id)
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
    model = this._serialize(model);

    var foreignValue;

    if (relatedObject) {
      let RelatedModel = this.klein.model(relation.table);
      foreignValue = await RelatedModel.save(relatedObject);
    } else {
      foreignValue = null;
    }

    await this.knex(this.tableName, options)
      .where({ id: model.id })
      .update({ [relation.key]: foreignValue && foreignValue.get('id') });

    return {
      name: relation.name,
      value: foreignValue,
      // Return with the information to update the current model
      belongsToKey: relation.key,
      belongsToValue: foreignValue && foreignValue.get('id')
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
    model = this._serialize(model);

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
          this._updateTimestamp(newJoinRow, 'createdAt');
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
   * Save a hasOne relation
   * @param {Immutable.Map|Object} model The model with relation
   * @param {Object} relation The relationship information
   * @param {Object} relatedObject The actual related object
   * @param {Object} options eg. options.transaction
   */
  async _saveHasOneRelation(model, relation, relatedObject, options) {
    model = this._serialize(model);

    // Get or make a Klein model for the related table
    const RelatedModel = this.klein.model(relation.table);

    // find any objects that have already been persisted
    let newRelatedObjectsIds = [relatedObject].map(r => r.id).filter(id => id && typeof id !== 'undefined');

    // Unset any objects that have this model as their relation id
    return this.knex(relation.table, options)
      .where(relation.key, model.id)
      .whereNotIn('id', newRelatedObjectsIds)
      .update({ [relation.key]: null })
      .then(() => {
        // Find any related objects that are already in the database
        return this.knex(relation.table, options)
          .select('id')
          .whereIn('id', newRelatedObjectsIds)
          .then(existingRelatedIds => {
            relatedObject[relation.key] = model.id;
            // save/update the related object (which will then in turn save any relations on itself)
            return RelatedModel.save(
              relatedObject,
              Object.assign({}, options, { exists: newRelatedObjectsIds.includes(relatedObject.id) })
            );
          })
          .then(savedRelatedObject => {
            return {
              name: relation.name,
              value: savedRelatedObject
            };
          });
      });
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
        const model = this.klein.model(relation.table)

        // If there is no relation with that name then throw an error
        if (typeof relation == 'undefined') throw new Error(`'${relationName}' is not a relation`);

        if (relation.type === 'hasMany') {
          // eg.
          // Department has many Users
          const relatedRows = (await this.knex(relation.table, options)
            .select('*')
            .whereIn(relation.key, ids)).map(r => Object.assign({}, r));
          return { name: relationName, properties: relation, rows: relatedRows, model: model };
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
            rows: relatedRows,
            model: model
          };
        } else if (relation.type === 'hasOne') {
          // Not sure when this would ever be used
          const relatedRows = await this.knex(relation.table, options)
            .select('*')
            .whereIn(relation.key, ids)
            .map(r => Object.assign({}, r));
          return { name: relationName, properties: relation, rows: relatedRows, model: model };
        } else if (relation.type === 'belongsTo') {
          // eg.
          // User belongs to Department
          // Project belongs to User (eg. created_by_user_id)
          const relationIds = results.map(r => r[relation.key]);
          const relatedRows = (await this.knex(relation.table, options)
            .select('*')
            .whereIn('id', relationIds)).map(r => Object.assign({}, r));
          return { name: relationName, properties: relation, rows: relatedRows, model: model };
        } else {
          // No matching type?
          return { name: relationName, properties: relation, rows: [], model: model };
        }
      })
    );

    // Graft the relations onto the matching results
    return results.map(result => {
      relations.forEach(relation => {
        switch (relation.properties.type) {
          case 'belongsTo':
            result[relation.name] = relation.model._factory(
              relation.rows.find(r => r.id === result[relation.properties.key])
            );
            break;

          case 'hasMany':
            result[relation.name] = relation.rows
              .filter(r => r[relation.properties.key] === result.id)
              .map(r => relation.model._factory(r))
            break;

          case 'hasOne':
            result[relation.name] = relation.model._factory(
              relation.rows.find(r => r[relation.properties.key] === result.id)
            );
            break;

          case 'hasAndBelongsToMany':
            // Make a list of rows that match up with the result
            const joinIds = relation.joins
              ? relation.joins
                  .filter(j => j[relation.properties.sourceKey] == result.id)
                  .map(j => j[relation.properties.key])
              : [];
            result[relation.name] = relation.rows
              .filter(r => joinIds.includes(r.id))
              .map(r => relation.model._factory(r));
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
