/**
 * Telemetry stub — aptabase removed due to Tokio runtime panic in release builds.
 * See: https://github.com/aptabase/tauri-plugin-aptabase/issues/22
 */

type EventProps = Record<string, string | number>;

export async function trackEvent(_name: string, _props?: EventProps): Promise<void> {
  // no-op
}
