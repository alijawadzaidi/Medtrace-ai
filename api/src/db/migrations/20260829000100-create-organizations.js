'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('organizations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM('manufacturer', 'distributor', 'pharmacy', 'regulator'),
        allowNull: false,
      },
      license_no: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      city: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(2),
        allowNull: false,
        defaultValue: 'IN',
      },
      latitude: {
        type: Sequelize.DECIMAL(9, 6),
        allowNull: true,
      },
      longitude: {
        type: Sequelize.DECIMAL(9, 6),
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('organizations', ['type'], {
      name: 'organizations_type_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organizations');
  },
};
