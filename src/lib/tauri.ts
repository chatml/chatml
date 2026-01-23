/**
 * Centralized Tauri utilities with safe wrappers for browser compatibility
 */

/**
 * Check if running in Tauri environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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

/**
 * Get the user's home directory
 */
export async function getHomeDir(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    return await homeDir();
  } catch (e) {
    console.error('Failed to get home directory', e);
    return null;
  }
}

/**
 * Open native folder picker dialog
 */
export async function openFolderDialog(title?: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      directory: true,
      multiple: false,
      title: title || 'Select Folder',
    });
    return result as string | null;
  } catch (e) {
    console.error('Failed to open folder dialog', e);
    return null;
  }
}

/**
 * Set minimize-to-tray preference
 */
export async function setMinimizeToTray(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_minimize_to_tray', { enabled });
  } catch (e) {
    console.error('Failed to set minimize to tray', e);
  }
}

/**
 * Check if the main window is visible
 */
export async function isWindowVisible(): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('is_window_visible');
  } catch (e) {
    console.error('Failed to check window visibility', e);
    return true;
  }
}

/**
 * Send a native notification
 */
export async function sendNotification(title: string, body?: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { sendNotification: notify } = await import('@tauri-apps/plugin-notification');
    await notify({ title, body });
  } catch (e) {
    console.error('Failed to send notification', e);
  }
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!isTauri()) return 'default';
  try {
    const { requestPermission, isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    const granted = await isPermissionGranted();
    if (granted) return 'granted';
    const permission = await requestPermission();
    return permission;
  } catch (e) {
    console.error('Failed to request notification permission', e);
    return 'default';
  }
}

/**
 * Listen for file drop events
 */
export async function listenForFileDrop(
  handler: (paths: string[]) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
      handler(event.payload.paths);
    });
    return unlisten;
  } catch (e) {
    console.error('Failed to listen for file drop', e);
    return () => {};
  }
}

/**
 * Listen for drag enter events
 */
export async function listenForDragEnter(
  handler: () => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen('tauri://drag-enter', handler);
    return unlisten;
  } catch (e) {
    console.error('Failed to listen for drag enter', e);
    return () => {};
  }
}

/**
 * Listen for drag leave events
 */
export async function listenForDragLeave(
  handler: () => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen('tauri://drag-leave', handler);
    return unlisten;
  } catch (e) {
    console.error('Failed to listen for drag leave', e);
    return () => {};
  }
}

// ============================================
// File Watcher Functions
// ============================================

export interface FileChangedEvent {
  workspaceId: string;
  path: string;
  fullPath: string;
}

/**
 * Start watching a workspace directory for file changes
 */
export async function watchWorkspace(workspaceId: string, workspacePath: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('watch_workspace', { workspaceId, workspacePath });
    return true;
  } catch (e) {
    console.error('Failed to watch workspace', e);
    return false;
  }
}

/**
 * Stop watching a workspace directory
 */
export async function unwatchWorkspace(workspaceId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('unwatch_workspace', { workspaceId });
  } catch (e) {
    console.error('Failed to unwatch workspace', e);
  }
}

/**
 * Listen for file change events
 */
export async function listenForFileChanges(
  handler: (event: FileChangedEvent) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<FileChangedEvent>('file-changed', (e) => {
      handler(e.payload);
    });
    return unlisten;
  } catch (e) {
    console.error('Failed to listen for file changes', e);
    return () => {};
  }
}

// ============================================
// Clipboard Functions
// ============================================

/**
 * Copy text to clipboard (Tauri native with browser fallback)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(text);
      return true;
    } catch (e) {
      console.error('Tauri clipboard write failed, falling back to browser', e);
    }
  }
  // Browser fallback
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.error('Clipboard write failed', e);
    return false;
  }
}

/**
 * Read text from clipboard (Tauri native with browser fallback)
 */
export async function readFromClipboard(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
      return await readText();
    } catch (e) {
      console.error('Tauri clipboard read failed, falling back to browser', e);
    }
  }
  // Browser fallback
  try {
    return await navigator.clipboard.readText();
  } catch (e) {
    console.error('Clipboard read failed', e);
    return null;
  }
}
