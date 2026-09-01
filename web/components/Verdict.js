import { formatDate, formatDateTime, eventLabel } from '@/lib/format';

/**
 * The verdict is the whole product. Everything else on the page is supporting
 * evidence, so the top of the screen answers the only question the customer
 * actually has — can I take this? — before they read a word of detail.
 *
 * Colour never carries the meaning alone. A red panel and an amber panel look
 * identical to a colour-blind reader and to anyone standing under a pharmacy's
 * fluorescent light, so each verdict also states its own status in words.
 */
const STYLES = {
  ok: {
    panel: 'border-ok/40 bg-ok-surface',
    dot: 'bg-ok',
    label: 'text-ok',
    icon: '✓',
  },
  warning: {
    panel: 'border-warning/40 bg-warning-surface',
    dot: 'bg-warning',
    label: 'text-warning',
    icon: '!',
  },
  critical: {
    panel: 'border-critical/40 bg-critical-surface',
    dot: 'bg-critical',
    label: 'text-critical',
    icon: '✕',
  },
};

export function VerdictBanner({ result }) {
  const style = STYLES[result.severity] || STYLES.warning;

  return (
    <section className={`rounded-2xl border p-5 ${style.panel}`} aria-live="polite">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-background ${style.dot}`}
        >
          {style.icon}
        </span>
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-wider ${style.label}`}>
            {result.severity === 'ok' ? 'Verified genuine' : `${result.verdict} · action needed`}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{result.headline}</h1>
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">{result.message}</p>
        </div>
      </div>
    </section>
  );
}

export function WarningList({ warnings }) {
  if (!warnings?.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        What looks wrong
      </h2>
      <ul className="space-y-2">
        {warnings.map((warning) => (
          <li
            key={warning.code}
            className={`rounded-xl border p-3 text-sm ${
              warning.severity === 'critical'
                ? 'border-critical/40 bg-critical-surface'
                : 'border-warning/40 bg-warning-surface'
            }`}
          >
            <span className="font-medium capitalize">
              {warning.code.replace(/_/g, ' ')}
            </span>
            <p className="mt-1 leading-relaxed text-foreground/80">{warning.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}

export function PackDetails({ result }) {
  const { medicine, batch, pack } = result;
  if (!medicine) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold tracking-tight">
        {medicine.name} {medicine.strength}
      </h2>
      <p className="mt-0.5 text-sm text-muted">
        {medicine.genericName ? `${medicine.genericName} · ` : ''}
        {medicine.form}
        {medicine.packSize ? ` · ${medicine.packSize}` : ''}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Field label="Made by" value={medicine.manufacturer} />
        <Field label="Made in" value={medicine.manufacturerCity} />
        <Field label="Batch" value={batch.batchNo} />
        <Field label="Expires" value={formatDate(batch.expiresOn)} />
        <Field label="Currently held by" value={pack.currentHolder?.name} />
        <Field label="Times verified" value={pack.timesVerified} />
      </dl>

      <p className="serial mt-4 border-t border-border pt-3 text-xs text-muted">
        {result.serial}
      </p>
    </section>
  );
}

/**
 * The journey is the part people do not expect to exist, and the part that
 * makes the verdict believable: a real pack has a plausible history, and a
 * cloned one does not.
 */
export function Journey({ journey }) {
  if (!journey?.length) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        Where this pack has been
      </h2>

      <ol className="mt-4 space-y-0">
        {journey.map((step, index) => (
          <li key={`${step.at}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
            {index < journey.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[5px] top-3 h-full w-px bg-border"
              />
            )}
            <span
              aria-hidden
              className="relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{eventLabel(step.event)}</p>
              <p className="text-sm text-muted">
                {step.organization
                  ? `${step.organization.name}${step.organization.city ? `, ${step.organization.city}` : ''}`
                  : 'Public verification'}
              </p>
              <p className="text-xs text-muted">{formatDateTime(step.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
