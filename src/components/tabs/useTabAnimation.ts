'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ANIMATION_DURATION } from './tab.types';

/**
 * Hook for managing tab open/close animations
 *
 * Features:
 * - Tracks which tabs are currently animating (opening/closing)
 * - Provides functions to start close animation
 * - Handles cleanup after animation completes
 */
export function useTabAnimation() {
  const [closingTabs, setClosingTabs] = useState<Set<string>>(new Set());
  const [openingTabs, setOpeningTabs] = useState<Set<string>>(new Set());
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup all pending timeouts on unmount
  useEffect(() => {
    const refs = timeoutRefs.current;
    return () => {
      refs.forEach((timeout) => clearTimeout(timeout));
      refs.clear();
    };
  }, []);

  // Start closing animation for a tab
  const startClose = useCallback(
    (tabId: string, onComplete: () => void) => {
      // Mark tab as closing
      setClosingTabs((prev) => new Set([...prev, tabId]));

      // Schedule completion after animation duration
      const timeout = setTimeout(() => {
        setClosingTabs((prev) => {
          const next = new Set(prev);
          next.delete(tabId);
          return next;
        });
        timeoutRefs.current.delete(tabId);
        onComplete();
      }, ANIMATION_DURATION);

      timeoutRefs.current.set(tabId, timeout);
    },
    []
  );

  // Mark a tab as opening (for new tabs)
  const startOpen = useCallback((tabId: string) => {
    setOpeningTabs((prev) => new Set([...prev, tabId]));

    // Remove opening state after animation
    const timeout = setTimeout(() => {
      setOpeningTabs((prev) => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
    }, ANIMATION_DURATION);

    timeoutRefs.current.set(`open-${tabId}`, timeout);
  }, []);

  // Cancel a pending close animation (e.g., if user cancels)
  const cancelClose = useCallback((tabId: string) => {
    const timeout = timeoutRefs.current.get(tabId);
    if (timeout) {
      clearTimeout(timeout);
      timeoutRefs.current.delete(tabId);
    }
    setClosingTabs((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  // Check if a tab is currently closing
  const isClosing = useCallback(
    (tabId: string) => closingTabs.has(tabId),
    [closingTabs]
  );

  // Check if a tab is currently opening
  const isOpening = useCallback(
    (tabId: string) => openingTabs.has(tabId),
    [openingTabs]
  );

  return {
    closingTabs,
    openingTabs,
    startClose,
    startOpen,
    cancelClose,
    isClosing,
    isOpening,
  };
}
