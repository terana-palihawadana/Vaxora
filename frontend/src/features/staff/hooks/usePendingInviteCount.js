import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import staffService from '../../hospital/services/staffService';

/**
 * Number of hospital invitations waiting for this doctor or nurse (for the nav badge).
 * Re-checked on every page change so the badge clears after an invite is answered.
 */
export default function usePendingInviteCount() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);

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
  }), [pathname]);

  return count;
}
