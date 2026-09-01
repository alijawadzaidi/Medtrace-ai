'use strict';

/**
 * A transfer envelope between two organizations. Packs move as a group, which
 * is how the real chain works — a distributor receives a carton, not 400
 * individual boxes — and it keeps one audit row per movement instead of one
 * per pack.
 */
const SHIPMENT_STATUS = ['draft', 'in_transit', 'received', 'cancelled'];

module.exports = (sequelize, DataTypes) => {
  const Shipment = sequelize.define(
    'Shipment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      reference: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      fromOrganizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'from_organization_id',
        references: { model: 'organizations', key: 'id' },
      },
      toOrganizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'to_organization_id',
        references: { model: 'organizations', key: 'id' },
      },
      status: {
        type: DataTypes.ENUM(...SHIPMENT_STATUS),
        allowNull: false,
        defaultValue: 'draft',
      },
      createdByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'created_by_user_id',
      },
      receivedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'received_by_user_id',
      },
      dispatchedAt: { type: DataTypes.DATE, allowNull: true, field: 'dispatched_at' },
      receivedAt: { type: DataTypes.DATE, allowNull: true, field: 'received_at' },
      carrier: { type: DataTypes.STRING(120), allowNull: true },
      notes: { type: DataTypes.STRING(500), allowNull: true },
    },
    { tableName: 'shipments', underscored: true, timestamps: true }
  );

  Shipment.STATUS = SHIPMENT_STATUS;

  Shipment.associate = (db) => {
    Shipment.belongsTo(db.Organization, { foreignKey: 'fromOrganizationId', as: 'fromOrganization' });
    Shipment.belongsTo(db.Organization, { foreignKey: 'toOrganizationId', as: 'toOrganization' });
    Shipment.hasMany(db.ShipmentItem, { foreignKey: 'shipmentId', as: 'items' });
    Shipment.belongsToMany(db.Pack, {
      through: db.ShipmentItem,
      foreignKey: 'shipmentId',
      otherKey: 'packId',
      as: 'packs',
    });
  };

  return Shipment;
};
