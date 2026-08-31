'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('packs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      batch_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'batches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE', // packs have no meaning without their batch
      },
      serial: { type: Sequelize.STRING(48), allowNull: false, unique: true },
      current_organization_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      state: {
        type: Sequelize.ENUM('created', 'in_transit', 'received', 'dispensed', 'destroyed'),
        allowNull: false,
        defaultValue: 'created',
      },
      dispensed_at: { type: Sequelize.DATE, allowNull: true },
      scan_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_scanned_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The serial index is the hot path: every public verification hits it.
    await queryInterface.addIndex('packs', ['batch_id'], { name: 'packs_batch_id_idx' });
    await queryInterface.addIndex('packs', ['current_organization_id'], {
      name: 'packs_current_organization_id_idx',
    });
    await queryInterface.addIndex('packs', ['state'], { name: 'packs_state_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('packs');
  },
};
