# Klein 

[![Build Status](https://travis-ci.com/nathanhoad/klein.svg?branch=master)](https://travis-ci.com/nathanhoad/klein)

A small ORM that combines ImmutableJS and knex.

Models are just Immutable Maps and have no database related instance methods. All querying is done statically from the model's class.

## Migration CLI

Generate a new model (and migration):

`klein generate model NAME [field:type [field:type]]`

...where `type` is anything in the [knex Schema methods](http://knexjs.org/#Schema-Building).

Generate a new migration:

`klein generate migration NAME`

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
    hooks: {
        beforeCreate(user) {
            user = user.set('fullName', [user.get('firstName'), user.get('lastName')].join(' '));
            return user;
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

### Hooks

Models expose a few hooks to help you manage the data going into the database.

Those hooks are (and generally called in this order):

- `beforeCreate` - Called before a model is created. Return
- `beforeSave` - Called before a model is saved (including just before it is created)
- `afterSave` - Called just after a model is saved (including just after it was created)
- `afterCreate` - Called just after a model is created
- `beforeDestroy` - Called just before a model is deleted
- `afterDestroy` - Called just after a model is deleted

Hooks are just functions and take the model (minus any relations) as the first argument.

```javascript
Klein.model('users', {
  hooks: {
    beforeCreate(model) {
      return model.set('something', 'default value');
    }
  }
});
```

You can also return a promise:

```javascript
Klein.model('users', {
  hooks: {
    beforeCreate(model) {
      return getSomeValue().then(value => {
        return model.set('something', value);
      });
    }
  }
});
```

For models with a [custom type definition](#custom-types), the custom instances are passed to the hooks.

#### `createdAt` and `updatedAt`

If you want to change the names of the `createdAt` and `updatedAt` automatic fields you can add this to your model:

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

To have different or disabled timestamps in your migrations you can set them in your `package.json` with either of these:

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
Users.where({ email: 'test@test.com' })
  .first()
  .then(user => {
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

Users.save(user, { touch: false }).then(user => {
  user.get('updatedAt'); // not changed with touch: false
})

Users.save(user, { touch: new Date(2019, 2, 13) }).then(user => {
  user.get('updatedAt'); // set to date specified in touch option
}) 
```

Saving a model that has `relations` attached will also attempt to save the attached related rows.

### Destroy

```javascript
Users.destroy(user).then(user => {
  // user is the user that was just destroyed
});
```

Any dependent related records will also be destroyed (see down further in Associations/Relations).

## Converting to json

Models can be converted to json and include either all fields or only selected fields based on a context mapper.

Contexts are defined on the model:

```javascript
const Users = Klein.model('users', {
  contexts: {
    simple: ['list', 'of', 'field', 'names'], // only these fields are included in the resulting object
    derived(user) {
      // given an Immutable.Map of the instance, return a Map or object
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
});
```

And then retrieve them.

```javascript
Users.include('projects')
  .all()
  .then(users => {
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
})
  .then(() => {
    // User and Hat are both committed to the database now
  })
  .catch(err => {
    // Something failed and both User and Hat are now rolled back
  });
```

## Custom types

By default, Klein returns `Immutable.Map` as instances with it's key and values mapped to the table's columns and values. It's possible to supply your own type definition for Klein to accept and return, as long as it can convert both ways.

```javascript
const Klein = require('klein').connect(process.env.DATABASE_URL);
const Users = klein.model('users', {
  type: {
    // without defining a factory, the default `Immutable.Map` method is used
    factory(rawProperties) {
      // given raw properties, return the instance
      return Immutable.fromJS(rawProperties).set('type', 'user');
    },

    // without instanceOf falls back to default of any `Immutable.Map` qualifying as an instance
    instanceOf(maybeInstance) {
      // return whether the given value is a valid instance
      return Immutable.Map.isMap(maybeInstance) && maybeInstance.get('type') === 'user';
    },

    // without serialize falls back to default of converting an `Immutable.Map` to plain JS object (deeply)
    serialize(instance, options) {
      // `options.context` and `options.contextName` are passed. The type definition is responsible for applying
      // the context transformations.

      // return a plain javascript version with keys and values mapping to columns and values
      return instance.remove('type').toJS()
    }
  }
})

Users.create({ name: 'Nathan' }).then(user => {
  user.get('type'); // => 'user'
});
```

Note: when using hooks, the custom type instances are passed to the hooks, instead of the default `Immutable.Map`.

### Vry

Instead of defining your own custom types, Klein works really well with [Vry](https://www.npmjs.com/package/vry), which allows you to easily setup your type's logic. Just like Klein it uses `Immutable.Map` for instances, but adding a bit of metadata to allow for type identification, nested types, merging, references, etc.

```javascript
const klein = require('klein').connect(process.env.DATABASE_URL);
const { Model } = require('vry')
const Invariant = require('invariant')

// define your single entity, with things like name and defaults
const User = Model.create({
  typeName: 'user',
  defaults: {
    name: 'Unknown user',
    email: null
  }
})

// add your own methods
User.hasEmail = function(user) {
  // make sure an actual user was passed
  Invariant(User.instanceOf(user), 'User required to check whether user has an email')
  
  return !!user.get('email')
}

// Use your Vry model as a Klein type
const Users = klein.model('users', {
  type: User
})

Users.create({ name: 'Nathan' }).then(user => {
  User.hasEmail(user) // => false
});

Users.all().then(users => {
  User.collectionOf(users) // => true
});
```

## Contributors

- Nathan Hoad - [nathan@nathanhoad.net](mailto:nathan@nathanhoad.net)
- Jaap van Hardeveld - [jaap@jaaprood.nl](mailto:jaap@jaaprood.nl)
