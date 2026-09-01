/**
 * The one place that knows where the API lives.
 *
 * Every call here runs in the browser, not on the Next.js server. For the
 * public verification routes that is a correctness requirement rather than a
 * preference: the API stamps each scan with the caller's IP and coordinates,
 * so a server-side fetch would record this application's host for every scan
 * in the country and quietly destroy the geographic signal the whole project
 * rests on.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, token, signal } = {}) {
  let response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // A dead API and a failed lookup must not look the same to the user: one
    // means "we cannot tell you", the other means "this pack is fake".
    throw new ApiError('Cannot reach the MedTrace service. Check your connection.', 0);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || `Request failed (${response.status})`,
      response.status,
      payload?.error?.details
    );
  }

  return payload;
}

export const api = {
  /** Public verification. Coordinates are attached only if the customer allowed it. */
  verify(serial, position) {
    if (position) {
      return request('/verify', {
        method: 'POST',
        body: { serial, latitude: position.latitude, longitude: position.longitude },
      });
    }
    return request(`/verify/${encodeURIComponent(serial)}`);
  },

  login(email, password) {
    return request('/auth/login', { method: 'POST', body: { email, password } });
  },

  me(token) {
    return request('/auth/me', { token });
  },

  get: (path, token) => request(path, { token }),
  post: (path, body, token) => request(path, { method: 'POST', body, token }),
  patch: (path, body, token) => request(path, { method: 'PATCH', body, token }),
};
