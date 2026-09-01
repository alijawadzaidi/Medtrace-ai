'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shipment_items', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      shipment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'shipments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      pack_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'packs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    // A pack cannot appear twice in one shipment.
    await queryInterface.addIndex('shipment_items', ['shipment_id', 'pack_id'], {
      name: 'shipment_items_unique_idx',
      unique: true,
    });
    await queryInterface.addIndex('shipment_items', ['pack_id'], {
      name: 'shipment_items_pack_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shipment_items');
  },
};
