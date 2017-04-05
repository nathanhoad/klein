const Immutable = require('immutable');
const Inflect = require('i')();
const uuid = require('uuid/v4');


class Model {
    constructor (table_name, args) {
        this.table_name = table_name;
        this._knex = args.knex;
        this.klein = args.klein;
        this.args = args;
        
        if (args.default_scope) {
            this.query = args.default_scope;
        } else {
            this.query = this._knex(this.table_name).select();
        }
        
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
                // through table name will always be a combination of the two tables (alpha sorted) joined by a '_'
                relation.through_table = relation.through_table || [this.table_name, Inflect.pluralize(relation_name)].sort().join('_');
                relation.table = relation.table || Inflect.pluralize(relation_name);
                relation.source_key = relation.source_key || `${Inflect.singularize(this.table_name)}_id`;
                relation.key = relation.key || `${Inflect.singularize(relation_name)}_id`;
                relation.dependent = false;
            } else if (relation.belongs_to) {
                relation.many = false;
                relation.type = 'belongs_to';
                relation.table = relation.table || Inflect.pluralize(relation.belongs_to);
                relation.key = relation.key || `${Inflect.singularize(relation_name)}_id`;
                relation.dependent = false;
            } else if (relation.has_many) {
                relation.many = true;
                relation.type = 'has_many';
                relation.table = relation.table || Inflect.pluralize(relation.has_many);
                relation.key = relation.key || `${Inflect.singularize(this.table_name)}_id`;
                relation.dependent = (relation.dependent === true);
            }
            
