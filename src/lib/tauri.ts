/**
 * Centralized Tauri utilities with safe wrappers for browser compatibility
 */

/**
 * Check if running in Tauri environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Safely invoke a Tauri command, returns null in browser
 */
export async function safeInvoke<T>(cmd: string, args?: unknown): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args as Record<string, unknown>);
  } catch (e) {
    console.error(`Tauri invoke failed: ${cmd}`, e);
    return null;
  }
}

/**
 * Safely listen to Tauri events, returns no-op cleanup in browser
 */
export async function safeListen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<T>(event, (e) => handler(e.payload));
    return unlisten;
  } catch (e) {
    console.error(`Tauri listen failed: ${event}`, e);
    return () => {};
  }
}

/**
 * Get the current Tauri window, returns null in browser
 */
export async function getCurrentWindow() {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  } catch (e) {
    console.error('Failed to get current window', e);
    return null;
  }
}

/**
 * Close the current window (used after confirmation)
 */
export async function closeWindow(): Promise<void> {
  const window = await getCurrentWindow();
  if (window) {
    await window.destroy();
  }
}

/**
 * Mark the app as ready (allows close confirmation to work)
 */
export async function markAppReady(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('mark_app_ready');
  } catch (e) {
    console.error('Failed to mark app ready', e);
  }
}

/**
 * Request sidecar restart
 */
export async function restartSidecar(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('restart_sidecar');
    return true;
  } catch (e) {
    console.error('Failed to restart sidecar', e);
    return false;
  }
}
