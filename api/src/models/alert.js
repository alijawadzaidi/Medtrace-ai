'use strict';

/**
 * What the detector found, and what a regulator did about it.
 *
 * Alerts are the one place where the deterministic rules and the model meet.
 * Both write here, and the `rule` column says which: `impossible_travel` is
 * something a person can act on immediately, `anomaly_score` is the model
 * saying a pack looks unlike the others without being able to say why. Keeping
 * them in one table — with the features that produced each — is what makes the
 * comparison in the report possible.
 */
const SEVERITIES = ['info', 'warning', 'critical'];
const STATUSES = ['open', 'investigating', 'confirmed', 'dismissed'];

module.exports = (sequelize, DataTypes) => {
  const Alert = sequelize.define(
    'Alert',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      packId: { type: DataTypes.INTEGER, allowNull: true, field: 'pack_id' },
      batchId: { type: DataTypes.INTEGER, allowNull: true, field: 'batch_id' },
      rule: { type: DataTypes.STRING(64), allowNull: false },
      severity: { type: DataTypes.ENUM(...SEVERITIES), allowNull: false, defaultValue: 'warning' },
      score: { type: DataTypes.FLOAT, allowNull: true },
      status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'open' },
      summary: { type: DataTypes.STRING(500), allowNull: false },
      /** The feature vector behind the alert, so a finding can be re-examined. */
      details: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue('details');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        },
        set(value) {
          this.setDataValue('details', value == null ? null : JSON.stringify(value));
        },
      },
      resolvedByUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'resolved_by_user_id' },
      resolvedAt: { type: DataTypes.DATE, allowNull: true, field: 'resolved_at' },
      resolutionNote: { type: DataTypes.STRING(500), allowNull: true, field: 'resolution_note' },
    },
    { tableName: 'alerts', underscored: true, timestamps: true }
  );

  Alert.SEVERITIES = SEVERITIES;
  Alert.STATUSES = STATUSES;

  Alert.associate = (db) => {
    Alert.belongsTo(db.Pack, { foreignKey: 'packId', as: 'pack' });
    Alert.belongsTo(db.Batch, { foreignKey: 'batchId', as: 'batch' });
  };

  return Alert;
};
