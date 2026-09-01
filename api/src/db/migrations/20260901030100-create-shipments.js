'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shipments', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      reference: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      from_organization_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      to_organization_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: Sequelize.ENUM('draft', 'in_transit', 'received', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      created_by_user_id: { type: Sequelize.INTEGER, allowNull: true },
      received_by_user_id: { type: Sequelize.INTEGER, allowNull: true },
      dispatched_at: { type: Sequelize.DATE, allowNull: true },
      received_at: { type: Sequelize.DATE, allowNull: true },
      carrier: { type: Sequelize.STRING(120), allowNull: true },
      notes: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('shipments', ['from_organization_id'], { name: 'shipments_from_idx' });
    await queryInterface.addIndex('shipments', ['to_organization_id'], { name: 'shipments_to_idx' });
    await queryInterface.addIndex('shipments', ['status'], { name: 'shipments_status_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shipments');
  },
};
