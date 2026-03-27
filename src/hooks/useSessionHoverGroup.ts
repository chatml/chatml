import { useCallback, useEffect, useRef } from 'react';

// Module-level shared state — avoids re-rendering all rows when one opens
let isAnyHoverCardOpen = false;
let resetTimerId: ReturnType<typeof setTimeout> | null = null;

const RESET_DELAY = 300; // ms after last close before resetting to slow open
export const INITIAL_OPEN_DELAY = 500;

export function useSessionHoverGroup() {
  const isOpenRef = useRef(false);

  const notifyOpen = useCallback(() => {
    if (resetTimerId !== null) {
      clearTimeout(resetTimerId);
      resetTimerId = null;
    }
    isAnyHoverCardOpen = true;
    isOpenRef.current = true;
  }, []);

  const notifyClose = useCallback(() => {
    isOpenRef.current = false;
    if (resetTimerId !== null) {
      clearTimeout(resetTimerId);
    }
    resetTimerId = setTimeout(() => {
      isAnyHoverCardOpen = false;
      resetTimerId = null;
    }, RESET_DELAY);
  }, []);

  const getOpenDelay = useCallback(() => {
    return isAnyHoverCardOpen ? 0 : INITIAL_OPEN_DELAY;
  }, []);

  // Clean up on unmount — if this instance had an open hover card, notify close
  useEffect(() => {
    return () => {
      if (isOpenRef.current) {
        notifyClose();
      }
    };
  }, [notifyClose]);

  return { getOpenDelay, notifyOpen, notifyClose };
}
