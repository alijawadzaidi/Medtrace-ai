'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('batches', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      medicine_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'medicines', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      manufacturer_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      batch_no: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      batch_code: { type: Sequelize.STRING(16), allowNull: false, unique: true },
      manufactured_on: { type: Sequelize.DATEONLY, allowNull: false },
      expires_on: { type: Sequelize.DATEONLY, allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      status: {
        type: Sequelize.ENUM('active', 'recalled', 'expired'),
        allowNull: false,
        defaultValue: 'active',
      },
      recalled_at: { type: Sequelize.DATE, allowNull: true },
      recall_reason: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('batches', ['medicine_id'], { name: 'batches_medicine_id_idx' });
    await queryInterface.addIndex('batches', ['manufacturer_id'], {
      name: 'batches_manufacturer_id_idx',
    });
    await queryInterface.addIndex('batches', ['status'], { name: 'batches_status_idx' });
    await queryInterface.addIndex('batches', ['expires_on'], { name: 'batches_expires_on_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('batches');
  },
};
