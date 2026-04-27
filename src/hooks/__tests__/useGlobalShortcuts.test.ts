import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useGlobalShortcuts } from '../useGlobalShortcuts';
import type { WorktreeSession } from '@/lib/types';

// Mock cross-cutting modules so the hook itself is the unit under test
vi.mock('@/components/navigation/BrowserTabBar', () => ({
  switchToTab: vi.fn(),
  createAndSwitchToNewTab: vi.fn(),
}));

vi.mock('@/lib/navigation', () => ({
  navigate: vi.fn(),
}));

vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
  return { ...actual, ENABLE_BROWSER_TABS: true };
});

import { switchToTab, createAndSwitchToNewTab } from '@/components/navigation/BrowserTabBar';
import { navigate } from '@/lib/navigation';
import { useTabStore } from '@/stores/tabStore';

const sessions: WorktreeSession[] = [
  { id: 's1', workspaceId: 'ws-1' } as WorktreeSession,
  { id: 's2', workspaceId: 'ws-1' } as WorktreeSession,
  { id: 's3', workspaceId: 'ws-2' } as WorktreeSession,
];

interface RenderOptions {
  toggleBottomTerminal?: () => void;
  selectNextTab?: () => void;
  selectPreviousTab?: () => void;
  setZenMode?: (v: boolean) => void;
  zenMode?: boolean;
}

function renderShortcuts(opts: RenderOptions = {}) {
  const toggleBottomTerminal = opts.toggleBottomTerminal ?? vi.fn();
  const selectNextTab = opts.selectNextTab ?? vi.fn();
  const selectPreviousTab = opts.selectPreviousTab ?? vi.fn();
  const setZenMode = opts.setZenMode ?? vi.fn();

  const { result } = renderHook(() => {
    const zenModeRef = useRef(opts.zenMode ?? false);
    useGlobalShortcuts({
      sessions,
      toggleBottomTerminal,
      selectNextTab,
      selectPreviousTab,
      setZenMode,
      zenModeRef,
    });
    return { zenModeRef };
  });

  return { result, toggleBottomTerminal, selectNextTab, selectPreviousTab, setZenMode };
}

function key(opts: KeyboardEventInit & { code?: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { ...opts, cancelable: true });
}

