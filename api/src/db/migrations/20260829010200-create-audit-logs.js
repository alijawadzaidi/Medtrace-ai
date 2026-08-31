'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // Deliberately NOT a foreign key: an audit row must survive the deletion
      // of the user or organization it refers to.
      user_id: { type: Sequelize.INTEGER, allowNull: true },
      organization_id: { type: Sequelize.INTEGER, allowNull: true },
      action: {
        type: Sequelize.ENUM('create', 'update', 'delete'),
        allowNull: false,
      },
      entity: { type: Sequelize.STRING(64), allowNull: false },
      entity_id: { type: Sequelize.STRING(64), allowNull: true },
      changes: { type: Sequelize.TEXT, allowNull: true },
      ip_address: { type: Sequelize.STRING(64), allowNull: true },
      request_id: { type: Sequelize.STRING(64), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('audit_logs', ['entity', 'entity_id'], {
      name: 'audit_logs_entity_idx',
    });
    await queryInterface.addIndex('audit_logs', ['user_id'], {
      name: 'audit_logs_user_id_idx',
    });
    await queryInterface.addIndex('audit_logs', ['created_at'], {
      name: 'audit_logs_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
