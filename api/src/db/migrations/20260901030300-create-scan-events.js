'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('scan_events', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      pack_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'packs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('created', 'dispatched', 'received', 'dispensed', 'verified', 'flagged'),
        allowNull: false,
      },
      // Not foreign keys: an event must survive the removal of the actor.
      organization_id: { type: Sequelize.INTEGER, allowNull: true },
      user_id: { type: Sequelize.INTEGER, allowNull: true },
      shipment_id: { type: Sequelize.INTEGER, allowNull: true },
      latitude: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
      ip_address: { type: Sequelize.STRING(64), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The hot path: "give me this pack's history in order".
    await queryInterface.addIndex('scan_events', ['pack_id', 'created_at'], {
      name: 'scan_events_pack_time_idx',
    });
    await queryInterface.addIndex('scan_events', ['type'], { name: 'scan_events_type_idx' });
    await queryInterface.addIndex('scan_events', ['organization_id'], {
      name: 'scan_events_organization_idx',
    });
    await queryInterface.addIndex('scan_events', ['created_at'], {
      name: 'scan_events_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('scan_events');
  },
};
