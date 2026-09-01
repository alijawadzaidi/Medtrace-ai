'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The camera scanner.
 *
 * Two things about this component are not optional in the real world:
 *
 * 1. **It is loaded only in the browser, on demand.** `html5-qrcode` reaches
 *    for `navigator` and `document` at import time, so a static import would
 *    break the server render. It is also 300 KB that a customer who types
 *    their serial by hand should never download.
 * 2. **It can always be skipped.** Camera access needs HTTPS (or localhost),
 *    a granted permission and a working camera. All three fail regularly, on
 *    the demo day as much as anywhere else, so the manual entry field beside
 *    this is a permanent fixture rather than a fallback.
 */
const REGION_ID = 'medtrace-scanner-region';

/**
 * A scan yields whatever is encoded in the QR — for MedTrace labels that is a
 * verification URL, not a bare serial. Accept both: a customer may also scan a
 * code from a different system entirely, and taking the last path segment of
 * anything URL-shaped is the tolerant reading.
 */
export function serialFromScan(text) {
  const value = String(text || '').trim();

  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] || '');
  } catch {
    return value;
  }
}

export default function Scanner({ onResult, onClose }) {
  const [error, setError] = useState(null);
  const scannerRef = useRef(null);
  const handledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' }, // the rear camera: nobody scans a box with a selfie camera
          {
            fps: 10,
            // A square box sized to the viewport keeps the guide visible on a
            // narrow phone without cropping the code on a wide one.
            qrbox: (viewWidth, viewHeight) => {
              const edge = Math.floor(Math.min(viewWidth, viewHeight) * 0.7);
              return { width: edge, height: edge };
            },
          },
          (decoded) => {
            // The camera fires continuously; without this guard one steady
            // hand produces a dozen verifications of the same pack.
            if (handledRef.current) return;
            handledRef.current = true;
            onResult(serialFromScan(decoded));
          },
          () => {
            // Per-frame decode failures are the normal state of a camera
            // pointed at nothing in particular. Silence is correct here.
          }
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.message?.includes('Permission') || err?.name === 'NotAllowedError'
              ? 'Camera permission was declined. Type the serial number instead.'
              : 'The camera could not be started. Type the serial number instead.'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      // stop() rejects if the camera never started; nothing useful to do with
      // that on the way out.
      if (scanner?.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [onResult]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between pb-3">
        <p className="text-sm font-medium">Point the camera at the QR code</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand"
        >
          Close
        </button>
      </div>

      <div
        id={REGION_ID}
        className="overflow-hidden rounded-xl bg-black/80 [&_video]:w-full"
      />

      {error && (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning-surface p-3 text-sm">
          {error}
        </p>
      )}

      <p className="mt-3 text-xs text-muted">
        The camera needs a secure connection (HTTPS) and your permission. Nothing
        is uploaded except the serial number printed on the box.
      </p>
    </div>
  );
}
