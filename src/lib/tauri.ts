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
// Window Size Management
// ============================================

const ONBOARDING_WIDTH = 980;
const ONBOARDING_HEIGHT = 790;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

/**
 * Set window to compact onboarding size: fixed, non-resizable, centered
 */
export async function setOnboardingWindowSize(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.setResizable(false);
    await win.setMaximizable(false);
    await win.setSize(new LogicalSize(ONBOARDING_WIDTH, ONBOARDING_HEIGHT));
    await win.center();
  } catch (e) {
    console.error('Failed to set onboarding window size', e);
  }
}

/**
 * Restore window to default app size: resizable, maximizable
 */
export async function restoreDefaultWindowSize(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    await win.setResizable(true);
    await win.setMaximizable(true);
    await win.center();
  } catch (e) {
    console.error('Failed to restore default window size', e);
  }
}

// ============================================
// File Watcher Functions
// ============================================

export interface FileChangedEvent {
  workspaceId: string;
  path: string;
  fullPath: string;
  /** All files changed in this batch (present when multiple files change at once) */
  files?: { path: string; fullPath: string }[];
  /** Total number of files changed in this batch */
  fileCount?: number;
}

/**
 * Start the global file watcher on the base worktrees directory.
 * Should be called once at app launch.
 *
 * @param basePath - The base worktrees directory to watch
 * @param createIfNeeded - If true, create the directory if it doesn't exist (use for default path only)
 */
export async function startFileWatcher(basePath: string, createIfNeeded = false): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_file_watcher', { basePath, createIfNeeded });
    return true;
  } catch (e) {
    console.error('Failed to start file watcher', e);
    return false;
  }
}

/**
 * Stop the global file watcher.
 */
export async function stopFileWatcher(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_file_watcher');
  } catch (e) {
    console.error('Failed to stop file watcher', e);
  }
}

/**
 * Register a session so its file change events are routed with the correct workspace ID.
 * The sessionDirName is the directory name under the base worktrees path.
 */
export async function registerSession(sessionDirName: string, workspaceId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('register_session', { sessionDirName, workspaceId });
  } catch (e) {
    console.error('Failed to register session', e);
  }
}

/**
 * Unregister a session from file change event routing.
 */
export async function unregisterSession(sessionDirName: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('unregister_session', { sessionDirName });
  } catch (e) {
    console.error('Failed to unregister session', e);
  }
}

/**
 * Listen for file change events from the global watcher.
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

/**
 * Extract the session directory name from a worktree path.
 * The directory name is the last path component (e.g. "/base/workspaces/my-session" → "my-session").
 */
export function getSessionDirName(worktreePath: string): string | undefined {
  return worktreePath.split('/').pop() || undefined;
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

// ============================================
// File Attachment Functions
// ============================================

export interface FileMetadata {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Read file metadata (size, type)
 */
export async function readFileMetadata(path: string): Promise<FileMetadata | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<FileMetadata>('read_file_metadata', { path });
  } catch (e) {
    console.error('Failed to read file metadata', e);
    return null;
  }
}

/**
 * Read file content as base64
 */
export async function readFileAsBase64(path: string, maxSize?: number): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('read_file_as_base64', { path, maxSize });
  } catch (e) {
    console.error('Failed to read file as base64', e);
    return null;
  }
}

/**
 * Get image dimensions (width, height)
 */
export async function getImageDimensions(path: string): Promise<ImageDimensions | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<ImageDimensions>('get_image_dimensions', { path });
  } catch (e) {
    console.error('Failed to get image dimensions', e);
    return null;
  }
}

/**
 * Count lines in a text file
 */
export async function countFileLines(path: string): Promise<number | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number>('count_file_lines', { path });
  } catch (e) {
    console.error('Failed to count file lines', e);
    return null;
  }
}

// ============================================
// Shell Open Functions
// ============================================

/**
 * Open a URL in the system default browser.
 * Falls back to window.open when not running in Tauri.
 */
export async function openUrlInBrowser(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch (e) {
    console.error('Failed to open URL in browser', e);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Open a path in VS Code
 */
export async function openInVSCode(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    // Scope: [Var(path)] — caller provides [path] at index 0
    Command.create('code', [path]).spawn().catch(console.error);
  } catch (e) {
    console.error('Failed to open in VS Code', e);
  }
}

/**
 * Open a path in macOS Terminal
 */
export async function openInTerminal(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    // Scope: [Fixed("-a"), Fixed("Terminal"), Var(path)]
    // Caller must provide args at all indices; Fixed positions are ignored
    Command.create('open-terminal', ['-a', 'Terminal', path]).spawn().catch(console.error);
  } catch (e) {
    console.error('Failed to open in Terminal', e);
  }
}

/**
 * Show a path in Finder
 */
export async function showInFinder(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    // Scope: [Fixed("-R"), Var(path)]
    Command.create('open-finder', ['-R', path]).spawn().catch(console.error);
  } catch (e) {
    console.error('Failed to show in Finder', e);
  }
}

export interface DetectedApp {
  id: string;
  iconBase64: string;
}

/**
 * Detect which apps are installed by checking bundle paths via Rust.
 * Returns an array of { id, iconBase64 } for each found app.
 */
export async function detectInstalledApps(
  appPaths: [string, string[]][]
): Promise<DetectedApp[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<[string, string][]>('detect_installed_apps', { appPaths });
    return result.map(([id, iconBase64]) => ({ id, iconBase64 }));
  } catch (e) {
    console.error('Failed to detect installed apps', e);
    return [];
  }
}

// Map of app IDs to their CLI allowlist names
const CLI_COMMAND_MAP: Record<string, string> = {
  vscode: 'code',
  cursor: 'cursor-cli',
  zed: 'zed-cli',
  sublime: 'subl-cli',
  windsurf: 'windsurf-cli',
};

/**
 * Open a path in a detected app.
 * Uses CLI for editors (better workspace handling), falls back to `open -a`.
 * Finder uses `open -R` to reveal in Finder.
 *
 * Caller args must be index-aligned with the scope definition in capabilities.
 * Fixed args consume indices but their values are overridden by the scope.
 */
export async function openInApp(
  appId: string,
  path: string,
  appName?: string
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { Command } = await import('@tauri-apps/plugin-shell');

    // Finder special case: use open -R
    // Scope: [Fixed("-R"), Var(path)]
    if (appId === 'finder') {
      Command.create('open-finder', ['-R', path]).spawn().catch(console.error);
      return;
    }

    // Try CLI first for editors (better workspace/extension handling)
    // Scope: [Var(path)] — caller provides [path] at index 0
    const cliCommand = CLI_COMMAND_MAP[appId];
    if (cliCommand) {
      try {
        await Command.create(cliCommand, [path]).spawn();
        return;
      } catch {
        // CLI not in PATH — fall through to open -a
      }
    }

    // Fall back to open -a (works for all macOS apps)
    // Scope: [Fixed("-a"), Var(appName), Var(path)]
    if (appName) {
      Command.create('open-app', ['-a', appName, path]).spawn().catch(console.error);
    }
  } catch (e) {
    console.error(`Failed to open in ${appId}`, e);
  }
}

export interface FileDialogOptions {
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
  title?: string;
}

/**
 * Open native file picker dialog for attachments
 */
export async function openFileDialog(options?: FileDialogOptions): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      directory: false,
      multiple: options?.multiple ?? true,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
      title: options?.title || 'Select Files',
    });
    if (result === null) return null;
    // Normalize to array
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    console.error('Failed to open file dialog', e);
    return null;
  }
}
