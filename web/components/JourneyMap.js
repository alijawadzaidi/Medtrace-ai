'use client';

import { useMemo } from 'react';

import { eventLabel } from '@/lib/format';

/**
 * A pack's journey, plotted.
 *
 * Deliberately *not* a tiled basemap. Leaflet with OpenStreetMap tiles would
 * look more impressive and would go blank the moment the venue wifi does —
 * which the build plan flags as the single likeliest demo failure. This draws
 * only what the database actually holds: coordinates, in order, with a
 * graticule and a scale bar for geographic context. It works offline, needs no
 * dependency, and cannot break because someone else's tile server is slow.
 *
 * Read it as a schematic of relative positions rather than a map of India, and
 * label it as one on screen so nobody mistakes it for a survey.
 */
const WIDTH = 720;
const HEIGHT = 420;
const PADDING = 48;

const EARTH_RADIUS_KM = 6371;

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const TONE = {
  created: 'var(--brand)',
  dispatched: 'var(--warning)',
  received: 'var(--ok)',
  dispensed: 'var(--muted)',
  verified: 'var(--brand-strong)',
  flagged: 'var(--critical)',
};

export default function JourneyMap({ history }) {
  const plot = useMemo(() => {
    const points = (history || [])
      .filter((step) => step.location?.latitude != null)
      .map((step) => ({
        lat: Number(step.location.latitude),
        lng: Number(step.location.longitude),
        type: step.type,
        at: step.at,
        label: step.organization?.name || 'Public scan',
        city: step.organization?.city || null,
      }));

    if (points.length < 1) return null;

    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);

    // A single-city journey has zero extent, which would divide by zero and
    // stack every marker on one pixel. The floor gives it room to breathe.
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.6);
    const spanLng = Math.max(maxLng - minLng, 0.6);

    const centreLat = (minLat + maxLat) / 2;
    const centreLng = (minLng + maxLng) / 2;

    // Equirectangular, with longitude compressed by cos(latitude) so distances
    // are not stretched east-west. At these latitudes that is roughly a 12%
    // correction — visible enough to matter when the point is "how far apart".
    const scaleX = Math.cos((centreLat * Math.PI) / 180);

    const usableW = WIDTH - PADDING * 2;
    const usableH = HEIGHT - PADDING * 2;
    const scale = Math.min(usableW / (spanLng * scaleX), usableH / spanLat) * 0.85;

    const project = (lat, lng) => ({
      x: WIDTH / 2 + (lng - centreLng) * scaleX * scale,
      // SVG y grows downward; latitude grows north.
      y: HEIGHT / 2 - (lat - centreLat) * scale,
    });

    const placed = points.map((point, index) => ({ ...point, ...project(point.lat, point.lng), index }));

    // Collapse consecutive stops at the same place: five events in one
    // warehouse are one dot with a count, not five dots on top of each other.
    const stops = [];
    for (const point of placed) {
      const previous = stops[stops.length - 1];
      if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 6) {
        previous.events.push(point);
        previous.type = point.type;
        continue;
      }
      stops.push({ ...point, events: [point] });
    }

    const totalKm = placed.reduce(
      (sum, point, index) => (index === 0 ? 0 : sum + distanceKm(placed[index - 1], point)),
      0
    );

    // A scale bar in round kilometres, sized from the projection itself.
    const kmPerPixel = 111 / scale;
    const targetKm = Math.max(50, Math.round((kmPerPixel * 120) / 50) * 50);
    const barPixels = targetKm / kmPerPixel;

    return { stops, placed, totalKm, targetKm, barPixels, centreLat, centreLng, scale, scaleX };
  }, [history]);

  if (!plot) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No positions recorded for this pack yet.
      </p>
    );
  }

  const { stops, placed, totalKm, targetKm, barPixels } = plot;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-xl border border-border bg-surface-muted"
        role="img"
        aria-label={`Journey through ${stops.length} locations, about ${Math.round(totalKm)} kilometres in total`}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
          </marker>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="var(--border)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="url(#grid)" />

        {/* The route, drawn before the stops so markers sit on top of it. */}
        <polyline
          points={placed.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeDasharray="6 4"
          markerMid="url(#arrow)"
          markerEnd="url(#arrow)"
          opacity="0.7"
        />

        {stops.map((stop, index) => (
          <g key={`${stop.at}-${index}`}>
            <circle cx={stop.x} cy={stop.y} r="9" fill={TONE[stop.type] || 'var(--brand)'} opacity="0.25" />
            <circle cx={stop.x} cy={stop.y} r="5" fill={TONE[stop.type] || 'var(--brand)'} />
            <text
              x={stop.x + 11}
              y={stop.y + 4}
              fontSize="11"
              fill="var(--foreground)"
              className="font-sans"
            >
              {stop.city || stop.label}
              {stop.events.length > 1 ? ` (${stop.events.length})` : ''}
            </text>
          </g>
        ))}

        {/* Scale bar: without it a schematic invites the wrong conclusions. */}
        <g transform={`translate(${PADDING}, ${HEIGHT - 24})`}>
          <line x1="0" y1="0" x2={barPixels} y2="0" stroke="var(--muted)" strokeWidth="2" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="var(--muted)" strokeWidth="2" />
          <line x1={barPixels} y1="-4" x2={barPixels} y2="4" stroke="var(--muted)" strokeWidth="2" />
          <text x={barPixels / 2} y="-8" fontSize="10" textAnchor="middle" fill="var(--muted)">
            {targetKm} km
          </text>
        </g>
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {stops.length} location{stops.length === 1 ? '' : 's'} · about{' '}
          {Math.round(totalKm).toLocaleString()} km travelled
        </span>
        {['created', 'dispatched', 'received', 'verified'].map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: TONE[type] }}
            />
            {eventLabel(type)}
          </span>
        ))}
        <span className="opacity-70">
          Positions are plotted relative to one another, not on a basemap.
        </span>
      </div>
    </div>
  );
}
