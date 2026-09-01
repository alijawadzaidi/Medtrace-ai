'use strict';

// The simulator is linted with the same rules as the API, which is the code it
// writes into. Keeping one rule set avoids the two drifting apart.
module.exports = require('../api/eslint.config.js');
