/**
 * Centralized keyboard shortcuts registry.
 * Single source of truth for all keyboard shortcuts in the app.
 */

export type ShortcutCategory = 'General' | 'Navigation' | 'Chat' | 'Editor' | 'Terminal';

export type ModifierKey = 'meta' | 'ctrl' | 'alt' | 'shift';

export interface Shortcut {
  /** Unique identifier for the shortcut */
  id: string;
  /** The key to press (e.g., 'k', 'p', '/', 'Enter', 'Tab') */
  key: string;
  /** Modifier keys required (meta = Cmd on Mac, Ctrl on Windows) */
  modifiers: ModifierKey[];
  /** Human-readable description */
  label: string;
  /** Category for grouping in the shortcuts dialog */
  category: ShortcutCategory;
  /** Optional context when this shortcut is active (for display purposes) */
  when?: string;
}

/**
 * All keyboard shortcuts in the application.
 * This registry is used by:
 * - useShortcut hook for registering handlers
 * - KeyboardShortcutsDialog for displaying to users
 */
export const SHORTCUTS: Shortcut[] = [
  // General
  {
    id: 'commandPalette',
    key: 'k',
    modifiers: ['meta'],
    label: 'Open command palette',
    category: 'General',
  },
  {
    id: 'shortcutsDialog',
    key: '/',
    modifiers: ['meta'],
    label: 'Show keyboard shortcuts',
    category: 'General',
  },
  {
    id: 'newSession',
    key: 'n',
    modifiers: ['meta'],
    label: 'New session',
    category: 'General',
  },
  {
    id: 'addWorkspace',
    key: 'n',
    modifiers: ['meta', 'shift'],
    label: 'Add workspace',
    category: 'General',
  },
  {
    id: 'createFromPR',
    key: 'o',
    modifiers: ['meta', 'shift'],
    label: 'New session from PR/Branch',
    category: 'General',
  },
  {
    id: 'resetLayouts',
    key: 'r',
    modifiers: ['meta', 'shift'],
    label: 'Reset panel layouts to defaults',
    category: 'General',
  },

  // Navigation
  {
    id: 'navigateBack',
    key: '[',
    modifiers: ['meta'],
    label: 'Go back',
    category: 'Navigation',
  },
  {
    id: 'navigateForward',
    key: ']',
    modifiers: ['meta'],
    label: 'Go forward',
    category: 'Navigation',
  },
  {
    id: 'filePicker',
    key: 'p',
    modifiers: ['meta'],
    label: 'Open file picker',
    category: 'Navigation',
  },
  {
    id: 'workspaceSearch',
    key: 'f',
    modifiers: ['meta', 'shift'],
    label: 'Search workspaces',
    category: 'Navigation',
  },

  // Chat
  {
    id: 'focusChat',
    key: 'l',
    modifiers: ['meta'],
    label: 'Focus chat input',
    category: 'Chat',
  },
  {
    id: 'toggleThinking',
    key: 't',
    modifiers: ['alt'],
    label: 'Toggle thinking mode',
    category: 'Chat',
  },
  {
    id: 'togglePlanMode',
    key: 'Tab',
    modifiers: ['shift'],
    label: 'Toggle plan mode',
    category: 'Chat',
  },
  {
    id: 'toggleDictation',
    key: 'd',
    modifiers: ['meta', 'shift'],
    label: 'Toggle dictation',
    category: 'Chat',
  },
  {
    id: 'approvePlan',
    key: 'Enter',
    modifiers: ['meta', 'shift'],
    label: 'Approve plan',
    category: 'Chat',
  },
  {
    id: 'searchChat',
    key: 'f',
    modifiers: ['meta'],
    label: 'Search conversation',
    category: 'Chat',
  },
  {
    id: 'searchNextMatch',
    key: 'g',
    modifiers: ['meta'],
    label: 'Next search match',
    category: 'Chat',
  },
  {
    id: 'searchPrevMatch',
    key: 'g',
    modifiers: ['meta', 'shift'],
    label: 'Previous search match',
    category: 'Chat',
  },

  // Terminal shortcuts are handled directly by xterm.js and are listed here
  // for documentation purposes only. They are not registered via useShortcut
  // since they require focus-based context that xterm handles natively.
];

/**
 * Get all shortcuts grouped by category.
 */
export function getShortcutsByCategory(): Record<ShortcutCategory, Shortcut[]> {
  const grouped: Record<ShortcutCategory, Shortcut[]> = {
    General: [],
    Navigation: [],
    Chat: [],
    Editor: [],
    Terminal: [],
  };

  for (const shortcut of SHORTCUTS) {
    grouped[shortcut.category].push(shortcut);
  }

  return grouped;
}

/**
 * Get a shortcut by its ID.
 */
export function getShortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

/**
 * Format a shortcut's key combination for display.
 * Returns an array of symbols/keys to render.
 */
export function formatShortcutKeys(shortcut: Shortcut): string[] {
  const keys: string[] = [];

  // Add modifiers in standard order
  if (shortcut.modifiers.includes('meta')) {
    keys.push('⌘');
  }
  if (shortcut.modifiers.includes('ctrl')) {
    keys.push('⌃');
  }
  if (shortcut.modifiers.includes('alt')) {
    keys.push('⌥');
  }
  if (shortcut.modifiers.includes('shift')) {
    keys.push('⇧');
  }

  // Add the main key
  const keyDisplay = formatKey(shortcut.key);
  keys.push(keyDisplay);

  return keys;
}

/**
 * Format a single key for display.
 */
function formatKey(key: string): string {
  const keyMap: Record<string, string> = {
    Enter: '↵',
    Tab: '⇥',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backspace: '⌫',
    Delete: '⌦',
    Space: '␣',
  };

  return keyMap[key] || key.toUpperCase();
}

/**
 * Check if a keyboard event matches a shortcut.
 *
 * Note: The 'meta' modifier is cross-platform and matches Cmd on Mac or Ctrl on Windows/Linux.
 * Use 'ctrl' only when you specifically need the Ctrl key on all platforms.
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  // Check modifiers
  const needsMeta = shortcut.modifiers.includes('meta');
  const needsCtrl = shortcut.modifiers.includes('ctrl');
  const needsAlt = shortcut.modifiers.includes('alt');
  const needsShift = shortcut.modifiers.includes('shift');

  // On Mac, meta is Cmd. On Windows/Linux, we treat meta shortcuts as Ctrl.
  // This provides cross-platform "Cmd/Ctrl" behavior for the 'meta' modifier.
  const metaOrCtrl = event.metaKey || event.ctrlKey;

  if (needsMeta && !metaOrCtrl) return false;
  if (needsCtrl && !event.ctrlKey) return false;
  if (needsAlt && !event.altKey) return false;
  if (needsShift && !event.shiftKey) return false;

  // Check that extra modifiers aren't pressed (unless they're required)
  // For meta: only reject if neither meta nor ctrl is needed but one is pressed
  if (!needsMeta && event.metaKey) return false;
  if (!needsCtrl && event.ctrlKey && !needsMeta) return false;
  if (!needsAlt && event.altKey) return false;
  if (!needsShift && event.shiftKey) return false;

  // Check the key itself
  // Handle special keys that use event.key vs event.code
  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  if (shortcut.key === 'Tab') {
    return event.code === 'Tab';
  }
  if (shortcut.key === 'Enter') {
    return event.key === 'Enter';
  }

  return eventKey === shortcutKey;
}
