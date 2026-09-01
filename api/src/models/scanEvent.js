'use strict';

/**
 * Append-only history of everything that ever happened to a pack.
 *
 * This table does three jobs at once, which is why it is worth getting right
 * now rather than retrofitting later:
 *
 *   1. the chain-of-custody trail a regulator inspects
 *   2. the history a customer sees after scanning a QR code (Phase 4)
 *   3. the feature source the anomaly detector trains on (Phase 6)
 *
 * Rows are never updated and never deleted. Coordinates are captured on every
 * event because implied travel speed between consecutive events is the single
 * strongest signal that a serial has been cloned.
 */
const EVENT_TYPES = [
  'created',    // pack generated at the manufacturer
  'dispatched', // left an organization
  'received',   // arrived at an organization
  'dispensed',  // handed to a patient
  'verified',   // public QR scan (Phase 4)
  'flagged',    // raised by the anomaly detector (Phase 6)
];

module.exports = (sequelize, DataTypes) => {
  const ScanEvent = sequelize.define(
    'ScanEvent',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      packId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'pack_id',
        references: { model: 'packs', key: 'id' },
      },
      type: {
        type: DataTypes.ENUM(...EVENT_TYPES),
        allowNull: false,
      },
      // Nullable throughout: a public verification scan has no user and no
      // organization, and that absence is itself meaningful to the detector.
      organizationId: { type: DataTypes.INTEGER, allowNull: true, field: 'organization_id' },
      userId: { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },
      shipmentId: { type: DataTypes.INTEGER, allowNull: true, field: 'shipment_id' },
      latitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
      longitude: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
      ipAddress: { type: DataTypes.STRING(64), allowNull: true, field: 'ip_address' },
      userAgent: { type: DataTypes.STRING(255), allowNull: true, field: 'user_agent' },
      /** Free-form context, stored as JSON text so MySQL and SQLite agree. */
      metadata: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue('metadata');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        },
        set(value) {
          this.setDataValue('metadata', value == null ? null : JSON.stringify(value));
        },
      },
    },
    {
      tableName: 'scan_events',
      underscored: true,
      timestamps: true,
      updatedAt: false, // append-only
    }
  );

  ScanEvent.TYPES = EVENT_TYPES;

  ScanEvent.associate = (db) => {
    ScanEvent.belongsTo(db.Pack, { foreignKey: 'packId', as: 'pack' });
    ScanEvent.belongsTo(db.Organization, { foreignKey: 'organizationId', as: 'organization' });
    db.Pack.hasMany(ScanEvent, { foreignKey: 'packId', as: 'events' });
  };

  return ScanEvent;
};
