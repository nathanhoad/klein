# Klein

A small ORM that combines ImmutableJS and knex.

Models are just Immutable Maps and have no database related instance methods. All querying is done statically from the model's class.


## Changes coming in 2.0

* Hooks for `beforeCreate`, `afterCreate`, `beforeSave`, `afterSave`, `beforeDestroy`, `afterDestroy`
* Validations
* Field names are now camelCased by default


## Migration CLI

Generate a new model (and migration):

`klein new model NAME [field:type [field:type]]`

...where `type` is anything in the [knex Schema methods](http://knexjs.org/#Schema-Building).

Generate a new migration:

`klein new migration NAME`

Run any pending migrations:

`klein db migrate`

And rollback the last migration group:

`klein db rollback`

Get the current schema version:

`klein db version`

Get the schema (for a table):

`klein db schema [table]`

You can configure where Klein will put the models and migrations in your `package.json`:

```javascript
{
    "klein": {
        "migrationsPath": "migrations"
        "modelsPath": "app/server/models"
    }
}
```


## Usage

The easiest init is:

```javascript
// Assumes that process.env.DATABASE_URL is set and automatically connects 
// to the database
const Klein = require('klein/auto');
```

But if you need to specify a database URL:

```javascript
const Klein = require('klein').connect(process.env.DATABASE_URL);
```

Or, if you already have an instanciated `knex` object:

```javascript
const Klein = require('klein').connect(knex);
```

You can define models before connecting:

```javascript
const Klein = require('klein');
const Users = Klein.model('users');
```

Be sure to call `.connect()` before using the model:

```javascript
const Klein = require('klein');
const Users = Klein.models('users');

// Would throw an error before connecting
// Users.where({ email: 'test@test.com' });

Klein.connect();

// No errors once connected
Users.where({ email: 'test@test.com' });
```

A bigger example:

```javascript
const Users = Klein.model('users', {
    defaults: {
        id: Klein.uuid,
        full_name (properties) {
            return properties.firstName + ' ' + properties.lastName;
        }
    },
    relations: {
        projects: { hasAndBelongsToMany: 'projects' }
        department: { belongsTo: 'department' }, // assumes department_id
        shirts: { has_many: 'shirts', dependent: true } // deleting this user will delete all of their shirts
    },
    contexts: {
        simple: ['list', 'of', 'field', 'names'], // only these fields are included in the resulting object
        derived (user) { // given an Immutable.Map, return an Immutable.Map
            return user.merge({
                full_name: [user.get('firstName'), user.get('lastName')].join(' ')
            });
        }
    }
})
```


#### `createdAt` and `updatedAt`

If you want to change the names of the `createdAt` and `updatedAt` automatic fields you can 
add this to your model:

```javascript
const Users = Klein.model('users', {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});
```

...or even just turn them off altogether:

```javascript
const Users = Klein.model('users', {
    timestamps: false
});
```

To have different or disabled timestamps in your migrations you can set them in your `package.json` with either of
these:

```javascript
{
    "klein": {
        "timestamps": {
            "createdAt": "created_at",
            "updatedAt": "updated_at"
        }
    }
}
```

```javascript
{
    "klein": {
        "timestamps": false
    }
}
```


### Create

```javascript
const Users = Klein.model('users');

Users.create({ name: 'Nathan' }).then(user => {
    user.get('name'); // => Nathan
});

Users.create([{ name: 'Nathan' }, { name: 'Lilly' }]).then(users => {
    users.count(); // => 2
});
```


### Find

```javascript
Users.where({ email: 'test@test.com' }).first().then(user => {
    // user is an instance of Immutable.Map
    user = user.set('name', 'Test');
    
    Users.save(user).then(updated_user => {
        user.get('name');
    });
});


Users.find(1).then(user => {
    user.get('id'); // 1
});


Users.all().then(users => {
    // users is an instance of Immutable.List
    Users.json(users);
});

```


### Persisting

```javascript
user = user.set('firstName', 'Nathan');
Users.save(user).then(user => {
    user.get('updatedAt'); // Just then
});
```

Saving a model that has `relations` attached will also attempt to save the attached related rows.


### Destroy

```javascript
Users.destroy(user).then(user => {
    // user is the user that was just destroyed
});
```

Any dependent related records will also be destroyed (see down further in Associations/Relations).


## Default values

```javascript
const Users = Klein.model('users', {
    defaults: {
        id: Klein.uuid,
        fullName (properties) {
            return properties.firstName + ' ' + properties.lastName;
        },
        is_admin: false
    }
});


Users.create({ firstName: 'Nathan', lastName: 'Hoad' }).then(user => {
    user.get('fullName'); // Nathan Hoad
});
```


## Converting to json

Models can be converted to json and include either all fields or only selected fields based on a context mapper.

Contexts are defined on the model:

```javascript
const Users = Klein.model('users', {
    contexts: {
        simple: ['list', 'of', 'field', 'names'], // only these fields are included in the resulting object
        derived (user) { // given an Immutable.Map of the instance, return a Map or object
            return user.merge({
                fullName: [user.get('firstName'), user.get('lastName')].join(' ')
            });
        }
    }
});

// users is an Immutable.List
Users.json(users);
Users.json(users, 'simple');
Users.json(users, 'derived');
Users.json(users);

// user is an Immutable.Map
Users.json(user);
Users.json(user, 'simple');
Users.json(user, 'derived');
```


## Associations/Relations

Define `relations` on the collection:

```javascript
const Users = Klein.model('users', {
    relations: {
        projects: { hasAndBelongsToMany: 'projects' }
        department: { belongsTo: 'department' }, // assumes departmentId unless otherwise specified
        shirts: { hasMany: 'shirts', dependent: true } // deleting this user will delete all of their shirts
    }
});
```

Set them on a model and save them. Anything that hasn't already been saved will be saved.

```javascript
let newProject = {
    name: 'Some cool project'
};

let newUser = {
    name: 'Nathan',
    projects: [new_project]
};

Users.create(newUser).then(user => {
    user.get('projects'); // => Immutable.List [ Immutable.Map of { id, name: 'Some cool project', createdAt, updatedAt } ]
})
```

And then retrieve them.

```javascript
Users.include('projects').all().then(users => {
    users.first().get('project');
});
```

You can specify the key fields and table if needed:

```javascript
const Users = Klein.model('users', {
    relations: {
        projects: { hasAndBelongsToMany: 'projects', through: 'project_people', primaryKey: 'userId', foreignKey: 'projectId'  }
        department: { belongsTo: 'department', foreignKey: 'departmentId', table: 'department' },
        shirts: { has_many: 'shirts', dependent: true, foreignKey: 'userId' } 
    }
});
```


## Transactions

To wrap your actions inside a transaction just call:

```javascript
const Klein = require('klein').connect(process.env.DATABASE_URL);
const Users = Klein.model('users');
const Hats = Klein.model('hats');

Klein.transaction(transaction => {
    let nathan = {
        name: 'Nathan'
    };
    
    return Users.create(nathan, { transaction }).then(user => {
        return Hats.create({ type: 'Cowboy' }, { transaction });
    });
    
}).then(() => {
    // User and Hat are both committed to the database now
}).catch(err => {
    // Something failed and both User and Hat are now rolled back
});
```