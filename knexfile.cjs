const path = require('path');

module.exports = {
  client: 'pg',
  connection: process.env.AGENTRAIL_SECRETS_DATABASE_URL,
  migrations: {
    directory: path.resolve(__dirname, 'migrations'),
    extension: 'cjs',
  },
};
