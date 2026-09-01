'use strict';

/** Join row: which packs travelled in which shipment. */
module.exports = (sequelize, DataTypes) => {
  const ShipmentItem = sequelize.define(
    'ShipmentItem',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      shipmentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'shipment_id',
        references: { model: 'shipments', key: 'id' },
      },
      packId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'pack_id',
        references: { model: 'packs', key: 'id' },
      },
    },
    { tableName: 'shipment_items', underscored: true, timestamps: true, updatedAt: false }
  );

  ShipmentItem.associate = (db) => {
    ShipmentItem.belongsTo(db.Shipment, { foreignKey: 'shipmentId', as: 'shipment' });
    ShipmentItem.belongsTo(db.Pack, { foreignKey: 'packId', as: 'pack' });
  };

  return ShipmentItem;
};
