'use client';

import { useState, useCallback, useEffect, type RefObject } from 'react';
import { SCROLL_AMOUNT } from './tab.types';
import type { TabScrollState } from './tab.types';

/**
 * Hook for managing tab bar scroll behavior
 *
 * Features:
 * - Tracks whether scrolling is possible in each direction
 * - Provides smooth scroll functions
 * - Auto-scrolls active tab into view
 */
export function useTabScroll(
  scrollRef: RefObject<HTMLDivElement | null>
): TabScrollState {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll position and update state
  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 0);
    // Add small buffer (1px) to avoid floating point issues
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, [scrollRef]);

  // Scroll left by SCROLL_AMOUNT pixels
  const scrollLeft = useCallback(() => {
    scrollRef.current?.scrollBy({
      left: -SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  }, [scrollRef]);

  // Scroll right by SCROLL_AMOUNT pixels
  const scrollRight = useCallback(() => {
    scrollRef.current?.scrollBy({
      left: SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  }, [scrollRef]);

  // Scroll a specific tab into view
  const scrollToTab = useCallback(
    (tabId: string) => {
      const tabElement = scrollRef.current?.querySelector(
        `[data-tab-id="${tabId}"]`
      );
      if (tabElement) {
        tabElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    },
    [scrollRef]
  );

  // Set up scroll event listener and resize observer.
  // All three triggers (scroll, resize, mutation) are batched through rAF
  // so checkScroll runs at most once per frame even when multiple fire together.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Check initial scroll state
    checkScroll();

    let rafPending = false;
    let rafId = 0;
    const scheduleCheck = () => {
      if (rafPending) return;
      rafPending = true;
      rafId = requestAnimationFrame(() => {
        rafPending = false;
        checkScroll();
      });
    };

    // Listen to scroll events
    el.addEventListener('scroll', scheduleCheck, { passive: true });

    // Listen to resize events (tabs may overflow differently)
    const resizeObserver = new ResizeObserver(scheduleCheck);
    resizeObserver.observe(el);

    // Observe child and subtree changes — subtree is needed so that tab label
    // renames (text node mutations inside tab elements) trigger a scroll check
    // when the new width pushes content past the overflow boundary.
    const mutationObserver = new MutationObserver(scheduleCheck);
    mutationObserver.observe(el, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', scheduleCheck);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scrollRef, checkScroll]);

  return {
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    scrollToTab,
  };
}
