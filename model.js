const Immutable = require('immutable');
const Inflect = require('i')();
const uuid = require('uuid/v4');


class Model {
    constructor (table_name, args) {
        this.table_name = table_name;
        this.klein = args.klein;
        this.args = args;
        
        // `timestamps` can be either a hash of { created_at, updated_at } or false
        const timestamps = (args.timestamps === false ? { created_at: false, updated_at: false } : args.timestamps);
        this.timestamp_fields = Object.assign({}, {
            created_at: 'created_at',
            updated_at: 'updated_at'
        }, timestamps);
        
        this.defaults = Object.assign({}, {
            id: this.klein.uuid
        }, args.defaults);
        this.contexts = args.contexts || {};
        
        this._available_relations = args._available_relations || {};
        this._included_relations = args._included_relations || [];
        this.relations = args.relations || {}
        Object.keys(this.relations).forEach(relation_name => {
            let relation = this.relations[relation_name];
            
            relation.name = relation_name;
            
            if (relation.has_and_belongs_to_many) {
                relation.many = true;
                relation.type = 'has_and_belongs_to_many';
                // through table name will generally be a combination of the two tables (alpha sorted) joined by a '_'
                relation.through_table = relation.through || [this.table_name, Inflect.pluralize(relation_name)].sort().join('_');
                relation.table = relation.table || Inflect.pluralize(relation_name);
                relation.source_key = relation.primary_key || `${Inflect.singularize(this.table_name)}_id`;
                relation.key = relation.foreign_key || `${Inflect.singularize(relation_name)}_id`;
                relation.dependent = false;
            } else if (relation.belongs_to) {
                relation.many = false;
                relation.type = 'belongs_to';
                relation.table = relation.table || Inflect.pluralize(relation.belongs_to);
                relation.key = relation.foreign_key || `${Inflect.singularize(relation_name)}_id`;
                relation.dependent = false;
            } else if (relation.has_many) {
                relation.many = true;
                relation.type = 'has_many';
                relation.table = relation.table || Inflect.pluralize(relation.has_many);
                relation.key = relation.foreign_key || `${Inflect.singularize(this.table_name)}_id`;
                relation.dependent = (relation.dependent === true);
            }
            
            this._available_relations[relation_name] = relation;
        });
    }
    
    knex (table, options) {
        if (!this.has_knex()) throw new Error('Klein must be connected (klein.connect()) before a model has access to Knex')

        if (options && options.transaction) {
            return this._knex(table).transacting(options.transaction);
        } else {
            return this._knex(table);
        }
    }

    has_knex () {
        return this.klein && this.klein.knex
    }

    query() {
        if (!this.has_knex()) throw new Error('Klein must be connected (klein.connect()) before querying a model')
        
        if (this.args.default_scope) {
            return this.args.default_scope;
        } else {
            return this.knex(this.table_name).select();
        }
    }
    
