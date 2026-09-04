'use client';

import { use, useState } from 'react';

import { API_URL, api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorNote, Input, Loading, Stat } from '@/components/ui';

/**
 * One batch: what it is, whether every pack was generated, the serials
 * themselves, and — for a regulator — the recall button.
 */
export default function BatchDetailPage({ params }) {
  // `params` is a promise in Next 16; `use` unwraps it inside a client component.
  const { id } = use(params);
  const { user, token } = useSession();

  const batch = useApi(`/batches/${id}`);
  const packs = useApi(`/batches/${id}/packs?limit=50`);
  const [action, setAction] = useState({ busy: false, error: null });
  const [reason, setReason] = useState('');
  const [labels, setLabels] = useState({ busy: false, error: null });

  /**
   * The label sheet is fetched, not linked to.
   *
   * It was a plain anchor, which cannot carry an Authorization header, so it
   * opened a 401 page — and a batch's label sheet lists every serial in the
   * batch, so making the route public is not the fix. The window is opened
   * synchronously before the await, because a popup blocker will stop
   * `window.open` called from an async callback.
   */
  async function openLabelSheet() {
    const printWindow = window.open('', '_blank');
    setLabels({ busy: true, error: null });

    try {
      const response = await fetch(`${API_URL}/batches/${id}/labels`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Could not load the label sheet (${response.status})`);

      const html = await response.text();
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      }
      setLabels({ busy: false, error: null });
    } catch (error) {
      if (printWindow) printWindow.close();
      setLabels({ busy: false, error });
    }
  }

  if (batch.loading) return <Loading label="Loading batch…" />;
  if (batch.error) return <ErrorNote error={batch.error} />;

  const { batch: detail, packs: completeness, expired } = batch.data;

  async function recall(event) {
    event.preventDefault();
    setAction({ busy: true, error: null });
    try {
      await api.post(`/batches/${id}/recall`, { reason: reason.trim() }, token);
      await batch.refresh();
      setAction({ busy: false, error: null });
    } catch (error) {
      setAction({ busy: false, error });
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{detail.batchNo}</h1>
          <p className="mt-1 text-sm text-muted">
            {detail.medicine?.name} {detail.medicine?.strength} · {detail.medicine?.form} ·
            made by {detail.manufacturer?.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{detail.status}</Badge>
          {expired && <Badge tone="warning">expired</Badge>}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Packs" value={completeness.generated} hint={`of ${completeness.expected} expected`} />
        <Stat label="Manufactured" value={formatDate(detail.manufacturedOn)} />
        <Stat label="Expires" value={formatDate(detail.expiresOn)} />
      </div>

      {!completeness.complete && (
        <ErrorNote
          error={{
            message: `Only ${completeness.generated} of ${completeness.expected} packs exist for this batch.`,
          }}
        />
      )}

      {detail.status === 'recalled' && (
        <Card title="Recalled">
          <p className="text-sm">
            Withdrawn {formatDate(detail.recalledAt)}. Reason: {detail.recallReason || '—'}
          </p>
          <p className="mt-2 text-xs text-muted">
            Every pack in this batch now returns a recall warning when a customer
            scans it, wherever it already is in the chain.
          </p>
        </Card>
      )}

      <Card
        title="Labels and serials"
        action={
          <button
            type="button"
            onClick={openLabelSheet}
            disabled={labels.busy}
            className="text-xs font-medium text-brand disabled:opacity-50"
          >
            {labels.busy ? 'Preparing…' : 'Print label sheet →'}
          </button>
        }
      >
        {packs.loading ? (
          <Loading />
        ) : packs.error ? (
          <ErrorNote error={packs.error} />
        ) : !packs.data?.packs?.length ? (
          <Empty>No packs.</Empty>
        ) : (
          <>
            <ErrorNote error={labels.error} className="mb-3" />
            <p className="mb-3 text-xs text-muted">
              Showing {packs.data.packs.length} of {packs.data.total}. Each serial is
              unguessable and self-checking — a typo fails before the database is touched.
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {packs.data.packs.map((pack) => (
                <li
                  key={pack.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-1.5"
                >
                  <span className="serial text-xs">{pack.serial}</span>
                  <Badge>{pack.state}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/*
        A manufacturer must not be able to quietly withdraw evidence of its own
        bad batch, so recall is a regulator action. The button is hidden here
        and the API refuses it there.
      */}
      {user.role === 'regulator' && detail.status !== 'recalled' && (
        <Card title="Regulator actions">
          <p className="mb-3 text-sm text-muted">
            Recalling withdraws all {detail.quantity} packs at once, wherever they are.
          </p>
          {/*
            The reason is typed inline rather than into a `window.prompt`. A
            native dialog blocks the page, reads as a browser error rather than
            part of the product, and is the one thing guaranteed to freeze a
            live demo.
          */}
          <form onSubmit={recall} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input
              label="Reason"
              required
              placeholder="Dissolution test failure in a retained sample"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="sm:min-w-80"
            />
            <Button type="submit" variant="danger" disabled={action.busy || !reason.trim()}>
              {action.busy ? 'Recalling…' : 'Recall this batch'}
            </Button>
          </form>
          <ErrorNote error={action.error} className="mt-3" />
        </Card>
      )}
    </div>
  );
}
