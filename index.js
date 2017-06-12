require('dotenv').load({ silent: true });

const knex = require('knex');
const uuid = require('uuid/v4');
const Model = require('./model');


class Klein {
    constructor (database_url_or_knex, client) {
        if (database_url_or_knex instanceof String || typeof database_url_or_knex == "undefined") {
            const default_database_url = process.env.NODE_ENV == "test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
            
            this.knex = require('knex')({
                connection: typeof database_url_or_knex === "string" ? database_url_or_knex : default_database_url,
                client: typeof client === "string" ? client : 'pg',
                returning: '*'
            });
        } else {
            this.knex = database_url_or_knex;
        }
        
        this.models = {};
    }
    
    
    static connect (database_url_or_knex, client, force_new_connection) {
        if (force_new_connection || typeof Klein.instance === "undefined") {
            Klein.instance = new Klein(database_url_or_knex, client);
        }
        
        return Klein.instance;
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


module.exports = Klein;