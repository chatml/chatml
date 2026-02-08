import { useCallback } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

export function useOnboarding() {
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);
  const hasCompletedGuidedTour = useSettingsStore((s) => s.hasCompletedGuidedTour);
  const setHasCompletedOnboarding = useSettingsStore((s) => s.setHasCompletedOnboarding);
  const setHasCompletedGuidedTour = useSettingsStore((s) => s.setHasCompletedGuidedTour);
  const resetOnboarding = useSettingsStore((s) => s.resetOnboarding);

  const showWizard = !hasCompletedOnboarding;
  const showGuidedTour = hasCompletedOnboarding && !hasCompletedGuidedTour;

  const completeWizard = useCallback(() => {
    setHasCompletedOnboarding(true);
  }, [setHasCompletedOnboarding]);

  const completeTour = useCallback(() => {
    setHasCompletedGuidedTour(true);
  }, [setHasCompletedGuidedTour]);

  const skipAll = useCallback(() => {
    setHasCompletedOnboarding(true);
    setHasCompletedGuidedTour(true);
  }, [setHasCompletedOnboarding, setHasCompletedGuidedTour]);

  return {
    showWizard,
    showGuidedTour,
    completeWizard,
    completeTour,
    skipAll,
    resetOnboarding,
  };
}
