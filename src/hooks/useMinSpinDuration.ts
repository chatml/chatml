'use client';

import { useState, useLayoutEffect, useRef } from 'react';

export const MIN_SPIN_MS = 500;

/**
 * Stretch a transient `loading` true into a visible spin so users see feedback
 * when a refresh is fast (or a no-op because data didn't change).
 *
 * Uses useLayoutEffect to flip `holding` to true synchronously *before* the
 * browser paints the loading→idle transition. This avoids the one-frame gap
 * where `loading=false` and `holding=false` would render the spinner off.
 */
export function useMinSpinDuration(
  loading: boolean,
  minMs: number = MIN_SPIN_MS,
): boolean {
  const [holding, setHolding] = useState(false);
  const startRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLoadingRef = useRef(false);

  useLayoutEffect(() => {
    if (loading) {
      startRef.current = Date.now();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else if (prevLoadingRef.current) {
      // Just transitioned from loading to idle.
      const elapsed = startRef.current ? Date.now() - startRef.current : minMs;
      startRef.current = null;
      const remaining = Math.max(0, minMs - elapsed);
      if (remaining > 0) {
        // Sync setState in useLayoutEffect is deliberate: flip holding=true
        // before paint so the spinner doesn't blink off between frames.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHolding(true);
        timerRef.current = setTimeout(() => {
          setHolding(false);
          timerRef.current = null;
        }, remaining);
      } else {
        // Load took longer than minMs — release any leftover holding.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHolding(false);
      }
    }
    prevLoadingRef.current = loading;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loading, minMs]);

  return loading || holding;
}
