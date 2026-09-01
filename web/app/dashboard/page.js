'use client';

import Link from 'next/link';

import { useApi } from '@/lib/useApi';
import { useSession, roleLabel } from '@/lib/session';
import { Card, Stat, Badge, Empty, Loading, ErrorNote } from '@/components/ui';
import { formatDate } from '@/lib/format';

/**
 * What each role needs to see first.
 *
 * A manufacturer opens this to check what they have produced; a pharmacy to
 * see what is arriving; a regulator to find what is wrong. Same data, three
 * different first questions — so the numbers on top change with the role
 * while the tables below stay the same components.
 */
export default function OverviewPage() {
  const { user } = useSession();
  const batches = useApi('/batches', { skip: !['manufacturer', 'regulator'].includes(user.role) });
  const shipments = useApi('/shipments');

  const incoming = (shipments.data?.shipments || []).filter(
    (s) => s.toOrganizationId === user.organizationId && s.status === 'in_transit'
  );
  const outstanding = (shipments.data?.shipments || []).filter((s) => s.status === 'draft');
  const recalled = (batches.data?.batches || []).filter((b) => b.status === 'recalled');

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{user.organization.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {roleLabel(user.role)} · {user.organization.city} · licence {user.organization.licenseNo}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {['manufacturer', 'regulator'].includes(user.role) && (
          <Stat
            label="Batches"
            value={batches.loading ? '—' : batches.data?.count ?? 0}
            hint={recalled.length ? `${recalled.length} recalled` : 'none recalled'}
          />
        )}
        <Stat
          label="Shipments in transit"
          value={shipments.loading ? '—' : incoming.length}
          hint={incoming.length ? 'waiting for you to receive' : 'nothing inbound'}
        />
        <Stat
          label="Drafts"
          value={shipments.loading ? '—' : outstanding.length}
          hint="created but not dispatched"
        />
      </div>

      <ErrorNote error={shipments.error || batches.error} />

      <Card
        title="Shipments needing attention"
        action={
          <Link href="/dashboard/shipments" className="text-xs font-medium text-brand">
            All shipments →
          </Link>
        }
      >
        {shipments.loading ? (
          <Loading />
        ) : incoming.length + outstanding.length === 0 ? (
          <Empty>Nothing waiting. Every shipment has been received.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {[...incoming, ...outstanding].map((shipment) => (
              <li key={shipment.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="serial text-sm font-medium">{shipment.reference}</p>
                  <p className="truncate text-xs text-muted">
                    {shipment.fromOrganization?.name} → {shipment.toOrganization?.name}
                  </p>
                </div>
                <Badge>{shipment.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {['manufacturer', 'regulator'].includes(user.role) && (
        <Card
          title="Recent batches"
          action={
            <Link href="/dashboard/batches" className="text-xs font-medium text-brand">
              All batches →
            </Link>
          }
        >
          {batches.loading ? (
            <Loading />
          ) : !batches.data?.batches?.length ? (
            <Empty>No batches yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {batches.data.batches.slice(0, 5).map((batch) => (
                <li key={batch.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/batches/${batch.id}`}
                      className="text-sm font-medium hover:text-brand"
                    >
                      {batch.batchNo}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {batch.medicine?.name} {batch.medicine?.strength} · {batch.quantity} packs ·
                      expires {formatDate(batch.expiresOn)}
                    </p>
                  </div>
                  <Badge>{batch.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