    create (properties, options) {
        if (typeof options === "undefined") options = {};
        options.exists = false;
        
        // If given an array it should return a List
        const is_array = (properties instanceof Array || properties instanceof Immutable.List);
        
        if (is_array) {
            return Promise.all(properties.map(object_properties => {
                return this.save(object_properties, options);
            })).then(instances => {
                return Immutable.List(instances);
            });
            
        } else {
            return Promise.resolve(this.save(properties, options));
        }
    }
    
    
    destroy (model, options) {
        if (!this.has_knex()) throw new Error('Klein must be connected (klein.connect()) before destroying a model')

        return new Promise((resolve, reject) => {
            this.knex(this.table_name).where({ id: model.get('id') }).del().then(() => {
                // Check over dependent has_many (and has_and_belongs_to_many join) relations
                const dependent_relations = Object.keys(this._available_relations).map(k => this._available_relations[k]).filter(r => r.dependent || r.type == 'has_and_belongs_to_many');
                
                if (dependent_relations.length == 0) return resolve(model);
                
                Promise.all(dependent_relations.map(dependent_relation => {
                    // if has_and_belongs_to_many then remove rows from the join table
                    const table = (dependent_relation.type == 'has_and_belongs_to_many') ? dependent_relation.through_table : dependent_relation.table;
                    const key = (dependent_relation.type == 'has_and_belongs_to_many') ? dependent_relation.source_key : dependent_relation.key;
                    
                    return this.knex(table, options).where(key, model.get('id')).del();
                })).then(() => {
                    resolve(model);
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    save (model, options) {
        if (!this.has_knex()) throw new Error('Klein must be connected (klein.connect()) before saving a model')

        if (typeof options === "undefined") options = {};
        
        let properties = model.toJS ? model.toJS() : Object.assign({}, model);
        
        // Detach relations because they can't be saved against this record
        let relations = {};
        Object.keys(properties).forEach(property_name => {
            if (Object.keys(this._available_relations).includes(property_name)) {
                relations[property_name] = properties[property_name];
                delete properties[property_name];
            }
        });
        
        // Convert everything to something we can put into the database
        properties = this._serialize(properties);
        this._updateTimestamp(properties, 'updated_at');
        
        return Promise.resolve().then(() => {
            // Check to see if this model has been persisted
            if (options.exists === true) {
                return true;
            } else if (options.exists === false) {
                return false;
            } else {
                return this.knex(this.table_name, options).where({ id: properties.id || null }).then(rows => {
                    return (rows.length > 0);
                });
            }
        }).then(exists => {
            // Save or create the model
            if (exists) {
                return this.knex(this.table_name, options).where({ id: properties.id }).update(properties, '*');
            } else {
                this._updateTimestamp(properties, 'created_at');
                return this.knex(this.table_name, options).insert(properties, '*');
            }
        }).then(results => {
            let object = Object.assign({}, results[0]);
            
            // Reattach any relations that were on the model before
            Object.keys(relations).forEach(property_name => {
                object[property_name] = relations[property_name];
            });
            
            return this._saveRelations(object, options);
            
        }).then(object => {
            
            return Immutable.fromJS(object);
                
        });
    }
    
    
    find (id, options) {
        return this.where({ id: id }).first(options);
    }
    
    
    reload (model, options) {
        return this.where({ id: model.get('id') }).first(options);
    }
    
    
    where () {
        const args = Array.from(arguments);
        let query = this.query().clone();
        
        if (args.length == 1) {
            query = query.where(args[0]);
        } else {
            query = query.where(args[0], args[1], args[2]);
        }
        
        return this._chain(query);
    }
    
    
    whereIn (column, array) {
        let query = this.query().clone().whereIn(column, array);
        return this._chain(query);
    }
    
    
    whereNotIn (column, array) {
        let query = this.query().clone().whereNotIn(column, array);
        return this._chain(query);
    }
    
    
    whereNull (column) {
        let query = this.query().clone().whereNull(column);
        return this._chain(query);
    }
    
    
    whereNotNull (column) {
        let query = this.query().clone().whereNotNull(column);
        return this._chain(query);
    }
    
    
    include () {
        this.args._included_relations = Array.from(arguments);
        return this._chain(this.query().clone());
    }
    
    
    first (options) {
        let query = this.query().clone();
        
        if (options && options.transaction) {
            query = query.transacting(options.transaction);
        }
        
        return query.then(results => {
            if (results.length == 0) return null;
            
            return this._includeRelations(results, options).then(results => {
                let result = Object.assign({}, results[0]);
                
                return Immutable.fromJS(result);
            });
        });
    }
    
    
    all (options) {
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
    
    
    delete (options) {
        let query = this.query().clone();
        
        if (options && options.transaction) {
            query = query.transacting(options.transaction);
        }
        
        return query.del();
    }
    
    
    page (n, per_page) {
        if (typeof per_page === "undefined") per_page = 20;
        
        let query = this.query().clone().limit(per_page);
        
        if (typeof per_page !== "undefined") {
            query = query.offset((n - 1) * per_page);
        }
        
        return this._chain(query);
    }
    
    
    order () {
        const args = Array.from(arguments);
        let query = this.query().clone();
        
        if (args.length == 1) {
            query = query.orderByRaw(args[0]);
        } else {
            query = query.orderBy(args[0], args[1]);
        }
        
        return this._chain(query);
    }
    
    
    json (instance_or_list, context) {
        if (typeof context === "undefined") context = 'default';
        
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
                    let new_instance = Immutable.Map();
                    context_mapper.forEach(key => {
                        if (!instance.has(key)) return;
                        
                        // If its a relation check to see if the relation has the same context
                        if (Object.keys(this._available_relations).includes(key)) {
                            const RelatedModel = this.klein.model(this._available_relations[key].table);
                            new_instance = new_instance.set(key, RelatedModel.json(instance.get(key), context));
                            
                        // Just add normal fields
                        } else {
                            new_instance = new_instance.set(key, instance.get(key));
                        }
                    });
                    instance = new_instance;
                }
            }
        }
        
        return instance.toJS ? instance.toJS() : instance;
    }
    
    
    toString () {
        return this.query().toString();
    }
    
    
    // INTERNAL HELPERS
    
    /*
        Clone the Model with an updated query.
    */
    _chain (query) {
        const args = Object.assign({}, this.args, {
            default_scope: query
        });
        
        return new Model(this.table_name, args);
    }
    
    
    /*
        Create a clone of an Immutable Map or JSON Object as a JSON Object with stringified JSON fields
    */
    _serialize (model) {
        let properties = model.toJS ? model.toJS() : Object.assign({}, model);
        
        // Merge with default properties
        if (typeof properties.id === "undefined" && typeof this.defaults.id !== "undefined") {
            properties.id = this.defaults.id(properties);
        }
        
        let default_value;
        Object.keys(this.defaults).forEach(key => {
            if (key !== 'id' && typeof this.defaults[key] !== "undefined") {
                default_value = this.defaults[key];
                if (typeof properties[key] === "undefined") {
                    properties[key] = (typeof default_value === "function") ? default_value(properties) : default_value;
                }
            }
        });
        
        // Convert any json properties to stringified json
        Object.keys(properties).forEach(key => {
            if (typeof properties[key] === "object") {
                properties[key] = JSON.stringify(properties[key]);
            }
            
            // Also set any 'null' strings to actual null
            if (properties[key] === "null") {
                properties[key] = null;
            }
        });
        
        return properties;
    }
    
    
    _saveRelations (model, options) {
        let properties = model.toJS ? model.toJS() : model;
        
        const properties_that_are_relations = Object.keys(properties).filter(p => Object.keys(this._available_relations).includes(p));
        return Promise.all(properties_that_are_relations.map(property_name => {
            const relation = this._available_relations[property_name];
            const property_value = properties[property_name];
            
            // If there is no relation with that name then throw an error
            if (typeof relation == "undefined") return rejectProperty(new Error(`'${property_name}' is not a relation`));
            
            // check the relation type to see what else needs to be created/saved
            switch (relation.type) {
                case 'has_many': return this._saveHasManyRelation(model, relation, property_value, options);
                case 'belongs_to': return this._saveBelongsToRelation(model, relation, property_value, options);
                case 'has_and_belongs_to_many': return this._saveHasAndBelongsToManyRelation(model, relation, property_value, options);
                
                default: return null;
            }
        })).then(saved_relations => {
            // Swap the properties that were saved with their new saved versions
            saved_relations.forEach(saved_relation => {
                if (!saved_relation) return;
                properties[saved_relation.name] = saved_relation.value;
                
                if (saved_relation.belongs_to_key) {
                    properties[saved_relation.belongs_to_key] = saved_relation.belongs_to_value;
                }
            });
            
            return properties;
        });
    }
    
    
    _saveHasManyRelation (model, relation, related_objects, options) {
        model = model.toJS ? model.toJS() : model;
        
        // Get or make a Klein Model for the related table
        const RelatedModel = this.klein.model(relation.table);
        
        // find any objects that have already been persisted
        let new_related_objects_ids = related_objects.map(r => r.id).filter(id => id && typeof id !== "undefined");
        
        // Unset any objects that have this model as their relation id
        return this.knex(relation.table, options).where(relation.key, model.id).whereNotIn('id', new_related_objects_ids).update({ [relation.key]: null }).then(() => {
            // Find any related objects that are already in the database
            return this.knex(relation.table, options).select('id').whereIn('id', new_related_objects_ids).then(existing_related_ids => {
                return Promise.all(related_objects.map(related_object => {
                    related_object[relation.key] = model.id;
                    // save/update the related object (which will then in turn save any relations on itself)
                    return RelatedModel.save(related_object, Object.assign({}, options, { exists: new_related_objects_ids.includes(related_object.id) }));

                })).then(saved_related_objects => {
                    return {
                        name: relation.name,
                        value: saved_related_objects
                    };
                });
            });
        });
    }
    
    
    _saveBelongsToRelation (model, relation, related_object, options) {
        model = model.toJS ? model.toJS() : model;
        
        const RelatedModel = this.klein.model(relation.table);
        return RelatedModel.save(related_object).then(object => {
            return this.knex(this.table_name, options).where({ id: model.id }).update({ [relation.key]: object.get('id') }).then(() => {
                return {
                    name: relation.name,
                    value: object,
                    // Return with the information to update the current model
                    belongs_to_key: relation.key,
                    belongs_to_value: object.get('id')
                };
            });
        });
    }
    
    
    _saveHasAndBelongsToManyRelation (model, relation, related_objects, options) {
        model = model.toJS ? model.toJS() : model;
        
        const RelatedModel = this.klein.model(relation.table);
        
        // eg. Users.save(user) where user.has('projects')
        // relation_ids would be project_ids
        let new_relation_ids = related_objects.map(r => r.id).filter(id => id && typeof id !== "undefined");
        // Find any join rows that already exist so that we don't create them again
        // eg. projects_users records for this user
        return this.knex(relation.through_table, options).select(relation.key).where(relation.source_key, model.id).then(existing_related_object_ids => {
            existing_related_object_ids = existing_related_object_ids.map(r => r[relation.key]);
            // Delete any join rows that have been removed
            // eg. remove any projects_users the are no long attached to the user
            return this.knex(relation.through_table, options).where(relation.source_key, model.id).whereNotIn(relation.key, new_relation_ids).del().then(() => {
                // Work out which related rows already exist
                // eg. which projects already exist
                return this.knex(relation.table, options).select('id').whereIn('id', new_relation_ids).then(existing_related_ids => {
                    existing_related_ids = existing_related_ids.map(r => r.id);
                    
                    // For each related thing create it if it doesn't exist and create a join record if it doesn't exist
                    // eg. for each project, create it if it doesn't exist and create a projects_users for it if that doesn't exist
                    return Promise.all(related_objects.map(related_object => {
                        // create the related_object first so that we have an id for the join row
                        return RelatedModel.save(related_object, Object.assign({}, options, { exists: existing_related_ids.includes(related_object.id) })).then(related_model => {
                            if (existing_related_object_ids.includes(related_model.get('id'))) {
                                return related_model;
                            } else {
                                const new_join_row = {
                                    id: uuid(),
                                    [relation.key]: related_model.get('id'),
                                    [relation.source_key]: model.id
                                }
                                
                                this._updateTimestamp(new_join_row, 'updated_at');
                                this._updateTimestamp(new_join_row, 'created_at');
                                
                                return this.knex(relation.through_table, options).insert(new_join_row, 'id').then(() => {
                                    return related_model;
                                });
                            }
                        }).then(related_object => {
                            return related_object;
                        });
                    })).then(saved_related_objects => {
                        return {
                            name: relation.name,
                            value: saved_related_objects
                        };
                    });
                });
            });
        });
    }
    
    
    /*
        For each relation requested via `.include` find the related rows and attach them
        to the matching Model rows
    */
    _includeRelations (results, options) {
        if (results.length == 0) return Promise.resolve(results);
        if (this._included_relations.length == 0) return Promise.resolve(results);
        
        let ids = results.map(r => r.id);
        return Promise.all(this._included_relations.map(relation_name => {
            const relation = this._available_relations[relation_name];
            
            // If there is no relation with that name then throw an error
            if (typeof relation == "undefined") return reject(new Error(`'${relation_name}' is not a relation`));
            
            if (relation.type === 'has_many') {
                /*
                    eg.
                        Department has many Users
                */
                return this.knex(relation.table, options).select('*').whereIn(relation.key, ids).then(related_rows => {
                    related_rows = related_rows.map(r => Object.assign({}, r));
                    return { name: relation_name, properties: relation, rows: related_rows };
                });
                
            } else if (relation.type === 'has_and_belongs_to_many') {
                /*
                    eg.
                        User has many Projects (through users_projects)
                        Project has many Users (through users_projects)
                */
                return this.knex(relation.through_table, options).select(relation.source_key, relation.key).whereIn(relation.source_key, ids).then(through_ids => {
                    let joins = through_ids.map(r => Object.assign({}, r));
                    through_ids = through_ids.map(r => r[relation.key]);
                    return this.knex(relation.table, options).select('*').whereIn('id', through_ids).then(related_rows => {
                        related_rows = related_rows.map(r => Object.assign({}, r));
                        return { name: relation_name, properties: relation, joins: joins, rows: related_rows };
                    });
                });
                
            } else if (relation.type === 'one') {
                // Not sure when this would ever be used
                return this.knex(relation.table, options).select('*').whereIn(relation.key, ids).limit(1).then(related_rows => {
                    related_rows = related_rows.map(r => Object.assign({}, r));
                    return { name: relation_name, properties: relation, rows: related_rows };
                });
                
            } else if (relation.type === 'belongs_to') {
                /*
                    eg.
                        User belongs to Department
                        Project belongs to User (eg. created_by_user_id)
                */
                let relation_ids = results.map(r => r[relation.key]);
                return this.knex(relation.table, options).select('*').whereIn('id', relation_ids).then(related_rows => {
                    related_rows = related_rows.map(r => Object.assign({}, r));
                    return { name: relation_name, properties: relation, rows: related_rows };
                });
                
            } else {
                // No matching type?
                return { name: relation_name, properties: relation, rows: [] };
            }
            
        })).then(relations => {
            // Graft the relations onto the matching results
            results = results.map(result => {
                relations.forEach(relation => {
                    switch (relation.properties.type) {
                        case 'belongs_to':
                            result[relation.name] = relation.rows.find(r => r.id === result[relation.properties.key]);
                        break;
                        
                        case 'has_many':
                            result[relation.name] = relation.rows.filter(r => r[relation.properties.key] === result.id);
                        break;
                        
                        case 'has_and_belongs_to_many':
                            // Make a list of rows that match up with the result
                            const join_ids = relation.joins ? relation.joins.filter(j => j[relation.properties.source_key] == result.id).map(j => j[relation.properties.key]) : [];
                            result[relation.name] = relation.rows.filter(r => join_ids.includes(r.id));
                        break;
                    }
                });
                return result;
            });
            
            return results;
        });
    }
    
    
    _updateTimestamp (properties, field) {
        if (this.timestamp_fields[field]) {
            properties[this.timestamp_fields[field]] = new Date();
        }
    }
}


module.exports = Model;
