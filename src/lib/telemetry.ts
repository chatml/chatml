/**
 * Telemetry wrapper using Aptabase for privacy-first product analytics.
 * Events are only sent in production builds and when strictPrivacy is disabled.
 */

import { useSettingsStore } from '@/stores/settingsStore';
import { isTauri } from '@/lib/tauri';

type EventProps = Record<string, string | number>;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function isEnabled(): boolean {
  return IS_PRODUCTION && isTauri() && !useSettingsStore.getState().strictPrivacy;
}

export async function trackEvent(name: string, props?: EventProps): Promise<void> {
  if (!isEnabled()) return;
  try {
    const { trackEvent: track } = await import('@aptabase/tauri');
    await track(name, props);
  } catch {
    // Silently fail — telemetry should never break the app
  }
}
