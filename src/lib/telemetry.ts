/**
 * Privacy-first analytics via Aptabase JS SDK.
 *
 * - Only active when NEXT_PUBLIC_APTABASE_KEY is set (release builds via CI).
 * - Respects the strictPrivacy setting — no events sent when enabled.
 * - Fully lazy: @aptabase/web is only imported on first trackEvent call,
 *   so it never interferes with module loading in any environment.
 */

type EventProps = Record<string, string | number>;

const APTABASE_KEY = process.env.NEXT_PUBLIC_APTABASE_KEY ?? '';

let initialized = false;
let aptaTrack: ((name: string, props?: EventProps) => void) | null = null;

async function ensureInit(): Promise<boolean> {
  if (!APTABASE_KEY) return false;
  if (initialized) return true;

  try {
    const { init, trackEvent: track } = await import('@aptabase/web');
    init(APTABASE_KEY);
    aptaTrack = track;
    initialized = true;
    return true;
  } catch (e) {
    console.warn('[telemetry] Failed to initialize Aptabase:', e);
    return false;
  }
}

export async function trackEvent(name: string, props?: EventProps): Promise<void> {
  // Dynamic import to avoid circular dependency with store initialization
  const { useSettingsStore } = await import('@/stores/settingsStore');
  if (useSettingsStore.getState().strictPrivacy) return;

  if (!(await ensureInit())) return;
  aptaTrack?.(name, props);
}
