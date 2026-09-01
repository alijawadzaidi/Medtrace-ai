'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import Scanner from '@/components/Scanner';

/**
 * How a customer without a working camera gets an answer.
 *
 * The manual field is not a fallback bolted on for the demo — camera access
 * needs HTTPS, a permission and hardware that works, and one of those fails
 * often enough that a typed serial has to be a first-class path. The serial
 * format was designed for exactly this: Crockford base32 has no I/1 or O/0
 * confusion, and a check character catches most typos before the network is
 * touched.
 */
export default function VerifyPage() {
  const router = useRouter();
  const [serial, setSerial] = useState('');
  const [scanning, setScanning] = useState(false);

  const go = useCallback(
    (value) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return;
      router.push(`/v/${encodeURIComponent(trimmed)}`);
    },
    [router]
  );

  const onScanned = useCallback(
    (value) => {
      setScanning(false);
      go(value);
    },
    [go]
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Check a pack</h1>
        <p className="mt-1 text-sm text-muted">
          Scan the QR code on the box, or type the serial number printed beneath it.
          No account needed.
        </p>
      </header>

      {scanning ? (
        <Scanner onResult={onScanned} onClose={() => setScanning(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="w-full rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          Scan with camera
        </button>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          go(serial);
        }}
        className="rounded-2xl border border-border bg-surface p-5"
      >
        <label htmlFor="serial" className="text-sm font-medium">
          Or type the serial number
        </label>
        <p className="mt-1 text-xs text-muted">
          It looks like <span className="serial">MT-7K2M9P-XQ4T8HRW2VNB4</span>.
          Capitals and dashes do not matter.
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="serial"
            name="serial"
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            placeholder="MT-…"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="serial w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand"
          />
          <button
            type="submit"
            disabled={!serial.trim()}
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Check
          </button>
        </div>
      </form>
    </div>
  );
}
