import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import staffService from '../../hospital/services/staffService';

const INVITES_CHANGED_EVENT = 'vaxora:invites-changed';

/** Call after an invitation is accepted or rejected so the nav badge updates at once. */
export function notifyInvitesChanged() {
  window.dispatchEvent(new Event(INVITES_CHANGED_EVENT));
}

/**
 * Number of hospital invitations waiting for this doctor or nurse (for the nav badge).
 * Re-checked on every page change so the badge clears after an invite is answered.
 */
export default function usePendingInviteCount() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const onChanged = () => setRefreshKey((key) => key + 1);
    window.addEventListener(INVITES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INVITES_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => deferEffectCallback(() => {
    let cancelled = false;
    staffService
      .getMyInvitations()
      .then((list) => {
        if (!cancelled) setCount(Array.isArray(list) ? list.length : 0);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }), [pathname, refreshKey]);

  return count;
}
