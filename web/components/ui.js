'use client';

/** The handful of primitives every dashboard screen is built from. */

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-brand text-background hover:opacity-90',
    secondary: 'border border-border hover:border-brand hover:text-brand',
    danger: 'border border-critical/50 text-critical hover:bg-critical-surface',
  };
  return (
    <button
      className={`rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ label, hint, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium">{label}</span>}
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <input
        className={`mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand ${className}`}
        {...props}
      />
    </label>
  );
}

export function Select({ label, children, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium">{label}</span>}
      <select
        className={`mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

/**
 * A pack state or batch status. The colour is a shortcut for people who
 * already know the states; the word is there for everyone else.
 */
const TONES = {
  neutral: 'border-border text-muted',
  ok: 'border-ok/40 bg-ok-surface text-ok',
  warning: 'border-warning/40 bg-warning-surface text-warning',
  critical: 'border-critical/40 bg-critical-surface text-critical',
};

const STATE_TONES = {
  created: 'neutral',
  in_transit: 'warning',
  received: 'ok',
  dispensed: 'neutral',
  destroyed: 'critical',
  active: 'ok',
  recalled: 'critical',
  expired: 'warning',
  draft: 'neutral',
  cancelled: 'neutral',
};

export function Badge({ children, tone }) {
  const resolved = tone || STATE_TONES[children] || 'neutral';
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[resolved]}`}
    >
      {String(children).replace(/_/g, ' ')}
    </span>
  );
}

export function Empty({ children }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading({ label = 'Loading…' }) {
  return <p className="py-6 text-center text-sm text-muted">{label}</p>;
}

export function ErrorNote({ error, className = '' }) {
  if (!error) return null;
  return (
    <p
      className={`rounded-xl border border-critical/40 bg-critical-surface p-3 text-sm ${className}`}
    >
      {error.message}
      {error.details?.length ? (
        <span className="mt-1 block text-xs opacity-80">
          {error.details.map((d) => `${d.field}: ${d.message}`).join(' · ')}
        </span>
      ) : null}
    </p>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
