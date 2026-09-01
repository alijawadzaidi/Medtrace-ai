'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('alerts', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      pack_id: {
        type: Sequelize.INTEGER,
        allowNull: true, // a batch-wide alert names no single pack
        references: { model: 'packs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      batch_id: { type: Sequelize.INTEGER, allowNull: true },
      /** Which rule fired, or 'anomaly_score' for the model's own verdict. */
      rule: { type: Sequelize.STRING(64), allowNull: false },
      severity: {
        type: Sequelize.ENUM('info', 'warning', 'critical'),
        allowNull: false,
        defaultValue: 'warning',
      },
      /** 0..1 from the scorer. Null when a deterministic rule raised the alert. */
      score: { type: Sequelize.FLOAT, allowNull: true },
      status: {
        type: Sequelize.ENUM('open', 'investigating', 'confirmed', 'dismissed'),
        allowNull: false,
        defaultValue: 'open',
      },
      /** Human-readable sentence plus the features that produced it. */
      summary: { type: Sequelize.STRING(500), allowNull: false },
      details: { type: Sequelize.TEXT, allowNull: true },
      resolved_by_user_id: { type: Sequelize.INTEGER, allowNull: true },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      resolution_note: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('alerts', ['status', 'severity'], { name: 'alerts_triage_idx' });
    await queryInterface.addIndex('alerts', ['pack_id'], { name: 'alerts_pack_idx' });
    await queryInterface.addIndex('alerts', ['batch_id'], { name: 'alerts_batch_idx' });

    // One open alert per pack per rule. Re-running detection must sharpen the
    // existing alert rather than pile up a duplicate every time a cloned pack
    // is scanned again — a regulator triaging four hundred copies of the same
    // finding is a detector that has failed at its actual job.
    await queryInterface.addIndex('alerts', ['pack_id', 'rule', 'status'], {
      name: 'alerts_pack_rule_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('alerts');
  },
};
