'use strict';

// Minimal Jest config. Tests mock the pg pool (see backend/controllers/__tests__)
// so this suite never needs a live database connection — safe to run
// anywhere, including on the production machine, without touching real data.
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/'],
  verbose: true,
};
