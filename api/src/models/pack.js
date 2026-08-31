'use strict';

/**
 * One physical box of medicine. This is the table the whole project turns on:
 * because a serial identifies a single pack rather than a whole batch, a
 * duplicate scan is evidence of a clone rather than ordinary traffic.
 *
 * The state list is the chain of custody. Phase 3 enforces the legal
 * transitions between these values; Phase 2 only ever creates packs in
 * 'created'.
 */
const PACK_STATES = ['created', 'in_transit', 'received', 'dispensed', 'destroyed'];

module.exports = (sequelize, DataTypes) => {
  const Pack = sequelize.define(
    'Pack',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      batchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'batch_id',
        references: { model: 'batches', key: 'id' },
      },
      serial: {
        type: DataTypes.STRING(48),
        allowNull: false,
        unique: true,
      },
      /** Who physically holds it right now. Updated on every custody change. */
      currentOrganizationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'current_organization_id',
        references: { model: 'organizations', key: 'id' },
      },
      state: {
        type: DataTypes.ENUM(...PACK_STATES),
        allowNull: false,
        defaultValue: 'created',
      },
      dispensedAt: { type: DataTypes.DATE, allowNull: true, field: 'dispensed_at' },
      /** Denormalised counter so public verification is a single row read. */
      scanCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'scan_count',
      },
      lastScannedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_scanned_at' },
    },
    { tableName: 'packs', underscored: true, timestamps: true }
  );

  Pack.STATES = PACK_STATES;

  Pack.associate = (db) => {
    Pack.belongsTo(db.Batch, { foreignKey: 'batchId', as: 'batch' });
    Pack.belongsTo(db.Organization, {
      foreignKey: 'currentOrganizationId',
      as: 'currentOrganization',
    });
  };

  return Pack;
};
