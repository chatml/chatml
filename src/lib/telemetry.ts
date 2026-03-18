/**
 * Privacy-first analytics via Aptabase JS SDK.
 *
 * - Only active when NEXT_PUBLIC_APTABASE_KEY is set (release builds via CI).
 * - Respects the strictPrivacy setting — no events sent when enabled.
 * - Lazy initialization: Aptabase is initialized on first trackEvent call.
 */

import { init, trackEvent as aptaTrackEvent } from '@aptabase/web';

type EventProps = Record<string, string | number>;

const APTABASE_KEY = process.env.NEXT_PUBLIC_APTABASE_KEY ?? '';

let initialized = false;

function ensureInit(): boolean {
  if (!APTABASE_KEY) return false;
  if (initialized) return true;

  init(APTABASE_KEY);
  initialized = true;
  return true;
}

export async function trackEvent(name: string, props?: EventProps): Promise<void> {
  // Dynamic import to avoid circular dependency with store initialization
  const { useSettingsStore } = await import('@/stores/settingsStore');
  if (useSettingsStore.getState().strictPrivacy) return;

  if (!ensureInit()) return;
  aptaTrackEvent(name, props);
}
