'use strict';

/**
 * Coarse geolocation for public scans.
 *
 * Two positions can reach us for a customer scan, in decreasing quality:
 *
 *   1. Browser geolocation, sent in the request body after the customer grants
 *      permission. Accurate, but optional — most people decline.
 *   2. Headers set by a CDN or hosting platform from the client IP. Always
 *      present in production, city-level at best.
 *
 * Both are deliberately blunted before storage. A public scan is an ordinary
 * member of the public standing somewhere, and this service has no business
 * recording exactly where they were. Rounding to two decimal places (~1.1 km)
 * keeps every feature the detector needs — implied travel speed between
 * consecutive scans, distinct-region counts — and discards the rest.
 *
 * The same reasoning applies to the IP address: it is truncated, never stored
 * whole, so scans can still be grouped by rough origin without the table
 * becoming a log of who scanned what.
 */

const PUBLIC_PRECISION = 2; // ~1.1 km
const EARTH_RADIUS_KM = 6371;

function round(value, places = PUBLIC_PRECISION) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(places));
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lng)) <= 180 &&
    // 0,0 is the Gulf of Guinea. In practice it means "the client sent nothing
    // useful", and treating it as a real position produces absurd distances.
    !(Number(lat) === 0 && Number(lng) === 0)
  );
}

/** Reads whichever platform header set is present. Returns null if none is. */
function fromHeaders(req) {
  const get = (name) => req.get(name) || null;

  const candidates = [
    { lat: get('x-vercel-ip-latitude'), lng: get('x-vercel-ip-longitude'), city: get('x-vercel-ip-city'), country: get('x-vercel-ip-country'), source: 'platform-header' },
    { lat: get('cf-iplatitude'), lng: get('cf-iplongitude'), city: get('cf-ipcity'), country: get('cf-ipcountry'), source: 'platform-header' },
    { lat: get('x-client-latitude'), lng: get('x-client-longitude'), city: null, country: null, source: 'proxy-header' },
  ];

  for (const c of candidates) {
    if (c.lat && c.lng && isValidLatLng(c.lat, c.lng)) {
      return {
        latitude: round(c.lat),
        longitude: round(c.lng),
        city: c.city ? decodeURIComponent(c.city) : null,
        country: c.country || null,
        source: c.source,
        precision: 'coarse',
      };
    }
  }
  return null;
}

/**
 * Resolves the best available position for a public scan. Browser coordinates
 * win when the customer supplied them, because a declined permission prompt is
 * the common case and a CDN header is a poor substitute.
 */
function resolve(req, body = {}) {
  if (isValidLatLng(body.latitude, body.longitude)) {
    return {
      latitude: round(body.latitude),
      longitude: round(body.longitude),
      city: null,
      country: null,
      source: 'browser',
      precision: 'coarse',
    };
  }
  return fromHeaders(req);
}

/**
 * Truncates an address to its network: the last octet of an IPv4, the last 80
 * bits of an IPv6. Enough to group scans by rough origin and to rate-limit
 * repeat traffic; not enough to identify a person.
 */
function truncateIp(ip) {
  if (!ip) return null;
  const value = String(ip).replace(/^::ffff:/, '');

  if (value.includes(':')) {
    const groups = value.split(':').filter(Boolean).slice(0, 3);
    return `${groups.join(':')}::/48`;
  }

  const octets = value.split('.');
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

/** Great-circle distance in kilometres. */
function distanceKm(a, b) {
  if (!a || !b) return null;
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }

  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(b.latitude) - toRad(a.latitude);
  const dLng = toRad(b.longitude) - toRad(a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Two events at the same instant in different places are not a speed, they are
 * a contradiction — no division produces a meaningful number. This constant
 * stands in for that case: finite, so it survives JSON and comparisons, and
 * far enough above any real velocity that callers can recognise it.
 *
 * It must never reach a human as a number. `MAX_SAFE_INTEGER` used to be used
 * here and produced the alert "implies a travel speed of 9007199254740991
 * km/h", which tells a regulator nothing except that something is broken.
 */
const SAME_INSTANT_KMH = 1_000_000;

/**
 * Implied velocity between two positioned events. The single strongest signal
 * that one serial exists in two places: a genuine pack cannot outrun a plane.
 */
function impliedSpeedKmh(from, to) {
  const km = distanceKm(from, to);
  if (km == null) return null;

  const hours = (new Date(to.at) - new Date(from.at)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) {
    return km > 1 ? SAME_INSTANT_KMH : 0;
  }
  return km / hours;
}

module.exports = {
  PUBLIC_PRECISION,
  SAME_INSTANT_KMH,
  round,
  isValidLatLng,
  fromHeaders,
  resolve,
  truncateIp,
  distanceKm,
  impliedSpeedKmh,
};
