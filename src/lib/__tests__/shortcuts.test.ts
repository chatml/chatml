import { describe, it, expect, vi } from 'vitest';
import {
  getShortcutsByCategory,
  getShortcutById,
  formatShortcutKeys,
  matchesShortcut,
  SHORTCUTS,
  type Shortcut,
} from '../shortcuts';

// Mock platform detection for consistent tests
vi.mock('../platform', () => ({
  isMacOS: vi.fn(() => true),
  getPlatformKey: vi.fn(() => 'darwin'),
}));

import { isMacOS } from '../platform';
const mockIsMacOS = vi.mocked(isMacOS);

function makeKeyboardEvent(overrides: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: '',
    ...overrides,
  } as KeyboardEvent;
}

const metaK: Shortcut = {
  id: 'commandPalette',
  key: 'k',
  modifiers: ['meta'],
  label: 'Open command palette',
  category: 'General',
};

describe('getShortcutsByCategory', () => {
  it('groups all shortcuts into their categories', () => {
    const grouped = getShortcutsByCategory();
    const totalGrouped = Object.values(grouped).flat().length;
    expect(totalGrouped).toBe(SHORTCUTS.length);
  });

  it('returns empty arrays for categories with no shortcuts', () => {
    const grouped = getShortcutsByCategory();
    // Editor and Terminal categories exist but may be empty
    expect(Array.isArray(grouped.Editor)).toBe(true);
    expect(Array.isArray(grouped.Terminal)).toBe(true);
  });
});

describe('getShortcutById', () => {
  it('finds a shortcut by ID', () => {
    const shortcut = getShortcutById('commandPalette');
    expect(shortcut).toBeDefined();
    expect(shortcut!.key).toBe('k');
  });

  it('returns undefined for unknown ID', () => {
    expect(getShortcutById('nonexistent')).toBeUndefined();
  });
});

describe('formatShortcutKeys', () => {
  it('uses macOS symbols when on Mac', () => {
    mockIsMacOS.mockReturnValue(true);
    const keys = formatShortcutKeys(metaK);
    expect(keys).toEqual(['⌘', 'K']);
  });

  it('uses text labels on non-Mac', () => {
    mockIsMacOS.mockReturnValue(false);
    const keys = formatShortcutKeys(metaK);
    expect(keys).toEqual(['Ctrl', 'K']);
  });

  it('formats special keys', () => {
    mockIsMacOS.mockReturnValue(true);
    const shortcut: Shortcut = { id: 'test', key: 'Enter', modifiers: ['meta', 'shift'], label: 'Test', category: 'General' };
    const keys = formatShortcutKeys(shortcut);
    expect(keys).toEqual(['⌘', '⇧', '↵']);
  });

  it('formats alt modifier', () => {
    mockIsMacOS.mockReturnValue(true);
    const shortcut: Shortcut = { id: 'test', key: 'f', modifiers: ['alt'], label: 'Test', category: 'Navigation' };
    const keys = formatShortcutKeys(shortcut);
    expect(keys).toEqual(['⌥', 'F']);
  });

  it('avoids duplicating Ctrl on non-Mac when both meta and ctrl present', () => {
    mockIsMacOS.mockReturnValue(false);
    const shortcut: Shortcut = { id: 'test', key: 'f', modifiers: ['ctrl', 'meta'], label: 'Test', category: 'General' };
    const keys = formatShortcutKeys(shortcut);
    // meta → Ctrl, ctrl is skipped because meta already added Ctrl
    expect(keys).toEqual(['Ctrl', 'F']);
  });
});

describe('matchesShortcut', () => {
  it('matches Cmd+K on Mac (metaKey)', () => {
    const event = makeKeyboardEvent({ key: 'k', metaKey: true });
    expect(matchesShortcut(event, metaK)).toBe(true);
  });

  it('matches Ctrl+K on Windows (ctrlKey for meta modifier)', () => {
    const event = makeKeyboardEvent({ key: 'k', ctrlKey: true });
    expect(matchesShortcut(event, metaK)).toBe(true);
  });

  it('rejects when required modifier is missing', () => {
    const event = makeKeyboardEvent({ key: 'k' });
    expect(matchesShortcut(event, metaK)).toBe(false);
  });

  it('rejects when extra modifier is pressed', () => {
    const event = makeKeyboardEvent({ key: 'k', metaKey: true, shiftKey: true });
    expect(matchesShortcut(event, metaK)).toBe(false);
  });

  it('matches multi-modifier shortcut', () => {
    const shortcut: Shortcut = { id: 'test', key: 'n', modifiers: ['meta', 'shift'], label: 'Test', category: 'General' };
    const event = makeKeyboardEvent({ key: 'n', metaKey: true, shiftKey: true });
    expect(matchesShortcut(event, shortcut)).toBe(true);
  });

  it('handles Tab key via event.code', () => {
    const shortcut: Shortcut = { id: 'test', key: 'Tab', modifiers: ['shift'], label: 'Test', category: 'Chat' };
    const event = makeKeyboardEvent({ key: 'Tab', code: 'Tab', shiftKey: true });
    expect(matchesShortcut(event, shortcut)).toBe(true);
  });

  it('handles Enter key via event.key', () => {
    const shortcut: Shortcut = { id: 'test', key: 'Enter', modifiers: ['meta', 'shift'], label: 'Test', category: 'Chat' };
    const event = makeKeyboardEvent({ key: 'Enter', metaKey: true, shiftKey: true });
    expect(matchesShortcut(event, shortcut)).toBe(true);
  });

  it('uses event.code for Alt+letter (macOS special chars)', () => {
    const shortcut: Shortcut = { id: 'test', key: 'f', modifiers: ['alt'], label: 'Test', category: 'Navigation' };
    // On macOS, Alt+F produces 'ƒ' as event.key but code is still 'KeyF'
    const event = makeKeyboardEvent({ key: 'ƒ', code: 'KeyF', altKey: true });
    expect(matchesShortcut(event, shortcut)).toBe(true);
  });

  it('rejects wrong key', () => {
    const event = makeKeyboardEvent({ key: 'j', metaKey: true });
    expect(matchesShortcut(event, metaK)).toBe(false);
  });

  it('rejects extra alt modifier', () => {
    const event = makeKeyboardEvent({ key: 'k', metaKey: true, altKey: true });
    expect(matchesShortcut(event, metaK)).toBe(false);
  });
});
