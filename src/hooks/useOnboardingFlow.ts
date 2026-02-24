'use client';

import { useEffect, useRef } from 'react';
import { setOnboardingWindowSize, restoreDefaultWindowSize } from '@/lib/tauri';

/**
 * Manages onboarding ↔ app window size transitions.
 *
 * On first launch the Tauri config starts at the compact onboarding size.
 * For returning users, tauri_plugin_window_state restores their saved size.
 * This hook handles the transition when auth completes.
 */
export function useOnboardingFlow(isInOnboarding: boolean, authLoading: boolean) {
  const onboardingResolved = useRef(false);

  useEffect(() => {
    if (authLoading) return;

    if (!onboardingResolved.current) {
      // First time auth resolved — set initial window state
      onboardingResolved.current = true;
      if (isInOnboarding) {
        setOnboardingWindowSize();
      }
      // If not in onboarding (returning user), do nothing — let window state plugin handle it
      return;
    }

    // Transition: was in onboarding, now past it → restore default window
    if (!isInOnboarding) {
      restoreDefaultWindowSize();
    }
  }, [isInOnboarding, authLoading]);
}
