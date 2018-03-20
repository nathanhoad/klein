const yeoman = require('yeoman-environment');

class Generate {
  /**
   * Run a generator
   * @param {String} generator The name of the generator
   * @param {Array?} args Any command line args
   */
  yo(generator, args) {
    return new Promise((resolve, reject) => {
      let env;
      if (process.env.NODE_ENV === 'test') {
        const { TestAdapter } = require('yeoman-test/lib/adapter');
        env = yeoman.createEnv([], {}, new TestAdapter());
      } else {
        env = yeoman.createEnv();
      }
      env.register(require.resolve(__dirname + `/generators/${generator}`), 'generate');
      env.run(`generate ${args.join(' ')}`, () => {
        return resolve();
      });
    });
  }

  /**
   * Generate a new model and model migration
   * @param {Array?} args Any command line arguments
   * @param {Object?} config 
   * @returns {Promise}
   */
  async model(args, config) {
    await this.yo('model', args);
  }

  /**
   * Generate a new migration
   * @param {Array?} args Any command line args
   * @param {Object?} config 
   * @returns {Promise}
   */
  async migration(args, config) {
    await this.yo('migration', args);
  }
}

module.exports = new Generate();
