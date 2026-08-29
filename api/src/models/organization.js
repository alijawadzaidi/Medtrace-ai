'use strict';

/**
 * Every actor in the supply chain is an organization. Scoping queries by
 * organization_id is what makes RBAC mean "which distributor" and not merely
 * "some distributor".
 *
 * Latitude and longitude are not decoration: the anomaly detector derives
 * implied travel speed between consecutive custody events from them.
 */
const ORG_TYPES = ['manufacturer', 'distributor', 'pharmacy', 'regulator'];

module.exports = (sequelize, DataTypes) => {
  const Organization = sequelize.define(
    'Organization',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
        validate: { notEmpty: true },
      },
      type: {
        type: DataTypes.ENUM(...ORG_TYPES),
        allowNull: false,
      },
      licenseNo: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'license_no',
      },
      city: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: 'IN',
      },
      latitude: {
        type: DataTypes.DECIMAL(9, 6),
        allowNull: true,
        validate: { min: -90, max: 90 },
      },
      longitude: {
        type: DataTypes.DECIMAL(9, 6),
        allowNull: true,
        validate: { min: -180, max: 180 },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
    },
    {
      tableName: 'organizations',
      underscored: true,
      timestamps: true,
    }
  );

  Organization.TYPES = ORG_TYPES;

  Organization.associate = () => {
    // Users, batches and shipments attach here in Phases 1-3.
  };

  return Organization;
};
