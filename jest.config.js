'use strict';

// Minimal Jest config. Tests mock the pg pool (see backend/controllers/__tests__)
// so this suite never needs a live database connection — safe to run
// anywhere, including on the production machine, without touching real data.
//
// backend/gold-loan-fixes.test.js is excluded: it's written for Node's
// native test runner (`node --test`, see its own header comment), not
// Jest. Jest previously still tried to load it, found no Jest-style
// tests inside, and reported the whole suite as FAILED on every run --
// even when all 32 real tests (in the two suites below) passed. Run it
// separately with `npm run test:legacy`.
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/gold-loan-fixes.test.js$'],
  verbose: true,
};
