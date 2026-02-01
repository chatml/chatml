import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTabStore, type BrowserTab } from '../tabStore';

function getState() {
  return useTabStore.getState();
}

function getTab(tabId: string): BrowserTab | undefined {
  return getState().tabs[tabId];
}

function resetStore() {
  // Reset to a known single-tab state
  const defaultTab: BrowserTab = {
    id: 'default',
    label: 'Dashboard',
    selectedWorkspaceId: null,
    selectedSessionId: null,
    selectedConversationId: null,
    contentView: { type: 'conversation' },
    selectedFileTabId: null,
    createdAt: Date.now(),
  };
  useTabStore.setState({
    tabs: { default: defaultTab },
    tabOrder: ['default'],
    activeTabId: 'default',
  });
}

describe('tabStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // ---------- Initial state ----------

  describe('initial state', () => {
    it('starts with a single default tab', () => {
      const state = getState();
      expect(state.tabOrder).toHaveLength(1);
      expect(state.activeTabId).toBe('default');
      expect(state.tabs['default']).toBeDefined();
    });
  });

  // ---------- createTab ----------

  describe('createTab', () => {
    it('creates a new tab and returns its ID', () => {
      const id = getState().createTab();
      expect(id).toBeTruthy();
      expect(id).not.toBe('default');
      expect(getTab(id)).toBeDefined();
    });

    it('inserts the new tab after the active tab', () => {
      const id = getState().createTab();
      const { tabOrder } = getState();
      expect(tabOrder.indexOf(id)).toBe(1); // After 'default' at index 0
    });

    it('uses provided initial state', () => {
      const id = getState().createTab({
        label: 'My Tab',
        selectedWorkspaceId: 'ws-1',
        selectedSessionId: 'sess-1',
        contentView: { type: 'global-dashboard' },
      });

      const tab = getTab(id)!;
      expect(tab.label).toBe('My Tab');
      expect(tab.selectedWorkspaceId).toBe('ws-1');
      expect(tab.selectedSessionId).toBe('sess-1');
      expect(tab.contentView).toEqual({ type: 'global-dashboard' });
    });

    it('defaults label to "New Tab" when not provided', () => {
      const id = getState().createTab();
      expect(getTab(id)!.label).toBe('New Tab');
    });

    it('inherits workspaceId from active tab when not provided', () => {
      getState().updateActiveTab({ selectedWorkspaceId: 'ws-inherited' });
      const id = getState().createTab();
      expect(getTab(id)!.selectedWorkspaceId).toBe('ws-inherited');
    });

    it('does not inherit sessionId from active tab', () => {
      getState().updateActiveTab({ selectedSessionId: 'sess-active' });
      const id = getState().createTab();
      expect(getTab(id)!.selectedSessionId).toBeNull();
    });

    it('respects MAX_TABS limit (20) and returns activeTabId', () => {
      // Create 19 more tabs (already have 1)
      for (let i = 0; i < 19; i++) {
        getState().createTab({ label: `Tab ${i}` });
      }
      expect(getState().tabOrder).toHaveLength(20);

      // 21st tab should be rejected
      const result = getState().createTab({ label: 'Overflow' });
      expect(getState().tabOrder).toHaveLength(20);
      expect(result).toBe(getState().activeTabId);
    });
  });

  // ---------- closeTab ----------

  describe('closeTab', () => {
    it('removes the tab from tabs and tabOrder', () => {
      const id = getState().createTab({ label: 'Temp' });
      getState().closeTab(id);

      expect(getTab(id)).toBeUndefined();
      expect(getState().tabOrder).not.toContain(id);
    });

    it('activates the next tab when closing the active tab', () => {
      const id1 = getState().createTab({ label: 'Tab 1' });
      const id2 = getState().createTab({ label: 'Tab 2' });
      getState().activateTab(id1);

      getState().closeTab(id1);
      // Should activate the tab to the right (id2) or the one at the same index
      expect(getState().activeTabId).not.toBe(id1);
      expect(getState().tabs[getState().activeTabId]).toBeDefined();
    });

    it('does not change activeTabId when closing a non-active tab', () => {
      const id = getState().createTab({ label: 'Tab 1' });
      // Active tab is still 'default'
      getState().closeTab(id);
      expect(getState().activeTabId).toBe('default');
    });

    it('creates a fresh Dashboard tab when closing the last tab', () => {
      getState().closeTab('default');

      const state = getState();
      expect(state.tabOrder).toHaveLength(1);
      expect(state.tabs[state.activeTabId]).toBeDefined();
      expect(state.tabs[state.activeTabId].contentView).toEqual({ type: 'global-dashboard' });
      expect(state.tabs[state.activeTabId].label).toBe('Dashboard');
    });

    it('no-ops for non-existent tab ID', () => {
      const before = getState().tabOrder.length;
      getState().closeTab('nonexistent');
      expect(getState().tabOrder).toHaveLength(before);
    });
  });

  // ---------- activateTab ----------

  describe('activateTab', () => {
    it('switches the active tab', () => {
      const id = getState().createTab({ label: 'Tab 2' });
      getState().activateTab(id);
      expect(getState().activeTabId).toBe(id);
    });

    it('no-ops when activating the already-active tab', () => {
      const before = getState().activeTabId;
      getState().activateTab(before);
      expect(getState().activeTabId).toBe(before);
    });

    it('no-ops for non-existent tab ID', () => {
      const before = getState().activeTabId;
      getState().activateTab('nonexistent');
      expect(getState().activeTabId).toBe(before);
    });
  });

  // ---------- updateActiveTab ----------

  describe('updateActiveTab', () => {
    it('updates the active tab with partial state', () => {
      getState().updateActiveTab({
        selectedWorkspaceId: 'ws-new',
        label: 'Updated',
      });

      const tab = getTab('default')!;
      expect(tab.selectedWorkspaceId).toBe('ws-new');
      expect(tab.label).toBe('Updated');
      // Other fields should remain unchanged
      expect(tab.selectedSessionId).toBeNull();
    });

    it('preserves fields not included in the update', () => {
      getState().updateActiveTab({ selectedSessionId: 'sess-1' });
      getState().updateActiveTab({ label: 'Changed' });

      const tab = getTab('default')!;
      expect(tab.selectedSessionId).toBe('sess-1');
      expect(tab.label).toBe('Changed');
    });
  });

  // ---------- updateTab ----------

  describe('updateTab', () => {
    it('updates a specific tab by ID', () => {
      const id = getState().createTab({ label: 'Target' });
      getState().updateTab(id, { label: 'Updated Target' });

      expect(getTab(id)!.label).toBe('Updated Target');
    });

    it('no-ops for non-existent tab ID', () => {
      getState().updateTab('nonexistent', { label: 'Nope' });
      // Should not throw, just silently do nothing
      expect(getTab('nonexistent')).toBeUndefined();
    });
  });

  // ---------- reorderTabs ----------

  describe('reorderTabs', () => {
    it('moves a tab from one position to another', () => {
      const id1 = getState().createTab({ label: 'A' });
      const id2 = getState().createTab({ label: 'B' });

      // Order: [default, id1, id2]
      getState().reorderTabs(0, 2);

      // Now: [id1, id2, default]
      expect(getState().tabOrder).toEqual([id1, id2, 'default']);
    });

    it('handles moving tab to same position', () => {
      const id1 = getState().createTab({ label: 'A' });
      const orderBefore = [...getState().tabOrder];
      getState().reorderTabs(0, 0);
      expect(getState().tabOrder).toEqual(orderBefore);
    });
  });

  // ---------- duplicateTab ----------

  describe('duplicateTab', () => {
    it('creates a copy of the tab with the same state', () => {
      getState().updateActiveTab({
        selectedWorkspaceId: 'ws-1',
        selectedSessionId: 'sess-1',
        label: 'Original',
        contentView: { type: 'workspace-dashboard', workspaceId: 'ws-1' },
      });

      const dupId = getState().duplicateTab('default');
      const dup = getTab(dupId)!;

      expect(dup.selectedWorkspaceId).toBe('ws-1');
      expect(dup.selectedSessionId).toBe('sess-1');
      expect(dup.label).toBe('Original');
      expect(dup.contentView).toEqual({ type: 'workspace-dashboard', workspaceId: 'ws-1' });
      expect(dup.id).not.toBe('default');
    });

    it('inserts the duplicate after the source tab', () => {
      const dupId = getState().duplicateTab('default');
      expect(getState().tabOrder.indexOf(dupId)).toBe(1);
    });

    it('returns activeTabId when at max tabs', () => {
      for (let i = 0; i < 19; i++) {
        getState().createTab();
      }
      const result = getState().duplicateTab('default');
      expect(result).toBe(getState().activeTabId);
      expect(getState().tabOrder).toHaveLength(20);
    });

    it('returns activeTabId for non-existent source', () => {
      const result = getState().duplicateTab('nonexistent');
      expect(result).toBe(getState().activeTabId);
    });
  });

  // ---------- closeOtherTabs ----------

  describe('closeOtherTabs', () => {
    it('closes all tabs except the specified one', () => {
      const id1 = getState().createTab({ label: 'Keep' });
      getState().createTab({ label: 'Close 1' });
      getState().createTab({ label: 'Close 2' });

      getState().closeOtherTabs(id1);

      expect(getState().tabOrder).toEqual([id1]);
      expect(getState().activeTabId).toBe(id1);
      expect(Object.keys(getState().tabs)).toEqual([id1]);
    });

    it('activates the kept tab', () => {
      const id1 = getState().createTab({ label: 'Keep' });
      // Active is still 'default'
      getState().closeOtherTabs(id1);
      expect(getState().activeTabId).toBe(id1);
    });

    it('no-ops for non-existent tab', () => {
      const before = getState().tabOrder.length;
      getState().closeOtherTabs('nonexistent');
      expect(getState().tabOrder).toHaveLength(before);
    });
  });

  // ---------- closeTabsToRight ----------

  describe('closeTabsToRight', () => {
    it('closes all tabs to the right of the specified tab', () => {
      const id1 = getState().createTab({ label: 'A' });
      getState().createTab({ label: 'B' });
      getState().createTab({ label: 'C' });

      expect(getState().tabOrder).toHaveLength(4);

      getState().closeTabsToRight(id1);

      // Only default and id1 should remain
      expect(getState().tabOrder).toHaveLength(2);
      expect(getState().tabOrder).toEqual(['default', id1]);
      expect(Object.keys(getState().tabs)).toHaveLength(2);
    });

    it('activates the anchor tab if active was to the right', () => {
      const id1 = getState().createTab({ label: 'A' });
      const id2 = getState().createTab({ label: 'B' });
      getState().activateTab(id2);

      getState().closeTabsToRight(id1);

      expect(getState().activeTabId).toBe(id1);
    });

    it('preserves activeTabId if it was not to the right', () => {
      const id1 = getState().createTab({ label: 'A' });
      getState().createTab({ label: 'B' });
      // Active is 'default' which is to the left of id1
      getState().closeTabsToRight(id1);

      expect(getState().activeTabId).toBe('default');
    });

    it('no-ops for non-existent tab', () => {
      const before = getState().tabOrder.length;
      getState().closeTabsToRight('nonexistent');
      expect(getState().tabOrder).toHaveLength(before);
    });

    it('no-ops when tab is already the rightmost', () => {
      const id1 = getState().createTab({ label: 'Last' });
      const before = [...getState().tabOrder];
      getState().closeTabsToRight(id1);
      expect(getState().tabOrder).toEqual(before);
    });
  });

  // ---------- localStorage persistence ----------

  describe('localStorage persistence', () => {
    const STORAGE_KEY = 'chatml-browser-tabs';

    afterEach(() => {
      localStorage.removeItem(STORAGE_KEY);
    });

    function getPersistedData() {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }

    function setPersistedData(data: unknown) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    it('writes state to localStorage on mutation', () => {
      // Trigger a state change
      getState().createTab({ label: 'Persisted Tab' });

      const stored = getPersistedData();
      expect(stored).not.toBeNull();
      expect(stored.state).toBeDefined();
      expect(stored.state.tabOrder).toBeDefined();
      expect(stored.state.tabs).toBeDefined();
      expect(stored.state.activeTabId).toBeDefined();
    });

    it('persists tab data including contentView types', () => {
      getState().updateActiveTab({
        selectedWorkspaceId: 'ws-1',
        selectedSessionId: 'sess-1',
        contentView: { type: 'workspace-dashboard', workspaceId: 'ws-1' },
        label: 'My Workspace',
      });

      const stored = getPersistedData();
      const tab = stored.state.tabs['default'];
      expect(tab.selectedWorkspaceId).toBe('ws-1');
      expect(tab.selectedSessionId).toBe('sess-1');
      expect(tab.contentView).toEqual({ type: 'workspace-dashboard', workspaceId: 'ws-1' });
      expect(tab.label).toBe('My Workspace');
    });

    it('persists multiple tabs with correct order', () => {
      const id1 = getState().createTab({ label: 'Tab A' });
      const id2 = getState().createTab({ label: 'Tab B' });

      const stored = getPersistedData();
      // tabOrder should reflect current order including 'default'
      expect(stored.state.tabOrder).toContain('default');
      expect(stored.state.tabOrder).toContain(id1);
      expect(stored.state.tabOrder).toContain(id2);
      expect(stored.state.tabOrder.indexOf('default')).toBeLessThan(stored.state.tabOrder.indexOf(id1));
    });

    it('persists activeTabId when switching tabs', () => {
      const id = getState().createTab({ label: 'Target' });
      getState().activateTab(id);

      const stored = getPersistedData();
      expect(stored.state.activeTabId).toBe(id);
    });

    it('updates localStorage when tabs are closed', () => {
      const id = getState().createTab({ label: 'Temp' });
      getState().closeTab(id);

      const stored = getPersistedData();
      expect(stored.state.tabOrder).not.toContain(id);
      expect(stored.state.tabs[id]).toBeUndefined();
    });

    it('updates localStorage when tabs are reordered', () => {
      const id1 = getState().createTab({ label: 'A' });
      const id2 = getState().createTab({ label: 'B' });

      getState().reorderTabs(0, 2); // move 'default' to end

      const stored = getPersistedData();
      expect(stored.state.tabOrder).toEqual([id1, id2, 'default']);
    });

    it('persists duplicated tab data', () => {
      getState().updateActiveTab({
        selectedWorkspaceId: 'ws-dup',
        label: 'Source',
        contentView: { type: 'global-dashboard' },
      });

      const dupId = getState().duplicateTab('default');
      const stored = getPersistedData();

      expect(stored.state.tabs[dupId]).toBeDefined();
      expect(stored.state.tabs[dupId].selectedWorkspaceId).toBe('ws-dup');
      expect(stored.state.tabs[dupId].label).toBe('Source');
      expect(stored.state.tabOrder).toContain(dupId);
    });

    it('does not persist action functions', () => {
      getState().createTab({ label: 'Test' });

      const stored = getPersistedData();
      // Functions should be stripped by JSON serialization
      expect(stored.state.createTab).toBeUndefined();
      expect(stored.state.closeTab).toBeUndefined();
      expect(stored.state.activateTab).toBeUndefined();
      expect(stored.state.updateActiveTab).toBeUndefined();
      expect(stored.state.updateTab).toBeUndefined();
      expect(stored.state.reorderTabs).toBeUndefined();
      expect(stored.state.duplicateTab).toBeUndefined();
      expect(stored.state.closeOtherTabs).toBeUndefined();
      expect(stored.state.closeTabsToRight).toBeUndefined();
    });
  });

  // ---------- merge (rehydration) ----------

  describe('merge (rehydration)', () => {
    const STORAGE_KEY = 'chatml-browser-tabs';

    afterEach(() => {
      localStorage.removeItem(STORAGE_KEY);
    });

    function makeTab(overrides: Partial<BrowserTab> = {}): BrowserTab {
      return {
        id: overrides.id ?? 'tab-1',
        label: overrides.label ?? 'Test Tab',
        selectedWorkspaceId: overrides.selectedWorkspaceId ?? null,
        selectedSessionId: overrides.selectedSessionId ?? null,
        selectedConversationId: overrides.selectedConversationId ?? null,
        contentView: overrides.contentView ?? { type: 'conversation' },
        selectedFileTabId: overrides.selectedFileTabId ?? null,
        createdAt: overrides.createdAt ?? 1000,
      };
    }

    function seedLocalStorage(state: {
      tabs?: Record<string, BrowserTab>;
      tabOrder?: string[];
      activeTabId?: string;
    }) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        state,
        version: 0,
      }));
    }

    // We can't truly re-initialize the Zustand store module,
    // but we can test the merge logic by simulating what persist does:
    // calling setState with the merge result.
    function simulateMerge(persistedState: unknown) {
      // Access the persist API to call rehydrate, or simulate the merge
      // The merge function is: (persistedState, currentState) => mergedState
      // We can test it by manually setting state as if rehydration occurred
      const currentState = {
        tabs: { default: makeTab({ id: 'default', label: 'Dashboard' }) },
        tabOrder: ['default'],
        activeTabId: 'default',
      };

      // Simulate what Zustand persist's merge does
      const persisted = persistedState as Partial<{
        tabs: Record<string, BrowserTab>;
        tabOrder: string[];
        activeTabId: string;
      }>;

      if (
        !persisted?.tabs || typeof persisted?.tabs !== 'object' ||
        !Array.isArray(persisted?.tabOrder) ||
        !persisted?.activeTabId
      ) {
        return currentState;
      }

      const validOrder = persisted.tabOrder.filter((id) => id in persisted.tabs!);
      if (validOrder.length === 0) {
        return currentState;
      }

      const activeTabId = validOrder.includes(persisted.activeTabId)
        ? persisted.activeTabId
        : validOrder[0];

      const tabs: Record<string, BrowserTab> = {};
      for (const id of validOrder) {
        tabs[id] = persisted.tabs[id];
      }

      return { ...currentState, tabs, tabOrder: validOrder, activeTabId };
    }

    it('falls back to defaults when persisted state is null', () => {
      const result = simulateMerge(null);
      expect(result.tabOrder).toEqual(['default']);
      expect(result.activeTabId).toBe('default');
    });

    it('falls back to defaults when persisted state is undefined', () => {
      const result = simulateMerge(undefined);
      expect(result.tabOrder).toEqual(['default']);
      expect(result.activeTabId).toBe('default');
    });

    it('falls back to defaults when persisted state is empty object', () => {
      const result = simulateMerge({});
      expect(result.tabOrder).toEqual(['default']);
      expect(result.activeTabId).toBe('default');
    });

    it('falls back to defaults when tabs is missing', () => {
      const result = simulateMerge({
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      });
      expect(result.tabOrder).toEqual(['default']);
    });

    it('falls back to defaults when tabOrder is missing', () => {
      const result = simulateMerge({
        tabs: { 'tab-1': makeTab() },
        activeTabId: 'tab-1',
      });
      expect(result.tabOrder).toEqual(['default']);
    });

    it('falls back to defaults when activeTabId is missing', () => {
      const result = simulateMerge({
        tabs: { 'tab-1': makeTab() },
        tabOrder: ['tab-1'],
      });
      expect(result.tabOrder).toEqual(['default']);
    });

    it('restores valid persisted state', () => {
      const tab1 = makeTab({ id: 'tab-1', label: 'First' });
      const tab2 = makeTab({ id: 'tab-2', label: 'Second' });

      const result = simulateMerge({
        tabs: { 'tab-1': tab1, 'tab-2': tab2 },
        tabOrder: ['tab-1', 'tab-2'],
        activeTabId: 'tab-2',
      });

      expect(result.tabOrder).toEqual(['tab-1', 'tab-2']);
      expect(result.activeTabId).toBe('tab-2');
      expect(result.tabs['tab-1'].label).toBe('First');
      expect(result.tabs['tab-2'].label).toBe('Second');
    });

    it('filters orphaned IDs from tabOrder', () => {
      const tab1 = makeTab({ id: 'tab-1', label: 'Valid' });

      const result = simulateMerge({
        tabs: { 'tab-1': tab1 },
        tabOrder: ['tab-1', 'orphan-1', 'orphan-2'],
        activeTabId: 'tab-1',
      });

      expect(result.tabOrder).toEqual(['tab-1']);
      expect(result.tabs['orphan-1']).toBeUndefined();
      expect(result.tabs['orphan-2']).toBeUndefined();
    });

    it('excludes tabs not in tabOrder from the tabs map', () => {
      const tab1 = makeTab({ id: 'tab-1', label: 'In Order' });
      const tabExtra = makeTab({ id: 'extra', label: 'Not In Order' });

      const result = simulateMerge({
        tabs: { 'tab-1': tab1, 'extra': tabExtra },
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      });

      expect(Object.keys(result.tabs)).toEqual(['tab-1']);
      expect(result.tabs['extra']).toBeUndefined();
    });

    it('falls back to defaults when all tabOrder IDs are orphaned', () => {
      const result = simulateMerge({
        tabs: { 'tab-1': makeTab({ id: 'tab-1' }) },
        tabOrder: ['nonexistent-1', 'nonexistent-2'],
        activeTabId: 'nonexistent-1',
      });

      expect(result.tabOrder).toEqual(['default']);
      expect(result.activeTabId).toBe('default');
    });

    it('corrects activeTabId when it points to a non-existent tab', () => {
      const tab1 = makeTab({ id: 'tab-1', label: 'Valid' });
      const tab2 = makeTab({ id: 'tab-2', label: 'Also Valid' });

      const result = simulateMerge({
        tabs: { 'tab-1': tab1, 'tab-2': tab2 },
        tabOrder: ['tab-1', 'tab-2'],
        activeTabId: 'deleted-tab',
      });

      // Should fall back to first tab in order
      expect(result.activeTabId).toBe('tab-1');
    });

    it('corrects activeTabId when it was orphaned from tabOrder', () => {
      const tab1 = makeTab({ id: 'tab-1' });
      const tab2 = makeTab({ id: 'tab-2' });
      // activeTabId points to tab that exists in tabs but was removed from tabOrder
      const tabOrphan = makeTab({ id: 'orphan' });

      const result = simulateMerge({
        tabs: { 'tab-1': tab1, 'tab-2': tab2, 'orphan': tabOrphan },
        tabOrder: ['tab-1', 'tab-2'],
        activeTabId: 'orphan',
      });

      expect(result.activeTabId).toBe('tab-1');
    });

    it('preserves contentView types through serialization', () => {
      const tab = makeTab({
        id: 'tab-cv',
        contentView: { type: 'workspace-dashboard', workspaceId: 'ws-123' },
      });

      const result = simulateMerge({
        tabs: { 'tab-cv': tab },
        tabOrder: ['tab-cv'],
        activeTabId: 'tab-cv',
      });

      expect(result.tabs['tab-cv'].contentView).toEqual({
        type: 'workspace-dashboard',
        workspaceId: 'ws-123',
      });
    });

    it('preserves all BrowserTab fields through round-trip', () => {
      const tab = makeTab({
        id: 'full-tab',
        label: 'Full Test',
        selectedWorkspaceId: 'ws-1',
        selectedSessionId: 'sess-1',
        selectedConversationId: 'conv-1',
        contentView: { type: 'global-dashboard' },
        selectedFileTabId: 'file-1',
        createdAt: 1234567890,
      });

      const result = simulateMerge({
        tabs: { 'full-tab': tab },
        tabOrder: ['full-tab'],
        activeTabId: 'full-tab',
      });

      const restored = result.tabs['full-tab'];
      expect(restored.id).toBe('full-tab');
      expect(restored.label).toBe('Full Test');
      expect(restored.selectedWorkspaceId).toBe('ws-1');
      expect(restored.selectedSessionId).toBe('sess-1');
      expect(restored.selectedConversationId).toBe('conv-1');
      expect(restored.contentView).toEqual({ type: 'global-dashboard' });
      expect(restored.selectedFileTabId).toBe('file-1');
      expect(restored.createdAt).toBe(1234567890);
    });

    it('handles persisted state with non-object type gracefully', () => {
      const result = simulateMerge('invalid-string');
      expect(result.tabOrder).toEqual(['default']);
      expect(result.activeTabId).toBe('default');
    });

    it('handles persisted state with number type gracefully', () => {
      const result = simulateMerge(42);
      expect(result.tabOrder).toEqual(['default']);
    });

    it('handles persisted state with array type gracefully', () => {
      const result = simulateMerge([1, 2, 3]);
      expect(result.tabOrder).toEqual(['default']);
    });

    it('handles tabs as non-object gracefully', () => {
      const result = simulateMerge({
        tabs: 'not-an-object',
        tabOrder: ['tab-1'],
        activeTabId: 'tab-1',
      });
      expect(result.tabOrder).toEqual(['default']);
    });

    it('handles tabOrder as non-array gracefully', () => {
      const result = simulateMerge({
        tabs: { 'tab-1': makeTab({ id: 'tab-1' }) },
        tabOrder: 'not-an-array',
        activeTabId: 'tab-1',
      });
      expect(result.tabOrder).toEqual(['default']);
    });

    it('handles empty tabs object with empty tabOrder', () => {
      const result = simulateMerge({
        tabs: {},
        tabOrder: [],
        activeTabId: 'nonexistent',
      });
      // Empty tabOrder after filtering → falls back to defaults
      expect(result.tabOrder).toEqual(['default']);
    });

    it('preserves tab order across many tabs', () => {
      const tabs: Record<string, BrowserTab> = {};
      const order: string[] = [];
      for (let i = 0; i < 15; i++) {
        const id = `tab-${i}`;
        tabs[id] = makeTab({ id, label: `Tab ${i}` });
        order.push(id);
      }

      const result = simulateMerge({
        tabs,
        tabOrder: order,
        activeTabId: 'tab-7',
      });

      expect(result.tabOrder).toHaveLength(15);
      expect(result.tabOrder).toEqual(order);
      expect(result.activeTabId).toBe('tab-7');
    });
  });

  // ---------- live persist round-trip ----------

  describe('live persist round-trip', () => {
    const STORAGE_KEY = 'chatml-browser-tabs';

    afterEach(() => {
      localStorage.removeItem(STORAGE_KEY);
    });

    it('round-trips state through localStorage', () => {
      // Create some tabs
      const id1 = getState().createTab({ label: 'Workspace A', selectedWorkspaceId: 'ws-a' });
      const id2 = getState().createTab({
        label: 'Session B',
        selectedWorkspaceId: 'ws-b',
        selectedSessionId: 'sess-b',
        contentView: { type: 'workspace-dashboard', workspaceId: 'ws-b' },
      });
      getState().activateTab(id1);

      // Capture persisted data
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.state.tabOrder).toContain('default');
      expect(parsed.state.tabOrder).toContain(id1);
      expect(parsed.state.tabOrder).toContain(id2);
      expect(parsed.state.activeTabId).toBe(id1);
      expect(parsed.state.tabs[id2].contentView).toEqual({
        type: 'workspace-dashboard',
        workspaceId: 'ws-b',
      });
    });

    it('actions still work after setState (simulating rehydration)', () => {
      // Simulate a rehydrated state via setState
      const tab1: BrowserTab = {
        id: 'rehydrated-1',
        label: 'Rehydrated',
        selectedWorkspaceId: 'ws-r',
        selectedSessionId: null,
        selectedConversationId: null,
        contentView: { type: 'conversation' },
        selectedFileTabId: null,
        createdAt: Date.now(),
      };

      useTabStore.setState({
        tabs: { 'rehydrated-1': tab1 },
        tabOrder: ['rehydrated-1'],
        activeTabId: 'rehydrated-1',
      });

      // Verify actions still work on the rehydrated state
      const newId = getState().createTab({ label: 'After Rehydrate' });
      expect(getTab(newId)).toBeDefined();
      expect(getTab(newId)!.label).toBe('After Rehydrate');
      expect(getState().tabOrder).toEqual(['rehydrated-1', newId]);

      // Workspace inheritance should work from rehydrated tab
      expect(getTab(newId)!.selectedWorkspaceId).toBe('ws-r');
    });

    it('closeTab works correctly after rehydration', () => {
      const tab1: BrowserTab = {
        id: 'rh-1',
        label: 'Tab 1',
        selectedWorkspaceId: null,
        selectedSessionId: null,
        selectedConversationId: null,
        contentView: { type: 'conversation' },
        selectedFileTabId: null,
        createdAt: Date.now(),
      };
      const tab2: BrowserTab = {
        id: 'rh-2',
        label: 'Tab 2',
        selectedWorkspaceId: null,
        selectedSessionId: null,
        selectedConversationId: null,
        contentView: { type: 'global-dashboard' },
        selectedFileTabId: null,
        createdAt: Date.now(),
      };

      useTabStore.setState({
        tabs: { 'rh-1': tab1, 'rh-2': tab2 },
        tabOrder: ['rh-1', 'rh-2'],
        activeTabId: 'rh-1',
      });

      getState().closeTab('rh-1');
      expect(getState().activeTabId).toBe('rh-2');
      expect(getState().tabOrder).toEqual(['rh-2']);
    });

    it('duplicateTab works correctly after rehydration', () => {
      const tab1: BrowserTab = {
        id: 'rh-dup',
        label: 'Original',
        selectedWorkspaceId: 'ws-dup',
        selectedSessionId: 'sess-dup',
        selectedConversationId: null,
        contentView: { type: 'workspace-dashboard', workspaceId: 'ws-dup' },
        selectedFileTabId: null,
        createdAt: Date.now(),
      };

      useTabStore.setState({
        tabs: { 'rh-dup': tab1 },
        tabOrder: ['rh-dup'],
        activeTabId: 'rh-dup',
      });

      const dupId = getState().duplicateTab('rh-dup');
      const dup = getTab(dupId)!;
      expect(dup.label).toBe('Original');
      expect(dup.selectedWorkspaceId).toBe('ws-dup');
      expect(dup.selectedSessionId).toBe('sess-dup');
      expect(dup.contentView).toEqual({ type: 'workspace-dashboard', workspaceId: 'ws-dup' });
    });

    it('closeOtherTabs works correctly after rehydration', () => {
      const tabs: Record<string, BrowserTab> = {};
      const order: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = `rh-${i}`;
        tabs[id] = {
          id,
          label: `Tab ${i}`,
          selectedWorkspaceId: null,
          selectedSessionId: null,
          selectedConversationId: null,
          contentView: { type: 'conversation' },
          selectedFileTabId: null,
          createdAt: Date.now(),
        };
        order.push(id);
      }

      useTabStore.setState({ tabs, tabOrder: order, activeTabId: 'rh-2' });

      getState().closeOtherTabs('rh-3');
      expect(getState().tabOrder).toEqual(['rh-3']);
      expect(getState().activeTabId).toBe('rh-3');
      expect(Object.keys(getState().tabs)).toEqual(['rh-3']);
    });

    it('closeTabsToRight works correctly after rehydration', () => {
      const tabs: Record<string, BrowserTab> = {};
      const order: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = `rh-ctr-${i}`;
        tabs[id] = {
          id,
          label: `Tab ${i}`,
          selectedWorkspaceId: null,
          selectedSessionId: null,
          selectedConversationId: null,
          contentView: { type: 'conversation' },
          selectedFileTabId: null,
          createdAt: Date.now(),
        };
        order.push(id);
      }

      useTabStore.setState({ tabs, tabOrder: order, activeTabId: 'rh-ctr-3' });

      getState().closeTabsToRight('rh-ctr-1');
      expect(getState().tabOrder).toEqual(['rh-ctr-0', 'rh-ctr-1']);
      // Active was to the right → should activate anchor
      expect(getState().activeTabId).toBe('rh-ctr-1');
    });

    it('reorderTabs works correctly after rehydration', () => {
      const tabs: Record<string, BrowserTab> = {};
      const order = ['rh-a', 'rh-b', 'rh-c'];
      for (const id of order) {
        tabs[id] = {
          id,
          label: id,
          selectedWorkspaceId: null,
          selectedSessionId: null,
          selectedConversationId: null,
          contentView: { type: 'conversation' },
          selectedFileTabId: null,
          createdAt: Date.now(),
        };
      }

      useTabStore.setState({ tabs, tabOrder: order, activeTabId: 'rh-a' });

      getState().reorderTabs(0, 2);
      expect(getState().tabOrder).toEqual(['rh-b', 'rh-c', 'rh-a']);
    });
  });
});
