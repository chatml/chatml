import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShortcut, useShortcuts, useCustomShortcut } from '../useShortcut';
import type { Shortcut } from '@/lib/shortcuts';

// Mock getShortcutById to return predictable shortcuts; matchesShortcut uses
// the real implementation to verify modifier matching.
vi.mock('@/lib/shortcuts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shortcuts')>('@/lib/shortcuts');
  return {
    ...actual,
    getShortcutById: vi.fn((id: string): Shortcut | undefined => {
      switch (id) {
        case 'commandPalette':
          return { id, label: 'CMD', category: 'App', key: 'k', modifiers: ['meta'] };
        case 'filePicker':
          return { id, label: 'FP', category: 'App', key: 'p', modifiers: ['meta'] };
        case 'unknown':
          return undefined;
        default:
          return undefined;
      }
    }),
  };
});

function dispatchKey(opts: KeyboardEventInit) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { ...opts, cancelable: true }));
  });
}

describe('useShortcut', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('fires the callback when the shortcut keys match', () => {
    const cb = vi.fn();
    renderHook(() => useShortcut('commandPalette', cb));

    dispatchKey({ key: 'k', metaKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire on the wrong key', () => {
    const cb = vi.fn();
    renderHook(() => useShortcut('commandPalette', cb));

    dispatchKey({ key: 'x', metaKey: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire when missing required modifier', () => {
    const cb = vi.fn();
    renderHook(() => useShortcut('commandPalette', cb));

    dispatchKey({ key: 'k' }); // no meta
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const cb = vi.fn();
    renderHook(() => useShortcut('commandPalette', cb, { enabled: false }));

    dispatchKey({ key: 'k', metaKey: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('warns once for an unknown shortcut id', () => {
    renderHook(() => useShortcut('unknown', vi.fn()));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown shortcut ID "unknown"')
    );
  });

  it('cleans up the listener on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useShortcut('commandPalette', cb));

    unmount();
    dispatchKey({ key: 'k', metaKey: true });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('useShortcuts', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('dispatches the matching callback for each shortcut id', () => {
    const cmdCb = vi.fn();
    const fpCb = vi.fn();
    renderHook(() => useShortcuts({ commandPalette: cmdCb, filePicker: fpCb }));

    dispatchKey({ key: 'k', metaKey: true });
    expect(cmdCb).toHaveBeenCalledTimes(1);
    expect(fpCb).not.toHaveBeenCalled();

    dispatchKey({ key: 'p', metaKey: true });
    expect(fpCb).toHaveBeenCalledTimes(1);
  });

  it('only triggers one callback per event (returns after first match)', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    renderHook(() => useShortcuts({ commandPalette: cb1, filePicker: cb2 }));

    dispatchKey({ key: 'k', metaKey: true });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const cb = vi.fn();
    renderHook(() => useShortcuts({ commandPalette: cb }, { enabled: false }));

    dispatchKey({ key: 'k', metaKey: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('warns for unknown shortcut ids', () => {
    renderHook(() => useShortcuts({ unknown: vi.fn() }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown shortcut ID "unknown"')
    );
  });
});

describe('useCustomShortcut', () => {
  it('fires when a custom shortcut definition matches', () => {
    const shortcut: Shortcut = {
      id: 'custom-1',
      label: 'Custom',
      category: 'Chat',
      key: 'd',
      modifiers: ['meta', 'shift'],
    };
    const cb = vi.fn();
    renderHook(() => useCustomShortcut(shortcut, cb));

    dispatchKey({ key: 'd', metaKey: true, shiftKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when modifiers do not match', () => {
    const shortcut: Shortcut = {
      id: 'custom-1',
      label: 'Custom',
      category: 'Chat',
      key: 'd',
      modifiers: ['meta', 'shift'],
    };
    const cb = vi.fn();
    renderHook(() => useCustomShortcut(shortcut, cb));

    dispatchKey({ key: 'd', metaKey: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('respects enabled option', () => {
    const shortcut: Shortcut = {
      id: 'custom-1',
      label: 'Custom',
      category: 'Chat',
      key: 'd',
      modifiers: ['meta', 'shift'],
    };
    const cb = vi.fn();
    renderHook(() => useCustomShortcut(shortcut, cb, { enabled: false }));

    dispatchKey({ key: 'd', metaKey: true, shiftKey: true });
    expect(cb).not.toHaveBeenCalled();
  });
});
