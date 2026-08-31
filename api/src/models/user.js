'use strict';

const bcrypt = require('bcryptjs');
const env = require('../config/env');

/**
 * Roles map one-to-one onto organization types. A user's authority is always
 * exercised on behalf of exactly one organization, which is what lets every
 * query be scoped to "my organization" rather than "all organizations".
 */
const ROLES = ['manufacturer', 'distributor', 'pharmacy', 'regulator'];

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
      },
      fullName: {
        type: DataTypes.STRING(120),
        allowNull: false,
        field: 'full_name',
        validate: { notEmpty: true },
      },
      email: {
        type: DataTypes.STRING(180),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
        set(value) {
          this.setDataValue('email', String(value || '').trim().toLowerCase());
        },
      },
      passwordHash: {
        type: DataTypes.STRING(120),
        allowNull: false,
        field: 'password_hash',
      },
      role: {
        type: DataTypes.ENUM(...ROLES),
        allowNull: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_login_at',
      },
    },
    {
      tableName: 'users',
      underscored: true,
      timestamps: true,
      defaultScope: {
        // The hash must never leave the database by accident. Reach for it
        // explicitly with User.scope('withPassword') when verifying a login.
        attributes: { exclude: ['passwordHash'] },
      },
      scopes: {
        withPassword: { attributes: { include: ['passwordHash'] } },
      },
    }
  );

  User.ROLES = ROLES;

  /**
   * Hashing lives on the model, not in a route. Any code path that sets a
   * password — registration, reset, seeding, a future admin tool — is covered.
   */
  const hashPassword = async (user) => {
    if (user.changed('passwordHash')) {
      user.passwordHash = await bcrypt.hash(user.passwordHash, env.bcryptRounds);
    }
  };

  User.beforeCreate(hashPassword);
  User.beforeUpdate(hashPassword);

  User.prototype.verifyPassword = function verifyPassword(plain) {
    if (!this.passwordHash) {
      throw new Error('User was loaded without its password hash; use User.scope("withPassword")');
    }
    return bcrypt.compare(plain, this.passwordHash);
  };

  User.prototype.toJSON = function toJSON() {
    const { passwordHash: _passwordHash, ...safe } = this.get({ plain: true });
    return safe;
  };

  User.associate = (db) => {
    User.belongsTo(db.Organization, { foreignKey: 'organizationId', as: 'organization' });
    db.Organization.hasMany(User, { foreignKey: 'organizationId', as: 'users' });
  };

  return User;
};
