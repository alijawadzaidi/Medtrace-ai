'use strict';

const FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'ointment', 'drops', 'inhaler'];

module.exports = (sequelize, DataTypes) => {
  const Medicine = sequelize.define(
    'Medicine',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      manufacturerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'manufacturer_id',
        references: { model: 'organizations', key: 'id' },
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
        validate: { notEmpty: true },
      },
      genericName: {
        type: DataTypes.STRING(160),
        allowNull: true,
        field: 'generic_name',
      },
      strength: {
        type: DataTypes.STRING(60),
        allowNull: false,
        validate: { notEmpty: true },
      },
      form: {
        type: DataTypes.ENUM(...FORMS),
        allowNull: false,
      },
      packSize: {
        type: DataTypes.STRING(60),
        allowNull: true,
        field: 'pack_size',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
    },
    { tableName: 'medicines', underscored: true, timestamps: true }
  );

  Medicine.FORMS = FORMS;

  Medicine.associate = (db) => {
    Medicine.belongsTo(db.Organization, { foreignKey: 'manufacturerId', as: 'manufacturer' });
    Medicine.hasMany(db.Batch, { foreignKey: 'medicineId', as: 'batches' });
  };

  return Medicine;
};
