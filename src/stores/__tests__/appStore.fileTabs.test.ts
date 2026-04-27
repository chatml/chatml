import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import { createMockConversation } from '@/test-utils/store-utils';
import type { FileTab, Conversation } from '@/lib/types';

const MAX_FILE_TABS = 10;

function makeTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: `tab-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 's1',
    workspaceId: 'ws-1',
    path: 'src/file.ts',
    viewMode: 'file',
    isPinned: false,
    isDirty: false,
    isPreview: false,
    position: 0,
    openedAt: '2026-04-26T10:00:00Z',
    lastAccessedAt: '2026-04-26T10:00:00Z',
    ...overrides,
  } as FileTab;
}

describe('appStore — file tab actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      fileTabs: [],
      selectedFileTabId: null,
      pendingCloseFileTabId: null,
      conversations: [],
      conversationIds: new Set(),
      conversationsBySession: {},
      checkpoints: [],
      selectedSessionId: null,
      selectedConversationId: null,
      lastActiveConversationPerSession: {},
    });
  });

  describe('setFileTabs', () => {
    it('replaces the tabs array', () => {
      const t1 = makeTab({ id: 't1' });
      useAppStore.getState().setFileTabs([t1]);
      expect(useAppStore.getState().fileTabs).toEqual([t1]);
    });
  });

  describe('openFileTab', () => {
    it('opens a new tab and selects it', () => {
      const t = makeTab({ id: 't1', path: 'a.ts' });
      useAppStore.getState().openFileTab(t);
      expect(useAppStore.getState().fileTabs.map((x) => x.id)).toEqual(['t1']);
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
    });

    it('updates lastAccessedAt and selects when re-opening an existing tab', () => {
      const t = makeTab({ id: 't1', lastAccessedAt: '2025-01-01T00:00:00Z' });
      useAppStore.setState({ fileTabs: [t] });
      useAppStore.getState().openFileTab(t);
      const updated = useAppStore.getState().fileTabs[0];
      expect(updated.lastAccessedAt).not.toBe('2025-01-01T00:00:00Z');
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
    });

    it('promotes preview tab to persistent when re-opened without isPreview', () => {
      const previewTab = makeTab({ id: 't1', isPreview: true });
      useAppStore.setState({ fileTabs: [previewTab] });
      useAppStore.getState().openFileTab({ ...previewTab, isPreview: undefined as never });
      expect(useAppStore.getState().fileTabs[0].isPreview).toBe(false);
    });

    it('preview tabs replace the existing preview in the same session', () => {
      const oldPreview = makeTab({ id: 't1', isPreview: true, path: 'a.ts' });
      useAppStore.setState({ fileTabs: [oldPreview] });

      const newPreview = makeTab({ id: 't2', isPreview: true, path: 'b.ts' });
      useAppStore.getState().openFileTab(newPreview);

      const tabs = useAppStore.getState().fileTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('t2');
    });

    it('appends new persistent tab when no preview exists', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      useAppStore.getState().openFileTab(t1);
      useAppStore.getState().openFileTab(t2);
      expect(useAppStore.getState().fileTabs).toHaveLength(2);
    });

    it('evicts the oldest unpinned non-dirty tab when over MAX_FILE_TABS', () => {
      const initial = Array.from({ length: MAX_FILE_TABS }, (_, i) =>
        makeTab({
          id: `t${i}`,
          path: `f${i}.ts`,
          lastAccessedAt: `2025-01-01T00:00:0${i}Z`,
        })
      );
      useAppStore.setState({ fileTabs: initial });

      const newTab = makeTab({ id: 'new', path: 'new.ts' });
      useAppStore.getState().openFileTab(newTab);

      const tabs = useAppStore.getState().fileTabs;
      expect(tabs).toHaveLength(MAX_FILE_TABS);
      expect(tabs.find((t) => t.id === 'new')).toBeDefined();
      // Oldest accessed (t0) should be the one evicted
      expect(tabs.find((t) => t.id === 't0')).toBeUndefined();
    });

    it('skips eviction of pinned and dirty tabs even if oldest', () => {
      const pinned = makeTab({
        id: 'pinned',
        isPinned: true,
        lastAccessedAt: '2024-01-01T00:00:00Z',
      });
      const dirty = makeTab({
        id: 'dirty',
        isDirty: true,
        lastAccessedAt: '2024-01-01T00:00:01Z',
      });
      const evictable = Array.from({ length: MAX_FILE_TABS - 2 }, (_, i) =>
        makeTab({
          id: `e${i}`,
          lastAccessedAt: `2025-01-01T00:00:0${i}Z`,
        })
      );
      useAppStore.setState({ fileTabs: [pinned, dirty, ...evictable] });

      const newTab = makeTab({ id: 'new' });
      useAppStore.getState().openFileTab(newTab);

      const tabs = useAppStore.getState().fileTabs;
      expect(tabs.find((t) => t.id === 'pinned')).toBeDefined();
      expect(tabs.find((t) => t.id === 'dirty')).toBeDefined();
      expect(tabs.find((t) => t.id === 'new')).toBeDefined();
      // First evictable should have been removed
      expect(tabs.find((t) => t.id === 'e0')).toBeUndefined();
    });

    it('exceeds MAX_FILE_TABS when all tabs are pinned/dirty (data safety)', () => {
      const tabs = Array.from({ length: MAX_FILE_TABS }, (_, i) =>
        makeTab({ id: `t${i}`, isPinned: true })
      );
      useAppStore.setState({ fileTabs: tabs });

      useAppStore.getState().openFileTab(makeTab({ id: 'extra' }));
      expect(useAppStore.getState().fileTabs).toHaveLength(MAX_FILE_TABS + 1);
    });
  });

  describe('closeFileTab', () => {
    it('removes the tab from the array', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      useAppStore.setState({ fileTabs: [t1, t2], selectedFileTabId: 't2' });
      useAppStore.getState().closeFileTab('t1');
      expect(useAppStore.getState().fileTabs.map((t) => t.id)).toEqual(['t2']);
    });

    it('preserves selection when closing a non-selected tab', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      useAppStore.setState({ fileTabs: [t1, t2], selectedFileTabId: 't2' });
      useAppStore.getState().closeFileTab('t1');
      expect(useAppStore.getState().selectedFileTabId).toBe('t2');
    });

    it('selects next tab when closing the selected one', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      const t3 = makeTab({ id: 't3' });
      useAppStore.setState({ fileTabs: [t1, t2, t3], selectedFileTabId: 't2' });
      useAppStore.getState().closeFileTab('t2');
      expect(useAppStore.getState().selectedFileTabId).toBe('t3');
    });

    it('selects previous tab when closing the last tab', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      useAppStore.setState({ fileTabs: [t1, t2], selectedFileTabId: 't2' });
      useAppStore.getState().closeFileTab('t2');
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
    });

    it('clears selection when closing the only tab', () => {
      const t1 = makeTab({ id: 't1' });
      useAppStore.setState({ fileTabs: [t1], selectedFileTabId: 't1' });
      useAppStore.getState().closeFileTab('t1');
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
    });
  });

  describe('selectFileTab', () => {
    it('updates selectedFileTabId and refreshes lastAccessedAt', () => {
      const t1 = makeTab({ id: 't1', lastAccessedAt: '2025-01-01T00:00:00Z' });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().selectFileTab('t1');
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
      expect(useAppStore.getState().fileTabs[0].lastAccessedAt).not.toBe('2025-01-01T00:00:00Z');
    });

    it('handles null id (deselect)', () => {
      useAppStore.setState({ fileTabs: [makeTab({ id: 't1' })], selectedFileTabId: 't1' });
      useAppStore.getState().selectFileTab(null);
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
    });
  });

  describe('updateFileTab', () => {
    it('merges partial updates', () => {
      const t1 = makeTab({ id: 't1', isPinned: false });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().updateFileTab('t1', { isPinned: true });
      expect(useAppStore.getState().fileTabs[0].isPinned).toBe(true);
    });

    it('is a no-op when id does not match', () => {
      const t1 = makeTab({ id: 't1' });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().updateFileTab('missing', { isPinned: true });
      expect(useAppStore.getState().fileTabs[0].isPinned).toBe(false);
    });
  });

  describe('updateFileTabContent', () => {
    it('marks tab dirty when content differs from originalContent', () => {
      const t1 = makeTab({
        id: 't1',
        content: 'orig',
        originalContent: 'orig',
        isDirty: false,
      } as never);
      useAppStore.setState({ fileTabs: [t1] });

      useAppStore.getState().updateFileTabContent('t1', 'modified');

      const updated = useAppStore.getState().fileTabs[0];
      expect((updated as { content: string }).content).toBe('modified');
      expect(updated.isDirty).toBe(true);
    });

    it('clears isDirty when content matches originalContent (revert)', () => {
      const t1 = makeTab({
        id: 't1',
        content: 'modified',
        originalContent: 'orig',
        isDirty: true,
      } as never);
      useAppStore.setState({ fileTabs: [t1] });

      useAppStore.getState().updateFileTabContent('t1', 'orig');
      expect(useAppStore.getState().fileTabs[0].isDirty).toBe(false);
    });

    it('promotes preview tab to persistent on edit', () => {
      const t1 = makeTab({
        id: 't1',
        isPreview: true,
        content: 'orig',
        originalContent: 'orig',
      } as never);
      useAppStore.setState({ fileTabs: [t1] });

      useAppStore.getState().updateFileTabContent('t1', 'changed');
      expect(useAppStore.getState().fileTabs[0].isPreview).toBe(false);
    });
  });

  describe('reorderFileTabs', () => {
    it('moves tab from old index to new index', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      const t3 = makeTab({ id: 't3' });
      useAppStore.setState({ fileTabs: [t1, t2, t3] });

      useAppStore.getState().reorderFileTabs('t3', 't1');
      expect(useAppStore.getState().fileTabs.map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    });

    it('is a no-op when activeId is missing', () => {
      const t1 = makeTab({ id: 't1' });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().reorderFileTabs('missing', 't1');
      expect(useAppStore.getState().fileTabs.map((t) => t.id)).toEqual(['t1']);
    });

    it('is a no-op when overId is missing', () => {
      const t1 = makeTab({ id: 't1' });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().reorderFileTabs('t1', 'missing');
      expect(useAppStore.getState().fileTabs.map((t) => t.id)).toEqual(['t1']);
    });
  });

  describe('pinFileTab', () => {
    it('toggles pin flag', () => {
      const t1 = makeTab({ id: 't1', isPinned: false });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().pinFileTab('t1', true);
      expect(useAppStore.getState().fileTabs[0].isPinned).toBe(true);

      useAppStore.getState().pinFileTab('t1', false);
      expect(useAppStore.getState().fileTabs[0].isPinned).toBe(false);
    });
  });

  describe('closeOtherTabs', () => {
    it('keeps only the specified tab', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      const t3 = makeTab({ id: 't3' });
      useAppStore.setState({ fileTabs: [t1, t2, t3] });

      useAppStore.getState().closeOtherTabs('t2');
      const tabs = useAppStore.getState().fileTabs;
      expect(tabs.map((t) => t.id)).toEqual(['t2']);
      expect(useAppStore.getState().selectedFileTabId).toBe('t2');
    });
  });

  describe('closeTabsToRight', () => {
    it('removes tabs after the specified one', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      const t3 = makeTab({ id: 't3' });
      useAppStore.setState({ fileTabs: [t1, t2, t3] });

      useAppStore.getState().closeTabsToRight('t2');
      expect(useAppStore.getState().fileTabs.map((t) => t.id)).toEqual(['t1', 't2']);
    });

    it('selects the anchor tab when the previously-selected tab was closed', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      const t3 = makeTab({ id: 't3' });
      useAppStore.setState({ fileTabs: [t1, t2, t3], selectedFileTabId: 't3' });

      useAppStore.getState().closeTabsToRight('t2');
      expect(useAppStore.getState().selectedFileTabId).toBe('t2');
    });

    it('preserves selection when previously-selected tab is still present', () => {
      const t1 = makeTab({ id: 't1' });
      const t2 = makeTab({ id: 't2' });
      const t3 = makeTab({ id: 't3' });
      useAppStore.setState({ fileTabs: [t1, t2, t3], selectedFileTabId: 't1' });

      useAppStore.getState().closeTabsToRight('t2');
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
    });

    it('is a no-op when id does not exist', () => {
      const t1 = makeTab({ id: 't1' });
      useAppStore.setState({ fileTabs: [t1] });
      useAppStore.getState().closeTabsToRight('missing');
      expect(useAppStore.getState().fileTabs).toEqual([t1]);
    });
  });

  describe('setPendingCloseFileTabId', () => {
    it('sets and clears the pending id', () => {
      useAppStore.getState().setPendingCloseFileTabId('t1');
      expect(useAppStore.getState().pendingCloseFileTabId).toBe('t1');

      useAppStore.getState().setPendingCloseFileTabId(null);
      expect(useAppStore.getState().pendingCloseFileTabId).toBeNull();
    });
  });

  // ---- selectNextTab / selectPreviousTab (unified file tab + conversation cycling) ----

  describe('selectNextTab / selectPreviousTab', () => {
    function setupSession() {
      const t1 = makeTab({ id: 't1', sessionId: 's1' });
      const t2 = makeTab({ id: 't2', sessionId: 's1' });
      const c1 = createMockConversation({ id: 'c1', sessionId: 's1' }) as Conversation;
      const c2 = createMockConversation({ id: 'c2', sessionId: 's1' }) as Conversation;
      useAppStore.setState({
        fileTabs: [t1, t2],
        conversations: [c1, c2],
        selectedSessionId: 's1',
        selectedFileTabId: 't1',
        selectedConversationId: null,
      });
    }

    it('selectNextTab cycles through file tabs first, then conversations', () => {
      setupSession();

      useAppStore.getState().selectNextTab();
      expect(useAppStore.getState().selectedFileTabId).toBe('t2');

      useAppStore.getState().selectNextTab();
      // Now into conversation territory
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
      expect(useAppStore.getState().selectedConversationId).toBe('c1');
    });

    it('selectNextTab wraps from end back to first', () => {
      setupSession();
      useAppStore.setState({
        selectedFileTabId: null,
        selectedConversationId: 'c2',
      });

      useAppStore.getState().selectNextTab();
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
    });

    it('selectPreviousTab cycles backwards', () => {
      setupSession();
      // Start at t2
      useAppStore.setState({ selectedFileTabId: 't2', selectedConversationId: null });

      useAppStore.getState().selectPreviousTab();
      expect(useAppStore.getState().selectedFileTabId).toBe('t1');
    });

    it('selectPreviousTab wraps from first back to last conversation', () => {
      setupSession();
      // Currently at t1 (first)
      useAppStore.getState().selectPreviousTab();
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
      expect(useAppStore.getState().selectedConversationId).toBe('c2');
    });

    it('selectNextTab updates lastActiveConversationPerSession when navigating to conversation', () => {
      setupSession();
      // From t2 → c1
      useAppStore.setState({ selectedFileTabId: 't2', selectedConversationId: null });
      useAppStore.getState().selectNextTab();
      expect(useAppStore.getState().lastActiveConversationPerSession['s1']).toBe('c1');
    });

    it('selectNextTab clears checkpoints when navigating to a conversation', () => {
      setupSession();
      useAppStore.setState({ checkpoints: [{ uuid: 'cp1' } as never] });

      useAppStore.setState({ selectedFileTabId: 't2', selectedConversationId: null });
      useAppStore.getState().selectNextTab();
      expect(useAppStore.getState().checkpoints).toEqual([]);
    });

    it('is a no-op when no session is selected', () => {
      useAppStore.setState({
        selectedSessionId: null,
        fileTabs: [makeTab({ id: 't1' })],
        selectedFileTabId: null,
      });
      useAppStore.getState().selectNextTab();
      expect(useAppStore.getState().selectedFileTabId).toBeNull();

      useAppStore.getState().selectPreviousTab();
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
    });

    it('is a no-op when session has no tabs or conversations', () => {
      useAppStore.setState({
        selectedSessionId: 's1',
        fileTabs: [],
        conversations: [],
        selectedFileTabId: null,
        selectedConversationId: null,
      });
      useAppStore.getState().selectNextTab();
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
      expect(useAppStore.getState().selectedConversationId).toBeNull();
    });
  });
});
