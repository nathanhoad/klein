const knex = require('knex');
const uuid = require('uuid/v4');
const Model = require('./model');


class Klein {
    constructor (database_url_or_knex, client) {
        if (database_url_or_knex instanceof String || typeof database_url_or_knex == "undefined") {
            this.knex = require('knex')({
                connection: database_url_or_knex || process.env.DATABASE_URL,
                client: client || 'pg',
                returning: '*'
            });
        } else {
            this.knex = database_url_or_knex;
        }
        
        this.models = {};
    }
    
    
    model (table_name, args) {
        // If we already know about this model and no args are given then return the previously defined model
        if (typeof args === "undefined" && typeof this.models[table_name] !== "undefined") return this.models[table_name];
        
        args = Object.assign({}, {
            knex: this.knex,
            klein: this
        }, args);
        
        const model = new Model(table_name, args);
        
        // Keep a registry of defined models
        this.models[table_name] = model;
        
        return model;
    }
    
    
    uuid () {
        return uuid();
    }
    
    
    transaction (handler) {
        return this.knex.transaction(handler);
    }
}


module.exports.connect = (database_url_or_knex, client) => {
    return new Klein(database_url_or_knex, client);
};
