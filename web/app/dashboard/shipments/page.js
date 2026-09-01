'use client';

import { useState } from 'react';

import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorNote, Input, Loading, Select } from '@/components/ui';

/**
 * Custody, as a screen.
 *
 * Which buttons appear is decided by the same two questions the API asks:
 * are you the sender, and are you the destination? Only the holder may
 * dispatch, only the named destination may receive — so a shipment shows
 * "Dispatch" to one organization and "Receive" to another, and nothing at all
 * to the regulator watching both.
 */
export default function ShipmentsPage() {
  const { user, token } = useSession();
  const shipments = useApi('/shipments');
  // Not `/organizations` — that is scoped to your own organization, so a
  // manufacturer would see an empty destination list. `/organizations/partners`
  // is the directory of who the custody rules let you ship to.
  const partners = useApi('/organizations/partners');
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState({ id: null, error: null });

  const canSend = ['manufacturer', 'distributor'].includes(user.role);

  async function act(shipment, verb) {
    setAction({ id: shipment.id, error: null });
    try {
      await api.post(`/shipments/${shipment.id}/${verb}`, {}, token);
      await shipments.refresh();
      setAction({ id: null, error: null });
    } catch (error) {
      setAction({ id: null, error });
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shipments</h1>
          <p className="mt-1 text-sm text-muted">
            {/* No trailing full stop: organization names often end in one
                ("Meridian Pharmaceuticals Ltd."), and two in a row reads as a
                typo. */}
            Everything moving to or from {user.organization.name}
          </p>
        </div>
        {canSend && (
          <Button onClick={() => setCreating((open) => !open)}>
            {creating ? 'Cancel' : 'New shipment'}
          </Button>
        )}
      </header>

      {creating && (
        <NewShipmentForm
          organizations={partners.data?.organizations || []}
          token={token}
          onCreated={() => {
            setCreating(false);
            shipments.refresh();
          }}
        />
      )}

      <ErrorNote error={shipments.error || partners.error || action.error} />

      <Card>
        {shipments.loading ? (
          <Loading />
        ) : !shipments.data?.shipments?.length ? (
          <Empty>No shipments yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {shipments.data.shipments.map((shipment) => {
              const isSender = shipment.fromOrganizationId === user.organizationId;
              const isDestination = shipment.toOrganizationId === user.organizationId;
              const busy = action.id === shipment.id;

              return (
                <li key={shipment.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="serial text-sm font-medium">{shipment.reference}</p>
                    <p className="truncate text-xs text-muted">
                      {shipment.fromOrganization?.name} → {shipment.toOrganization?.name}
                      {shipment.dispatchedAt
                        ? ` · sent ${formatDateTime(shipment.dispatchedAt)}`
                        : ''}
                      {shipment.receivedAt ? ` · received ${formatDateTime(shipment.receivedAt)}` : ''}
                    </p>
                  </div>

                  <Badge>{shipment.status}</Badge>

                  {isSender && shipment.status === 'draft' && (
                    <>
                      <Button onClick={() => act(shipment, 'dispatch')} disabled={busy}>
                        {busy ? 'Dispatching…' : 'Dispatch'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => act(shipment, 'cancel')}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </>
                  )}

                  {isDestination && shipment.status === 'in_transit' && (
                    <Button onClick={() => act(shipment, 'receive')} disabled={busy}>
                      {busy ? 'Receiving…' : 'Receive'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Serials are pasted in, one per line, because that is what a warehouse
 * actually produces — a scanner gun fills a text field with one code per
 * scan. Anything cleverer here would be a worse fit for the job.
 */
function NewShipmentForm({ organizations, token, onCreated }) {
  const [toOrganizationId, setTo] = useState('');
  const [serials, setSerials] = useState('');
  const [carrier, setCarrier] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const parsed = serials
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(
        '/shipments',
        {
          toOrganizationId: Number(toOrganizationId),
          serials: parsed,
          ...(carrier.trim() ? { carrier: carrier.trim() } : {}),
        },
        token
      );
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New shipment">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Destination"
            required
            value={toOrganizationId}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Choose an organization…</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.type}, {org.city})
              </option>
            ))}
          </Select>

          <Input
            label="Carrier"
            hint="Optional"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
          />
        </div>

        <label className="block">
          <span className="text-sm font-medium">Serials</span>
          <span className="mt-0.5 block text-xs text-muted">
            One per line — paste straight from a scanner. {parsed.length} recognised.
          </span>
          <textarea
            rows={6}
            required
            value={serials}
            onChange={(e) => setSerials(e.target.value)}
            placeholder={'MT-39TS75-VED0695178YYR\nMT-39TS75-…'}
            className="serial mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-brand"
          />
        </label>

        <ErrorNote error={error} />

        <Button type="submit" disabled={busy || !parsed.length}>
          {busy ? 'Creating…' : `Create draft with ${parsed.length} pack${parsed.length === 1 ? '' : 's'}`}
        </Button>
      </form>
    </Card>
  );
}
