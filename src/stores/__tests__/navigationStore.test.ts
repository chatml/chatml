import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore, type NavigationEntry } from '../navigationStore';

function makeEntry(overrides: Partial<NavigationEntry> = {}): NavigationEntry {
  return {
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    conversationId: 'conv-1',
    contentView: { type: 'conversation' },
    timestamp: Date.now(),
    label: 'Test Entry',
    ...overrides,
  };
}

function getTab(tabId = 'default') {
  return useNavigationStore.getState().tabs[tabId];
}

describe('navigationStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useNavigationStore.setState({
      tabs: { default: { backStack: [], forwardStack: [] } },
      activeTabId: 'default',
      isRestoring: false,
    });
  });

  // ---------- pushEntry ----------

  describe('pushEntry', () => {
    it('pushes an entry onto the backStack', () => {
      const entry = makeEntry();
      useNavigationStore.getState().pushEntry(entry);

      const tab = getTab();
      expect(tab.backStack).toHaveLength(1);
      expect(tab.backStack[0]).toEqual(entry);
    });

    it('clears the forwardStack on push (browser semantics)', () => {
      // Seed a forward entry
      useNavigationStore.setState({
        tabs: {
          default: {
            backStack: [],
            forwardStack: [makeEntry({ label: 'forward' })],
          },
        },
      });

      useNavigationStore.getState().pushEntry(makeEntry({ label: 'new' }));

      const tab = getTab();
      expect(tab.forwardStack).toHaveLength(0);
      expect(tab.backStack).toHaveLength(1);
    });

    it('deduplicates consecutive identical entries', () => {
      const entry = makeEntry();
      const { pushEntry } = useNavigationStore.getState();
      pushEntry(entry);
      pushEntry(entry);
      pushEntry(entry);

      expect(getTab().backStack).toHaveLength(1);
    });

    it('does not dedup entries that differ by contentView type', () => {
      const { pushEntry } = useNavigationStore.getState();
      pushEntry(makeEntry({ contentView: { type: 'conversation' } }));
      pushEntry(makeEntry({ contentView: { type: 'repositories' } }));

      expect(getTab().backStack).toHaveLength(2);
    });

    it('does not dedup entries that differ by sessionId', () => {
      const { pushEntry } = useNavigationStore.getState();
      pushEntry(makeEntry({ sessionId: 'sess-1' }));
      pushEntry(makeEntry({ sessionId: 'sess-2' }));

      expect(getTab().backStack).toHaveLength(2);
    });

    it('does not dedup entries that differ by contentView workspaceId', () => {
      const { pushEntry } = useNavigationStore.getState();
      pushEntry(makeEntry({
        contentView: { type: 'branches', workspaceId: 'ws-a' },
      }));
      pushEntry(makeEntry({
        contentView: { type: 'branches', workspaceId: 'ws-b' },
      }));

      expect(getTab().backStack).toHaveLength(2);
    });

    it('respects MAX_HISTORY_SIZE (50)', () => {
      const { pushEntry } = useNavigationStore.getState();
      for (let i = 0; i < 60; i++) {
        pushEntry(makeEntry({ sessionId: `sess-${i}`, label: `Entry ${i}` }));
      }

      const tab = getTab();
      expect(tab.backStack).toHaveLength(50);
      // Oldest entries should be trimmed — first entry should be sess-10
      expect(tab.backStack[0].sessionId).toBe('sess-10');
      expect(tab.backStack[49].sessionId).toBe('sess-59');
    });

    it('uses activeTabId when tabId is omitted', () => {
      useNavigationStore.setState({ activeTabId: 'default' });
      useNavigationStore.getState().pushEntry(makeEntry());

      expect(getTab('default').backStack).toHaveLength(1);
    });

    it('pushes to a specific tab when tabId is provided', () => {
      useNavigationStore.getState().pushEntry(makeEntry(), 'tab-2');

      expect(getTab('default').backStack).toHaveLength(0);
      expect(getTab('tab-2').backStack).toHaveLength(1);
    });
  });

  // ---------- goBack ----------

  describe('goBack', () => {
    it('pops the most recent entry from backStack', () => {
      const entry1 = makeEntry({ label: 'first' });
      const entry2 = makeEntry({ label: 'second', sessionId: 'sess-2' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [entry1, entry2], forwardStack: [] } },
      });

      const result = useNavigationStore.getState().goBack();

      expect(result).toEqual(entry2);
      expect(getTab().backStack).toHaveLength(1);
      expect(getTab().backStack[0]).toEqual(entry1);
    });

    it('returns null when backStack is empty', () => {
      const result = useNavigationStore.getState().goBack();
      expect(result).toBeNull();
    });

    it('does not modify forwardStack (caller is responsible)', () => {
      const fwdEntry = makeEntry({ label: 'fwd' });
      useNavigationStore.setState({
        tabs: {
          default: {
            backStack: [makeEntry()],
            forwardStack: [fwdEntry],
          },
        },
      });

      useNavigationStore.getState().goBack();

      expect(getTab().forwardStack).toEqual([fwdEntry]);
    });
  });

  // ---------- goForward ----------

  describe('goForward', () => {
    it('pops the most recent entry from forwardStack', () => {
      const entry1 = makeEntry({ label: 'fwd-1' });
      const entry2 = makeEntry({ label: 'fwd-2', sessionId: 'sess-2' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: [entry1, entry2] } },
      });

      const result = useNavigationStore.getState().goForward();

      expect(result).toEqual(entry2);
      expect(getTab().forwardStack).toHaveLength(1);
      expect(getTab().forwardStack[0]).toEqual(entry1);
    });

    it('returns null when forwardStack is empty', () => {
      const result = useNavigationStore.getState().goForward();
      expect(result).toBeNull();
    });

    it('does not modify backStack (caller is responsible)', () => {
      const backEntry = makeEntry({ label: 'back' });
      useNavigationStore.setState({
        tabs: {
          default: {
            backStack: [backEntry],
            forwardStack: [makeEntry({ sessionId: 'sess-2' })],
          },
        },
      });

      useNavigationStore.getState().goForward();

      expect(getTab().backStack).toEqual([backEntry]);
    });
  });

  // ---------- goToBackIndex ----------

  describe('goToBackIndex', () => {
    it('navigates to an arbitrary back entry by display index', () => {
      const entries = [
        makeEntry({ label: 'oldest', sessionId: 'sess-0' }),
        makeEntry({ label: 'middle', sessionId: 'sess-1' }),
        makeEntry({ label: 'newest', sessionId: 'sess-2' }),
      ];
      const current = makeEntry({ label: 'current', sessionId: 'sess-cur' });
      useNavigationStore.setState({
        tabs: { default: { backStack: entries, forwardStack: [] } },
      });

      // display index 0 = most recent = 'newest' (index 2 in array)
      const result = useNavigationStore.getState().goToBackIndex(0, current);

      expect(result).toEqual(entries[2]);
      // backStack should have everything before the target
      expect(getTab().backStack).toEqual([entries[0], entries[1]]);
      // forwardStack gets current entry (nothing between target and end)
      expect(getTab().forwardStack).toEqual([current]);
    });

    it('moves intermediate entries to forwardStack when jumping deeper', () => {
      const entries = [
        makeEntry({ label: 'A', sessionId: 'a' }),
        makeEntry({ label: 'B', sessionId: 'b' }),
        makeEntry({ label: 'C', sessionId: 'c' }),
      ];
      const current = makeEntry({ label: 'current', sessionId: 'cur' });
      useNavigationStore.setState({
        tabs: { default: { backStack: entries, forwardStack: [] } },
      });

      // display index 2 = oldest = 'A' (index 0 in array)
      const result = useNavigationStore.getState().goToBackIndex(2, current);

      expect(result).toEqual(entries[0]);
      expect(getTab().backStack).toEqual([]);
      // forwardStack = [current, B, C] (intermediate entries after target)
      expect(getTab().forwardStack).toEqual([current, entries[1], entries[2]]);
    });

    it('returns null for out-of-bounds index', () => {
      useNavigationStore.setState({
        tabs: { default: { backStack: [makeEntry()], forwardStack: [] } },
      });

      expect(useNavigationStore.getState().goToBackIndex(5, makeEntry())).toBeNull();
      expect(useNavigationStore.getState().goToBackIndex(-1, makeEntry())).toBeNull();
    });
  });

  // ---------- goToForwardIndex ----------

  describe('goToForwardIndex', () => {
    it('navigates to an arbitrary forward entry by display index', () => {
      const entries = [
        makeEntry({ label: 'oldest-fwd', sessionId: 'f-0' }),
        makeEntry({ label: 'middle-fwd', sessionId: 'f-1' }),
        makeEntry({ label: 'newest-fwd', sessionId: 'f-2' }),
      ];
      const current = makeEntry({ label: 'current', sessionId: 'cur' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: entries } },
      });

      // display index 0 = most recent forward entry = 'newest-fwd' (last in array)
      const result = useNavigationStore.getState().goToForwardIndex(0, current);

      expect(result).toEqual(entries[2]);
      expect(getTab().forwardStack).toEqual([entries[0], entries[1]]);
      expect(getTab().backStack).toEqual([current]);
    });

    it('moves intermediate entries to backStack when jumping deeper', () => {
      const entries = [
        makeEntry({ label: 'F-A', sessionId: 'fa' }),
        makeEntry({ label: 'F-B', sessionId: 'fb' }),
        makeEntry({ label: 'F-C', sessionId: 'fc' }),
      ];
      const current = makeEntry({ label: 'current', sessionId: 'cur' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: entries } },
      });

      // display index 2 = oldest forward = 'F-A' (index 0 in array)
      const result = useNavigationStore.getState().goToForwardIndex(2, current);

      expect(result).toEqual(entries[0]);
      expect(getTab().forwardStack).toEqual([]);
      // backStack = [F-B, F-C, current] (intermediate entries + current)
      expect(getTab().backStack).toEqual([entries[1], entries[2], current]);
    });

    it('returns null for out-of-bounds index', () => {
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: [makeEntry()] } },
      });

      expect(useNavigationStore.getState().goToForwardIndex(5, makeEntry())).toBeNull();
      expect(useNavigationStore.getState().goToForwardIndex(-1, makeEntry())).toBeNull();
    });
  });

  // ---------- setRestoring ----------

  describe('setRestoring', () => {
    it('sets isRestoring to true', () => {
      useNavigationStore.getState().setRestoring(true);
      expect(useNavigationStore.getState().isRestoring).toBe(true);
    });

    it('sets isRestoring to false', () => {
      useNavigationStore.getState().setRestoring(true);
      useNavigationStore.getState().setRestoring(false);
      expect(useNavigationStore.getState().isRestoring).toBe(false);
    });
  });

  // ---------- Tab isolation ----------

  describe('tab isolation', () => {
    it('operations on one tab do not affect another', () => {
      const { pushEntry } = useNavigationStore.getState();
      pushEntry(makeEntry({ label: 'tab-a-entry' }), 'tab-a');
      pushEntry(makeEntry({ label: 'tab-b-entry', sessionId: 'sess-b' }), 'tab-b');

      expect(getTab('tab-a').backStack).toHaveLength(1);
      expect(getTab('tab-a').backStack[0].label).toBe('tab-a-entry');
      expect(getTab('tab-b').backStack).toHaveLength(1);
      expect(getTab('tab-b').backStack[0].label).toBe('tab-b-entry');
    });

    it('goBack on one tab does not affect another', () => {
      useNavigationStore.setState({
        tabs: {
          'tab-a': { backStack: [makeEntry({ label: 'a' })], forwardStack: [] },
          'tab-b': { backStack: [makeEntry({ label: 'b', sessionId: 'sess-b' })], forwardStack: [] },
        },
      });

      useNavigationStore.getState().goBack('tab-a');

      expect(getTab('tab-a').backStack).toHaveLength(0);
      expect(getTab('tab-b').backStack).toHaveLength(1);
    });
  });
});
