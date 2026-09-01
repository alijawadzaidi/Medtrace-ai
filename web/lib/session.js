'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';

/**
 * Who is signed in.
 *
 * The API issues a bearer JWT, so the token is kept in `localStorage` and sent
 * on the Authorization header. The honest trade-off: an httpOnly cookie would
 * be safer, because anything that manages to run script on this origin can
 * read `localStorage` and a cookie set httpOnly cannot be read at all. Moving
 * to cookies means the API has to set, refresh and clear them and every
 * request has to carry CSRF protection, which is a larger change than it
 * looks. Bearer tokens are what the API speaks today; the cookie migration is
 * written up as a known limitation rather than pretended away.
 *
 * The token is verified against `/auth/me` on load rather than trusted: it may
 * have expired, and the account behind it may have been deactivated since it
 * was issued.
 */
const STORAGE_KEY = 'medtrace.token';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, token: null });

  useEffect(() => {
    let active = true;
    const token = window.localStorage.getItem(STORAGE_KEY);
    const anonymous = { status: 'anonymous', user: null, token: null };

    // Every branch resolves through a promise so the state lands in an async
    // callback rather than synchronously inside the effect, which would
    // trigger a cascading render on every mount.
    const resolve = token
      ? api
          .me(token)
          .then(({ user }) => ({ status: 'authenticated', user, token }))
          .catch(() => {
            // Expired, revoked, or issued by a different deployment. Clearing
            // it here is what stops a stale token producing a 401 on every
            // page the user opens.
            window.localStorage.removeItem(STORAGE_KEY);
            return anonymous;
          })
      : Promise.resolve(anonymous);

    resolve.then((next) => {
      if (active) setState(next);
    });

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { token, user } = await api.login(email, password);
    window.localStorage.setItem(STORAGE_KEY, token);
    setState({ status: 'authenticated', user, token });
    return user;
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ status: 'anonymous', user: null, token: null });
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/** Convenience for the many screens that just need "GET this, with my token". */
export function roleLabel(role) {
  return { manufacturer: 'Manufacturer', distributor: 'Distributor', pharmacy: 'Pharmacy', regulator: 'Regulator' }[role] || role;
}