            this._available_relations[relation_name] = relation;
        });
    }
    
    
    knex (table, options) {
        if (options && options.transaction) {
            return this._knex(table).transacting(options.transaction);
        } else {
            return this._knex(table);
        }
    }
    
    
    create (properties, options) {
        if (typeof options === "undefined") options = {};
        options.exists = false;
        
        return new Promise((resolve, reject) => {
            // If given an array it should return a List
            const is_array = (properties instanceof Array || properties instanceof Immutable.List);
            
            if (is_array) {
                Promise.all(properties.map(object_properties => {
                    return this.save(object_properties, options);
                })).then(created_objects => {
                    created_objects = created_objects.map(o => Object.assign({}, o));
                    return resolve(created_objects);
                    
                }).catch(err => {
                    reject(err);
                });
                
            } else {
                resolve(this.save(properties, options));
            }
        });
    }
    
    
    destroy (model, options) {
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
        if (typeof options === "undefined") options = {};
        
        return new Promise((resolve, reject) => {
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
            properties.updated_at = new Date();
            
            Promise.resolve().then(() => {
                // Check to see if this model has been persisted
                if (options.exists === true) {
                    return true;
                } else if (options.exists === false) {
                    return false;
                } else {
                    return this.knex(this.table_name, options).where({ id: properties.id || null }).then(rows => {
                        return (rows.length > 0);
                    }).catch(err => {
                        reject(err);
                    });
                }
            }).then(exists => {
                // Save or create the model
                if (exists) {
                    return this.knex(this.table_name, options).where({ id: properties.id }).update(properties, '*');
                } else {
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
                
                return resolve(Immutable.fromJS(object));
                    
            }).catch(err => {
                reject(err);
            });
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
        let query = this.query.clone();
        
        if (args.length == 1) {
            query = query.where(args[0]);
        } else {
            query = query.where(args[0], args[1], args[2]);
        }
        
        return this._chain(query);
    }
    
    
    include () {
        this.args._included_relations = Array.from(arguments);
        return this._chain(this.query.clone());
    }
    
    
    first (options) {
        return new Promise((resolve, reject) => {
            let query = this.query.clone();
            
            if (options && options.transaction) {
                query = query.transacting(options.transaction);
            }
            
            query.then(results => {
                if (results.length == 0) return resolve(null);
                
                this._includeRelations(results, options).then(results => {
                    let result = Object.assign({}, results[0]);
                    resolve(Immutable.fromJS(result));
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    all (options) {
        return new Promise((resolve, reject) => {
            let query = this.query.clone();
            
            if (options && options.transaction) {
                query = query.transacting(options.transaction);
            }
            
            query.then(results => {
                results = results.map(r => Object.assign({}, r));
                
                this._includeRelations(results, options).then(results => {
                    resolve(Immutable.fromJS(results));
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    page (n, per_page) {
        let query = this.query.clone().limit(n);
        
        if (typeof per_page !== "undefined") {
            query = query.offset(n * per_page);
        }
        
        return this._chain(query);
    }
    
    
    order () {
        const args = Array.from(arguments);
        let query = this.query.clone();
        
        if (args.length == 1) {
            query = query.orderByRaw(args[0]);
        } else {
            query = query.orderBy(args[0], args[1]);
        }
        
        return this._chain(query);
    }
    
    
    json (instance_or_list, context) {
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
        return this.query.toString();
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
    _serialize (model, is_persisted) {
        let properties = model.toJS ? model.toJS() : Object.assign({}, model);
        
        if (!properties.id) {
            properties.id = uuid();
        }
        
        if (!properties.updated_at) {
            properties.updated_at = new Date();
        }
        
        if (!is_persisted) {
            if (!properties.created_at) {
                properties.created_at = new Date();
            }
        }
        
        // Merge with default properties
        let default_value;
        Object.keys(this.defaults).forEach(key => {
            if (typeof properties[key] === "undefined") {
                default_value = this.defaults[key];
                if (typeof properties[key] === "undefined") {
                    properties[key] = (typeof default_value === "function") ? default_value(properties, is_persisted) : default_value;
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
        return new Promise((resolve, reject) => {
            const properties_that_are_relations = Object.keys(properties).filter(p => Object.keys(this._available_relations).includes(p));
            Promise.all(properties_that_are_relations.map(property_name => {
                const relation = this._available_relations[property_name];
                const property_value = properties[property_name];
                
                // If there is no relation with that name then throw an error
                if (typeof relation == "undefined") return rejectProperty(new Error(`'${property_name}' is not a relation`));
                
                // check the relation type to see what else needs to be created/saved
                switch (relation.type) {
                    case 'has_many': return this._saveHasManyRelation(model, relation, property_value, options);
                    case 'belongs_to': return this._saveBelongsToRelation(model, relation, property_value, options);
                    case 'has_and_belongs_to_many': return this._saveHasAndBelongsToManyRelation(model, relation, property_value, options);
                    
                    default: return Promise.resolve();
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
                resolve(properties);
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    _saveHasManyRelation (model, relation, related_objects, options) {
        return new Promise((resolve, reject) => {
            model = model.toJS ? model.toJS() : model;
            
            // Get or make a Klein Model for the related table
            const RelatedModel = this.klein.model(relation.table);
            
            // find any objects that have already been persisted
            let new_related_objects_ids = related_objects.map(r => r.id).filter(id => id && typeof id !== "undefined");
            
            // Unset any objects that have this model as their relation id
            this.knex(relation.table, options).where(relation.key, model.id).whereNotIn('id', new_related_objects_ids).update({ [relation.key]: null }).then(() => {
                // Find any related objects that are already in the database
                this.knex(relation.table, options).select('id').whereIn('id', new_related_objects_ids).then(existing_related_ids => {
                    Promise.all(related_objects.map(related_object => {
                        related_object[relation.key] = model.id;
                        // save/update the related object (which will then in turn save any relations on itself)
                        return RelatedModel.save(related_object, Object.assign({}, options, { exists: new_related_objects_ids.includes(related_object.id) }));

                    })).then(saved_related_objects => {
                        resolve({
                            name: relation.name,
                            value: saved_related_objects
                        });
                    }).catch(err => {
                        reject(err);
                    });
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    _saveBelongsToRelation (model, relation, related_object, options) {
        return new Promise((resolve, reject) => {
            model = model.toJS ? model.toJS() : model;
            
            const RelatedModel = this.klein.model(relation.table);
            RelatedModel.save(related_object).then(object => {
                this.knex(this.table_name, options).where({ id: model.id }).update({ [relation.key]: object.get('id') }).then(() => {
                    resolve({
                        name: relation.name,
                        value: object,
                        // Return with the information to update the current model
                        belongs_to_key: relation.key,
                        belongs_to_value: object.get('id')
                    });
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    _saveHasAndBelongsToManyRelation (model, relation, related_objects, options) {
        return new Promise((resolve, reject) => {
            model = model.toJS ? model.toJS() : model;
            const RelatedModel = this.klein.model(relation.table);
            
            // eg. Users.save(user) where user.has('projects')
            // relation_ids would be project_ids
            let new_relation_ids = related_objects.map(r => r.id).filter(id => id && typeof id !== "undefined");
            // Find any join rows that already exist so that we don't create them again
            // eg. projects_users records for this user
            this.knex(relation.through_table, options).select(relation.key).where(relation.source_key, model.id).then(existing_related_object_ids => {
                existing_related_object_ids = existing_related_object_ids.map(r => r[relation.key]);
                // Delete any join rows that have been removed
                // eg. remove any projects_users the are no long attached to the user
                this.knex(relation.through_table, options).where(relation.source_key, model.id).whereNotIn(relation.key, new_relation_ids).del().then(() => {
                    // Work out which related rows already exist
                    // eg. which projects already exist
                    this.knex(relation.table, options).select('id').whereIn('id', new_relation_ids).then(existing_related_ids => {
                        existing_related_ids = existing_related_ids.map(r => r.id);
                        
                        // For each related thing create it if it doesn't exist and create a join record if it doesn't exist
                        // eg. for each project, create it if it doesn't exist and create a projects_users for it if that doesn't exist
                        Promise.all(related_objects.map(related_object => {
                            return new Promise((resolveRelated, rejectRelated) => {
                                // create the related_object first so that we have an id for the join row
                                RelatedModel.save(related_object, Object.assign({}, options, { exists: existing_related_ids.includes(related_object.id) })).then(object => {
                                    if (existing_related_object_ids.includes(object.id)) {
                                        return Promise.resolve(object);
                                    } else {
                                        const new_join_row = {
                                            id: uuid(),
                                            [relation.key]: object.get('id'),
                                            [relation.source_key]: model.id,
                                            updated_at: new Date(),
                                            created_at: new Date()
                                        }
                                        
                                        return this.knex(relation.through_table, options).insert(new_join_row, 'id').then(() => {
                                            return object;
                                        });
                                    }
                                }).then(related_object => {
                                    resolveRelated(related_object);
                                }).catch(err => {
                                    rejectRelated(err);
                                });
                            });
                        })).then(saved_related_objects => {
                            resolve({
                                name: relation.name,
                                value: saved_related_objects
                            });
                        }).catch(err => {
                            reject(err);
                        });
                    }).catch(err => {
                        reject(err);
                    });
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        });
    }
    
    
    /*
        For each relation requested via `.include` find the related rows and attach them
        to the matching Model rows
    */
    _includeRelations (results, options) {
        return new Promise((resolveResults, rejectResults) => {
            if (results.length == 0) return resolveResults(results);
            if (this._included_relations.length == 0) return resolveResults(results);
            
            let ids = results.map(r => r.id);
            Promise.all(this._included_relations.map(relation_name => {
                return new Promise((resolve, reject) => {
                    const relation = this._available_relations[relation_name];
                    
                    // If there is no relation with that name then throw an error
                    if (typeof relation == "undefined") return reject(new Error(`'${relation_name}' is not a relation`));
                    
                    if (relation.type === 'has_many') {
                        /*
                            eg.
                                Department has many Users
                        */
                        this.knex(relation.table, options).select('*').whereIn(relation.key, ids).then(related_rows => {
                            related_rows = related_rows.map(r => Object.assign({}, r));
                            return resolve({ name: relation_name, properties: relation, rows: related_rows });
                        }).catch(err => {
                            reject(err);
                        });
                        
                    } else if (relation.type === 'has_and_belongs_to_many') {
                        /*
                            eg.
                                User has many Projects (through users_projects)
                                Project has many Users (through users_projects)
                        */
                        this.knex(relation.through_table, options).select(relation.source_key, relation.key).whereIn(relation.source_key, ids).then(through_ids => {
                            let joins = through_ids.map(r => Object.assign({}, r));
                            through_ids = through_ids.map(r => r[relation.key]);
                            this.knex(relation.table, options).select('*').whereIn('id', through_ids).then(related_rows => {
                                related_rows = related_rows.map(r => Object.assign({}, r));
                                return resolve({ name: relation_name, properties: relation, joins: joins, rows: related_rows });
                            });
                        }).catch(err => {
                            reject(err);
                        });
                        
                    } else if (relation.type === 'one') {
                        // Not sure when this would ever be used
                        this.knex(relation.table, options).select('*').whereIn(relation.key, ids).limit(1).then(related_rows => {
                            related_rows = related_rows.map(r => Object.assign({}, r));
                            return resolve({ name: relation_name, properties: relation, rows: related_rows });
                        }).catch(err => {
                            reject(err);
                        });
                        
                    } else if (relation.type === 'belongs_to') {
                        /*
                            eg.
                                User belongs to Department
                                Project belongs to User (eg. created_by_user_id)
                        */
                        let relation_ids = results.map(r => r[relation.key]);
                        this.knex(relation.table, options).select('*').whereIn('id', relation_ids).then(related_rows => {
                            related_rows = related_rows.map(r => Object.assign({}, r));
                            return resolve({ name: relation_name, properties: relation, rows: related_rows });
                        }).catch(err => {
                            reject(err);
                        });
                        
                    } else {
                        // No matching type?
                        return resolve({ name: relation_name, properties: relation, rows: [] });
                    }
                });
                
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
                return resolveResults(results);
            }).catch(err => {
                rejectResults(err);
            });
        });
    }
}


module.exports = Model;
