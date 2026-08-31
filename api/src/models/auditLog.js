'use strict';

/**
 * Append-only record of every write. Populated by a global Sequelize hook
 * rather than by hand in each route, so features added in later phases are
 * audited without touching this file.
 */
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true, // null for unauthenticated or system-originated writes
        field: 'user_id',
      },
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'organization_id',
      },
      action: {
        type: DataTypes.ENUM('create', 'update', 'delete'),
        allowNull: false,
      },
      entity: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      entityId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'entity_id',
      },
      changes: {
        // Stored as JSON text so the column behaves the same on SQLite and MySQL.
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue('changes');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        },
        set(value) {
          this.setDataValue('changes', value == null ? null : JSON.stringify(value));
        },
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ip_address',
      },
      requestId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'request_id',
      },
    },
    {
      tableName: 'audit_logs',
      underscored: true,
      timestamps: true,
      updatedAt: false, // append-only: a row is never modified
    }
  );

  return AuditLog;
};
