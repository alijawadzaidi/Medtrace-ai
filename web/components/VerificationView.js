'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { requestPosition } from '@/lib/geolocation';
import { VerdictBanner, WarningList, PackDetails, Journey } from '@/components/Verdict';

/**
 * Runs the check in the browser, on purpose.
 *
 * The API records the IP address and coordinates of whoever verifies a pack,
 * and those two fields are what let it notice that one serial was scanned in
 * Mumbai and Delhi twenty minutes apart. Rendering this on the server would
 * stamp every scan in the country with this application's own host, so the
 * page paints a shell first and the phone makes the call itself.
 */
export default function VerificationView({ serial }) {
  const [state, setState] = useState({ status: 'checking', result: null, error: null });
  const inFlight = useRef(null);

  useEffect(() => {
    // Every verification appends a scan event, so this must fire exactly once
    // per pack — in development React mounts, unmounts and remounts each
    // component, and a naive effect would log two scans for every page view.
    //
    // The guard therefore caches the *promise*, not a "started" flag. A flag
    // makes the second mount skip the work entirely and leaves the page stuck
    // on its loading state forever; re-attaching to the same promise gives
    // every mount the same single result.
    if (inFlight.current?.serial !== serial) {
      inFlight.current = {
        serial,
        // Location is asked for first, so the one verification request carries
        // coordinates when the customer allows it.
        promise: requestPosition().then((position) => api.verify(serial, position)),
      };
    }

    let active = true;
    inFlight.current.promise.then(
      (result) => active && setState({ status: 'done', result, error: null }),
      (error) => active && setState({ status: 'error', result: null, error })
    );

    return () => {
      active = false;
    };
  }, [serial]);

  if (state.status === 'checking') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm font-medium">Checking this pack…</p>
          <p className="serial mt-1 text-xs text-muted">{serial}</p>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
          </div>
          <p className="mt-3 text-xs text-muted">
            If your phone asks for your location, allowing it helps spot packs
            being scanned in two places at once. Declining is fine.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h1 className="text-xl font-semibold tracking-tight">We could not check this pack</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{state.error.message}</p>
          {/* Deliberately not a verdict: "we cannot tell you" and "this is fake"
              are different answers, and conflating them would be dangerous. */}
          <p className="mt-3 text-sm text-muted">
            This does not mean the pack is fake — only that the service could
            not be reached. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </section>
      </div>
    );
  }

  const { result } = state;

  return (
    <div className="space-y-4">
      <VerdictBanner result={result} />
      <WarningList warnings={result.warnings} />
      <PackDetails result={result} />
      <Journey journey={result.journey} />

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link
          href="/verify"
          className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Check another pack
        </Link>
        {result.severity !== 'ok' && (
          <span className="text-xs text-muted">
            Keep the pack and the receipt — a pharmacist or inspector will need both.
          </span>
        )}
      </div>
    </div>
  );
}
