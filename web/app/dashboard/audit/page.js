'use client';

import { useState } from 'react';

import { useApi } from '@/lib/useApi';
import { formatDateTime } from '@/lib/format';
import { Card, Empty, ErrorNote, Loading, Select } from '@/components/ui';

/**
 * The audit trail, regulators only.
 *
 * Rows are written by a global Sequelize hook rather than by hand in each
 * route, which is why this screen already covers features that did not exist
 * when the hook was written. Passwords are redacted before they ever reach the
 * table.
 */
const ENTITIES = ['', 'User', 'Medicine', 'Batch', 'Pack', 'Shipment', 'Organization'];
const ACTIONS = ['', 'create', 'update', 'delete'];

/** Which fields a row touched, whatever shape the change took. */
function changedFields(row) {
  const changes = row.changes || {};
  return [...new Set([...Object.keys(changes.after || {}), ...Object.keys(changes.before || {})])];
}

export default function AuditPage() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');

  const query = new URLSearchParams({ limit: '50' });
  if (entity) query.set('entity', entity);
  if (action) query.set('action', action);

  const logs = useApi(`/audit-logs?${query.toString()}`);
  const rows = logs.data?.logs || [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 text-sm text-muted">
          Every write, with who made it and what changed.
        </p>
      </header>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Select label="Entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
            {ENTITIES.map((value) => (
              <option key={value} value={value}>
                {value || 'Everything'}
              </option>
            ))}
          </Select>
          <Select label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {value || 'All actions'}
              </option>
            ))}
          </Select>
        </div>

        <ErrorNote error={logs.error} />

        {logs.loading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty>Nothing matches those filters.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {row.action} {row.entity}
                    <span className="text-muted"> #{row.entityId}</span>
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(row.createdAt)}</p>
                </div>
                <p className="text-xs text-muted">
                  {row.userId ? `user #${row.userId}` : 'unauthenticated'}
                  {row.organizationId ? ` · org #${row.organizationId}` : ''}
                  {row.ipAddress ? ` · ${row.ipAddress}` : ''}
                </p>
                {/* The fields, not the values: an audit list is for spotting
                    what was touched, and dumping full before/after payloads
                    into a scrolling list hides exactly that. */}
                {changedFields(row).length > 0 && (
                  <p className="serial mt-1 text-xs text-muted">
                    {changedFields(row).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
