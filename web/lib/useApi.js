'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Load a resource for the signed-in user.
 *
 * Every dashboard screen needs the same four states — loading, loaded, failed,
 * and reload-after-an-action — and writing them out per screen is how they
 * drift apart. `refresh` exists because almost every action here (dispatch,
 * receive, recall) changes the list the user is looking at.
 */
export function useApi(path, { skip = false } = {}) {
  const { token, status } = useSession();
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    if (skip || status !== 'authenticated') return undefined;

    // The result is applied in a promise callback rather than by awaiting
    // inside the effect body: a synchronous setState there cascades an extra
    // render on every mount, and React's lint rule is right to object.
    let active = true;
    api.get(path, token).then(
      (data) => active && setState({ loading: false, data, error: null }),
      (error) => active && setState({ loading: false, data: null, error })
    );

    return () => {
      active = false;
    };
  }, [path, token, status, skip]);

  /**
   * Re-fetch after an action. Deliberately leaves the current rows on screen
   * while it runs — blanking a table the user is reading is a worse answer
   * than showing it a second out of date.
   */
  const refresh = useCallback(async () => {
    if (skip || status !== 'authenticated') return;
    try {
      const data = await api.get(path, token);
      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  }, [path, token, status, skip]);

  return { ...state, refresh };
}