function dispatch(event: KeyboardEvent) {
  let prevented = false;
  Object.defineProperty(event, 'preventDefault', {
    value: () => {
      prevented = true;
    },
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return prevented;
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    useTabStore.setState({ tabOrder: [], activeTabId: '' } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Cmd+K command palette', () => {
    it('dispatches open-command-palette event when target is not a terminal', () => {
      renderShortcuts();
      const handler = vi.fn();
      window.addEventListener('open-command-palette', handler);

      // Dispatch on a non-terminal element (body) so e.target is an Element with closest()
      const target = document.body;
      const e = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        cancelable: true,
        bubbles: true,
      });
      act(() => {
        target.dispatchEvent(e);
      });

      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener('open-command-palette', handler);
    });

    it('does not dispatch when keyboard event originates inside .xterm', () => {
      renderShortcuts();
      const xterm = document.createElement('div');
      xterm.className = 'xterm';
      document.body.appendChild(xterm);

      const handler = vi.fn();
      window.addEventListener('open-command-palette', handler);

      const e = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        cancelable: true,
        bubbles: true,
      });
      act(() => {
        xterm.dispatchEvent(e);
      });

      expect(handler).not.toHaveBeenCalled();
      window.removeEventListener('open-command-palette', handler);
      document.body.removeChild(xterm);
    });
  });

  describe('Cmd+J terminal toggle', () => {
    it('calls toggleBottomTerminal on Cmd+J', () => {
      const toggleBottomTerminal = vi.fn();
      renderShortcuts({ toggleBottomTerminal });
      dispatch(key({ key: 'j', metaKey: true }));
      expect(toggleBottomTerminal).toHaveBeenCalledTimes(1);
    });

    it('does not toggle when Cmd+J has shift or alt', () => {
      const toggleBottomTerminal = vi.fn();
      renderShortcuts({ toggleBottomTerminal });
      dispatch(key({ key: 'j', metaKey: true, shiftKey: true }));
      expect(toggleBottomTerminal).not.toHaveBeenCalled();
    });
  });

  describe('Cmd+Shift+1-9 session navigation', () => {
    it('navigates to session at index 0 on Cmd+Shift+1', () => {
      renderShortcuts();
      // shiftKey makes e.key = '!' on macOS, so we use e.code
      dispatch(key({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }));
      expect(navigate).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        sessionId: 's1',
        contentView: { type: 'conversation' },
      });
    });

    it('navigates to session at index 2 on Cmd+Shift+3', () => {
      renderShortcuts();
      dispatch(key({ key: '#', code: 'Digit3', metaKey: true, shiftKey: true }));
      expect(navigate).toHaveBeenCalledWith({
        workspaceId: 'ws-2',
        sessionId: 's3',
        contentView: { type: 'conversation' },
      });
    });

    it('is a no-op when the session index is out of range', () => {
      renderShortcuts();
      dispatch(key({ key: '%', code: 'Digit5', metaKey: true, shiftKey: true }));
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('Tab navigation', () => {
    it('selectNextTab on Cmd+Option+]', () => {
      const selectNextTab = vi.fn();
      renderShortcuts({ selectNextTab });
      dispatch(key({ key: ']', metaKey: true, altKey: true }));
      expect(selectNextTab).toHaveBeenCalledTimes(1);
    });

    it('selectNextTab on Ctrl+Tab', () => {
      const selectNextTab = vi.fn();
      renderShortcuts({ selectNextTab });
      dispatch(key({ key: 'Tab', ctrlKey: true }));
      expect(selectNextTab).toHaveBeenCalledTimes(1);
    });

    it('selectPreviousTab on Cmd+Option+[', () => {
      const selectPreviousTab = vi.fn();
      renderShortcuts({ selectPreviousTab });
      dispatch(key({ key: '[', metaKey: true, altKey: true }));
      expect(selectPreviousTab).toHaveBeenCalledTimes(1);
    });

    it('selectPreviousTab on Ctrl+Shift+Tab', () => {
      const selectPreviousTab = vi.fn();
      renderShortcuts({ selectPreviousTab });
      dispatch(key({ key: 'Tab', ctrlKey: true, shiftKey: true }));
      expect(selectPreviousTab).toHaveBeenCalledTimes(1);
    });
  });

  describe('Browser tab management', () => {
    it('Cmd+T opens a new tab', () => {
      renderShortcuts();
      dispatch(key({ key: 't', metaKey: true }));
      expect(createAndSwitchToNewTab).toHaveBeenCalledTimes(1);
    });

    it('Cmd+Shift+] cycles to next browser tab', () => {
      useTabStore.setState({ tabOrder: ['ta', 'tb', 'tc'], activeTabId: 'ta' } as never);
      renderShortcuts();

      dispatch(key({ key: ']', metaKey: true, shiftKey: true }));
      expect(switchToTab).toHaveBeenCalledWith('tb');
    });

    it('Cmd+Shift+[ cycles to previous browser tab (wraps around)', () => {
      useTabStore.setState({ tabOrder: ['ta', 'tb', 'tc'], activeTabId: 'ta' } as never);
      renderShortcuts();

      dispatch(key({ key: '[', metaKey: true, shiftKey: true }));
      expect(switchToTab).toHaveBeenCalledWith('tc');
    });

    it('does nothing when there is only one tab', () => {
      useTabStore.setState({ tabOrder: ['ta'], activeTabId: 'ta' } as never);
      renderShortcuts();

      dispatch(key({ key: ']', metaKey: true, shiftKey: true }));
      expect(switchToTab).not.toHaveBeenCalled();
    });

    it('Cmd+1 switches to first tab by position', () => {
      useTabStore.setState({ tabOrder: ['ta', 'tb', 'tc'], activeTabId: 'tb' } as never);
      renderShortcuts();

      dispatch(key({ key: '1', metaKey: true }));
      expect(switchToTab).toHaveBeenCalledWith('ta');
    });

    it('Cmd+9 always selects the last tab', () => {
      useTabStore.setState({ tabOrder: ['ta', 'tb', 'tc', 'td'], activeTabId: 'ta' } as never);
      renderShortcuts();

      dispatch(key({ key: '9', metaKey: true }));
      expect(switchToTab).toHaveBeenCalledWith('td');
    });

    it('Cmd+5 (out of range when only 3 tabs) is a no-op', () => {
      useTabStore.setState({ tabOrder: ['ta', 'tb', 'tc'], activeTabId: 'ta' } as never);
      renderShortcuts();

      dispatch(key({ key: '5', metaKey: true }));
      expect(switchToTab).not.toHaveBeenCalled();
    });
  });

  describe('Escape and zen mode', () => {
    it('Escape exits zen mode when active', () => {
      const setZenMode = vi.fn();
      renderShortcuts({ setZenMode, zenMode: true });
      dispatch(key({ key: 'Escape' }));
      expect(setZenMode).toHaveBeenCalledWith(false);
    });

    it('Escape is a no-op when zen mode is off', () => {
      const setZenMode = vi.fn();
      renderShortcuts({ setZenMode, zenMode: false });
      dispatch(key({ key: 'Escape' }));
      expect(setZenMode).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes the keydown listener on unmount', () => {
      const toggleBottomTerminal = vi.fn();
      const { unmount } = renderHook(() => {
        const zenModeRef = useRef(false);
        useGlobalShortcuts({
          sessions,
          toggleBottomTerminal,
          selectNextTab: vi.fn(),
          selectPreviousTab: vi.fn(),
          setZenMode: vi.fn(),
          zenModeRef,
        });
      });

      // Listener fires while mounted
      dispatch(key({ key: 'j', metaKey: true }));
      expect(toggleBottomTerminal).toHaveBeenCalledTimes(1);

      // Listener is removed after unmount
      unmount();
      dispatch(key({ key: 'j', metaKey: true }));
      expect(toggleBottomTerminal).toHaveBeenCalledTimes(1);
    });
  });
});
