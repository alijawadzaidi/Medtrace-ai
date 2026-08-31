'use strict';

/**
 * A production run. Recall lives here rather than on the pack: regulators
 * recall a batch, and every pack in it inherits that state at verification
 * time, so a recall is one write instead of thousands.
 */
const BATCH_STATUS = ['active', 'recalled', 'expired'];

module.exports = (sequelize, DataTypes) => {
  const Batch = sequelize.define(
    'Batch',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      medicineId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'medicine_id',
        references: { model: 'medicines', key: 'id' },
      },
      manufacturerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'manufacturer_id',
        references: { model: 'organizations', key: 'id' },
      },
      batchNo: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'batch_no',
      },
      /** The short code embedded in every serial in this batch. */
      batchCode: {
        type: DataTypes.STRING(16),
        allowNull: false,
        unique: true,
        field: 'batch_code',
      },
      manufacturedOn: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'manufactured_on',
      },
      expiresOn: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'expires_on',
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      status: {
        type: DataTypes.ENUM(...BATCH_STATUS),
        allowNull: false,
        defaultValue: 'active',
      },
      recalledAt: { type: DataTypes.DATE, allowNull: true, field: 'recalled_at' },
      recallReason: { type: DataTypes.STRING(255), allowNull: true, field: 'recall_reason' },
    },
    {
      tableName: 'batches',
      underscored: true,
      timestamps: true,
      validate: {
        expiryAfterManufacture() {
          if (this.expiresOn && this.manufacturedOn && this.expiresOn <= this.manufacturedOn) {
            throw new Error('Expiry date must be after the manufacture date');
          }
        },
      },
    }
  );

  Batch.STATUS = BATCH_STATUS;

  /** Expiry is derived, never stored as a flag that can drift out of date. */
  Batch.prototype.isExpired = function isExpired(on = new Date()) {
    return new Date(this.expiresOn) < new Date(on.toISOString().slice(0, 10));
  };

  Batch.associate = (db) => {
    Batch.belongsTo(db.Medicine, { foreignKey: 'medicineId', as: 'medicine' });
    Batch.belongsTo(db.Organization, { foreignKey: 'manufacturerId', as: 'manufacturer' });
    Batch.hasMany(db.Pack, { foreignKey: 'batchId', as: 'packs' });
  };

  return Batch;
};
