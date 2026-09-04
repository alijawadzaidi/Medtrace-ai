'use client';

import { useState } from 'react';

import { API_URL, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, eventLabel } from '@/lib/format';
import JourneyMap from '@/components/JourneyMap';
import { Badge, Button, Card, ErrorNote, Input, Stat } from '@/components/ui';

/**
 * The staff view of a single pack: the same chain of custody a customer sees,
 * plus the actions their role allows. A pharmacy dispenses from here — the
 * terminal step, after which any further movement is a violation.
 */
export default function PackLookupPage() {
  const { user, token } = useSession();
  const [serial, setSerial] = useState('');
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [action, setAction] = useState({ busy: false, error: null, done: null });

  async function lookup(event) {
    event.preventDefault();
    const value = serial.trim();
    if (!value) return;

    setState({ loading: true, data: null, error: null });
    setAction({ busy: false, error: null, done: null });
    try {
      const data = await api.get(`/packs/${encodeURIComponent(value)}/history`, token);
      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  }

  async function dispense() {
    setAction({ busy: true, error: null, done: null });
    try {
      const result = await api.post(
        `/packs/${encodeURIComponent(state.data.pack.serial)}/dispense`,
        {},
        token
      );
      setAction({ busy: false, error: null, done: result.note });
      const data = await api.get(
        `/packs/${encodeURIComponent(state.data.pack.serial)}/history`,
        token
      );
      setState({ loading: false, data, error: null });
    } catch (error) {
      setAction({ busy: false, error, done: null });
    }
  }

  const pack = state.data?.pack;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Look up a pack</h1>
        <p className="mt-1 text-sm text-muted">
          Type or scan a serial to see everywhere it has been.
        </p>
      </header>

      <Card>
        <form onSubmit={lookup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label="Serial number"
            placeholder="MT-…"
            autoCapitalize="characters"
            spellCheck={false}
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            className="serial"
          />
          <Button type="submit" disabled={state.loading || !serial.trim()}>
            {state.loading ? 'Looking up…' : 'Look up'}
          </Button>
        </form>
        <ErrorNote error={state.error} className="mt-3" />
      </Card>

      {state.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Medicine" value={pack.medicine} hint={`batch ${pack.batchNo}`} />
            <Stat label="State" value={pack.state.replace(/_/g, ' ')} hint={pack.currentHolder || '—'} />
            <Stat label="Events" value={state.data.eventCount} hint="append-only" />
          </div>

          {(state.data.batchRecalled || state.data.expired) && (
            <ErrorNote
              error={{
                message: state.data.batchRecalled
                  ? 'This pack belongs to a recalled batch. It must not be dispensed or shipped.'
                  : 'This pack is past its expiry date.',
              }}
            />
          )}

          <Card title="Journey">
            <JourneyMap history={state.data.history} />
          </Card>

          <Card
            title="Chain of custody"
            action={
              <a
                href={`${API_URL}/packs/${encodeURIComponent(pack.serial)}/qr.png`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-brand"
              >
                QR image →
              </a>
            }
          >
            <ol className="space-y-0">
              {state.data.history.map((step, index) => (
                <li key={`${step.at}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < state.data.history.length - 1 && (
                    <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-border" />
                  )}
                  <span
                    aria-hidden
                    className="relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{eventLabel(step.type)}</p>
                    <p className="text-sm text-muted">
                      {step.organization
                        ? `${step.organization.name}${step.organization.city ? `, ${step.organization.city}` : ''}`
                        : 'Public scan — no organization'}
                      {step.location
                        ? ` · ${Number(step.location.latitude).toFixed(2)}, ${Number(step.location.longitude).toFixed(2)}`
                        : ''}
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(step.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {/* Dispensing is the terminal step, and only a pharmacy holding the
              pack may take it. The API checks both again. */}
          {user.role === 'pharmacy' && pack.state === 'received' && (
            <Card title="Dispense to a patient">
              <p className="mb-3 text-sm text-muted">
                This is final. After it, any further movement of this pack is a
                chain-of-custody violation.
              </p>
              <Button onClick={dispense} disabled={action.busy}>
                {action.busy ? 'Recording…' : 'Dispense this pack'}
              </Button>
              <ErrorNote error={action.error} className="mt-3" />
              {action.done && (
                <p className="mt-3 rounded-xl border border-ok/40 bg-ok-surface p-3 text-sm">
                  {action.done}
                </p>
              )}
            </Card>
          )}

          {pack.state === 'dispensed' && (
            <Card title="Dispensed">
              <p className="text-sm text-muted">
                This pack has been handed to a patient. <Badge>dispensed</Badge>
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
