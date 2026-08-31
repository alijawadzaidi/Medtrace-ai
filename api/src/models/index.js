'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

const config = require('../config/database')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(config);
const db = { sequelize, Sequelize };

// Auto-load every model file in this directory so adding a model in a later
// phase needs no edit here.
fs.readdirSync(__dirname)
  .filter((file) => file !== 'index.js' && file.endsWith('.js'))
  .sort()
  .forEach((file) => {
    const model = require(path.join(__dirname, file))(sequelize, DataTypes);
    db[model.name] = model;
  });

// Wire associations once every model is registered.
Object.values(db)
  .filter((model) => typeof model?.associate === 'function')
  .forEach((model) => model.associate(db));

// Global audit hooks. Registered after every model exists so that models added
// in later phases are covered with no change here.
require('../db/auditHook')(sequelize, db.AuditLog);

module.exports = db;
