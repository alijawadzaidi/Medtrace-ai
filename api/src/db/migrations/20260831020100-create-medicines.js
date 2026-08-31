'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('medicines', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      manufacturer_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: { type: Sequelize.STRING(160), allowNull: false },
      generic_name: { type: Sequelize.STRING(160), allowNull: true },
      strength: { type: Sequelize.STRING(60), allowNull: false },
      form: {
        type: Sequelize.ENUM('tablet', 'capsule', 'syrup', 'injection', 'ointment', 'drops', 'inhaler'),
        allowNull: false,
      },
      pack_size: { type: Sequelize.STRING(60), allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('medicines', ['manufacturer_id'], {
      name: 'medicines_manufacturer_id_idx',
    });
    // One manufacturer cannot register the same product twice.
    await queryInterface.addIndex('medicines', ['manufacturer_id', 'name', 'strength', 'form'], {
      name: 'medicines_unique_product_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('medicines');
  },
};
