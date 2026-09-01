'use client';

import { useState } from 'react';

import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Select, Stat } from '@/components/ui';

/**
 * Alert triage.
 *
 * The queue is sorted worst-first rather than newest-first: a regulator who
 * has to scroll past fifty informational alerts to find the critical one is a
 * regulator who will stop looking. Each alert carries the features that
 * produced it, because "why was this flagged" is the first question anyone
 * asks and "the model said so" is not an answer.
 */
const STATUSES = ['open', 'investigating', 'confirmed', 'dismissed'];

const RULE_LABELS = {
  impossible_travel: 'Impossible travel',
  dispensed_elsewhere: 'Dispensed, then seen elsewhere',
  custody_skip: 'Custody skip',
  expired_stock: 'Expired stock still moving',
  recalled_in_circulation: 'Recalled stock in circulation',
  scan_storm: 'Scan storm',
  anomaly_score: 'Flagged by the model',
};

export default function AlertsPage() {
  const { token } = useSession();
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');

  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);
  if (severity) query.set('severity', severity);

  const alerts = useApi(`/alerts?${query.toString()}`);
  const scorer = useApi('/detection/health');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [sweep, setSweep] = useState(null);

  async function triage(alert, next) {
    setBusy(alert.id);
    setError(null);
    try {
      await api.patch(`/alerts/${alert.id}`, { status: next }, token);
      await alerts.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function runDetection() {
    setBusy('sweep');
    setError(null);
    setSweep(null);
    try {
      const result = await api.post('/detection/run', {}, token);
      setSweep(result);
      await alerts.refresh();
      await scorer.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const rows = alerts.data?.alerts || [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-sm text-muted">
            What the rules and the model found, worst first.
          </p>
        </div>
        <Button onClick={runDetection} disabled={busy === 'sweep'}>
          {busy === 'sweep' ? 'Scoring every pack…' : 'Run detection'}
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open" value={alerts.loading ? '—' : alerts.data?.open ?? 0} hint="awaiting triage" />
        <Stat
          label="Matching filters"
          value={alerts.loading ? '—' : alerts.data?.total ?? 0}
          hint={`${status || 'any status'}${severity ? ` · ${severity}` : ''}`}
        />
        {/* The scorer being down is a state worth showing rather than hiding:
            the rules still run, and a regulator should know the difference. */}
        <Stat
          label="Model"
          value={scorer.loading ? '—' : scorer.data?.status === 'ok' ? 'online' : 'offline'}
          hint={
            scorer.data?.status === 'ok'
              ? scorer.data.model
              : 'rules still run without it'
          }
        />
      </div>

      {sweep && (
        <p className="rounded-xl border border-ok/40 bg-ok-surface p-3 text-sm">
          Scored {sweep.evaluated} packs — {sweep.alertsCreated} new alerts, {sweep.alertsUpdated} updated.
          {sweep.note ? ` ${sweep.note}` : ''}
        </p>
      )}

      <ErrorNote error={error || alerts.error} />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Any severity</option>
            <option value="critical">critical</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </Select>
        </div>

        {alerts.loading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty>Nothing to triage. Run detection to score the catalogue again.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((alert) => (
              <li key={alert.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'neutral'}>
                        {alert.severity}
                      </Badge>
                      <span className="text-sm font-medium">
                        {RULE_LABELS[alert.rule] || alert.rule}
                      </span>
                      {alert.score != null && (
                        <span className="text-xs text-muted">score {alert.score.toFixed(2)}</span>
                      )}
                      <Badge>{alert.status}</Badge>
                    </div>

                    <p className="mt-1.5 text-sm">{alert.summary}</p>

                    <p className="serial mt-1 text-xs text-muted">
                      {alert.pack?.serial}
                      {alert.batch?.batchNo ? ` · ${alert.batch.batchNo}` : ''}
                      {alert.pack?.currentOrganization?.name
                        ? ` · held by ${alert.pack.currentOrganization.name}`
                        : ''}
                      {` · ${formatDateTime(alert.createdAt)}`}
                    </p>

                    {alert.details?.features && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-brand">
                          Why this was flagged
                        </summary>
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                          {Object.entries(alert.details.features).map(([name, value]) => (
                            <div key={name}>
                              <dt className="text-[11px] uppercase tracking-wide text-muted">
                                {name.replace(/_/g, ' ')}
                              </dt>
                              <dd className="serial text-xs">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {alert.status !== 'investigating' && alert.status !== 'confirmed' && (
                      <Button variant="secondary" onClick={() => triage(alert, 'investigating')} disabled={busy === alert.id}>
                        Investigate
                      </Button>
                    )}
                    {alert.status !== 'confirmed' && (
                      <Button onClick={() => triage(alert, 'confirmed')} disabled={busy === alert.id}>
                        Confirm
                      </Button>
                    )}
                    {alert.status !== 'dismissed' && (
                      <Button variant="danger" onClick={() => triage(alert, 'dismissed')} disabled={busy === alert.id}>
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
