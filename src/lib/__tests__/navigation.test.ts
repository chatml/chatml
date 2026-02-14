import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNavigationStore, type NavigationEntry } from '@/stores/navigationStore';
import type { ContentView } from '@/stores/settingsStore';

// We test the real navigation module against the real navigationStore,
// but mock appStore and settingsStore since they have heavy dependencies.

const mockSelectWorkspace = vi.fn();
const mockSelectSession = vi.fn();
const mockSelectConversation = vi.fn();
const mockSetContentView = vi.fn();

const mockAppState = {
  selectedWorkspaceId: 'ws-1',
  selectedSessionId: 'sess-1',
  selectedConversationId: 'conv-1',
  workspaces: [{ id: 'ws-1', name: 'My Repo' }],
  sessions: [{ id: 'sess-1', name: 'boston', branch: 'main', workspaceId: 'ws-1' }],
  conversations: [{ id: 'conv-1', name: 'Task Chat', sessionId: 'sess-1' }],
  selectWorkspace: mockSelectWorkspace,
  selectSession: mockSelectSession,
  selectConversation: mockSelectConversation,
};

const mockSettingsState = {
  contentView: { type: 'conversation' } as ContentView,
  setContentView: mockSetContentView,
  markWorkspaceRead: vi.fn(),
};

vi.mock('@/stores/appStore', () => ({
  useAppStore: {
    getState: () => mockAppState,
  },
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

const mockUpdateActiveTab = vi.fn();
const mockTabStoreState = {
  activeTabId: 'default',
  tabs: { default: { id: 'default', label: 'Dashboard' } },
  tabOrder: ['default'],
  updateActiveTab: mockUpdateActiveTab,
  createTab: vi.fn(() => 'new-tab'),
  activateTab: vi.fn(),
};

vi.mock('@/stores/tabStore', () => ({
  useTabStore: {
    getState: () => mockTabStoreState,
  },
}));

// Import after mocks are set up
const { navigate, goBack, goForward, goToBackEntry, goToForwardEntry } = await import('../navigation');

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

function resetNavStore() {
  useNavigationStore.setState({
    tabs: { default: { backStack: [], forwardStack: [] } },
    activeTabId: 'default',
    isRestoring: false,
  });
}

function getTab(tabId = 'default') {
  return useNavigationStore.getState().tabs[tabId];
}

describe('navigation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNavStore();
    // Reset mock state to defaults
    mockAppState.selectedWorkspaceId = 'ws-1';
    mockAppState.selectedSessionId = 'sess-1';
    mockAppState.selectedConversationId = 'conv-1';
    mockSettingsState.contentView = { type: 'conversation' };
    mockAppState.workspaces = [{ id: 'ws-1', name: 'My Repo' }];
    mockAppState.sessions = [{ id: 'sess-1', name: 'boston', branch: 'main', workspaceId: 'ws-1' }];
    mockAppState.conversations = [{ id: 'conv-1', name: 'Task Chat', sessionId: 'sess-1' }];
    mockTabStoreState.activeTabId = 'default';
  });

  // ---------- navigate ----------

  describe('navigate', () => {
    it('calls selectWorkspace when workspaceId is provided', () => {
      navigate({ workspaceId: 'ws-2' });
      expect(mockSelectWorkspace).toHaveBeenCalledWith('ws-2');
    });

    it('calls selectSession when sessionId is provided', () => {
      navigate({ sessionId: 'sess-2' });
      expect(mockSelectSession).toHaveBeenCalledWith('sess-2');
    });

    it('calls selectConversation when conversationId is provided', () => {
      navigate({ conversationId: 'conv-2' });
      expect(mockSelectConversation).toHaveBeenCalledWith('conv-2');
    });

    it('calls setContentView when contentView is provided', () => {
      navigate({ contentView: { type: 'repositories' } });
      expect(mockSetContentView).toHaveBeenCalledWith({ type: 'repositories' });
    });

    it('pushes current state onto backStack before navigating', () => {
      navigate({ contentView: { type: 'repositories' } });

      const tab = getTab();
      expect(tab.backStack).toHaveLength(1);
      expect(tab.backStack[0].workspaceId).toBe('ws-1');
      expect(tab.backStack[0].sessionId).toBe('sess-1');
      expect(tab.backStack[0].contentView.type).toBe('conversation');
    });

    it('generates a breadcrumb label from current state when pushing history', () => {
      // Current state has conversation with conv-1 named 'Task Chat' in workspace 'My Repo'
      navigate({ contentView: { type: 'repositories' } });

      const tab = getTab();
      expect(tab.backStack[0].label).toBe('My Repo › Task Chat');
    });

    it('generates breadcrumb branches label', () => {
      mockSettingsState.contentView = { type: 'branches', workspaceId: 'ws-1' };
      navigate({ contentView: { type: 'conversation' } });

      expect(getTab().backStack[0].label).toBe('My Repo › Branches');
    });

    it('generates breadcrumb PR dashboard label', () => {
      mockSettingsState.contentView = { type: 'pr-dashboard', workspaceId: 'ws-1' };
      navigate({ contentView: { type: 'conversation' } });

      expect(getTab().backStack[0].label).toBe('My Repo › Pull Requests');
    });

    it('generates session-manager label', () => {
      mockSettingsState.contentView = { type: 'session-manager' };
      navigate({ contentView: { type: 'conversation' } });

      expect(getTab().backStack[0].label).toBe('Sessions');
    });

    it('generates repositories label', () => {
      mockSettingsState.contentView = { type: 'repositories' };
      navigate({ contentView: { type: 'conversation' } });

      expect(getTab().backStack[0].label).toBe('Repositories');
    });

    it('falls back to breadcrumb session name when no conversation is selected', () => {
      mockAppState.selectedConversationId = null as unknown as string;
      mockAppState.conversations = [];
      navigate({ contentView: { type: 'repositories' } });

      expect(getTab().backStack[0].label).toBe('My Repo › boston');
    });

    it('skips history push when isRestoring is true', () => {
      useNavigationStore.getState().setRestoring(true);

      navigate({ contentView: { type: 'repositories' } });

      expect(getTab().backStack).toHaveLength(0);
      // But still applies the navigation
      expect(mockSetContentView).toHaveBeenCalledWith({ type: 'repositories' });
    });

    it('handles partial params (only contentView)', () => {
      navigate({ contentView: { type: 'repositories' } });

      expect(mockSelectWorkspace).not.toHaveBeenCalled();
      expect(mockSelectSession).not.toHaveBeenCalled();
      expect(mockSelectConversation).not.toHaveBeenCalled();
      expect(mockSetContentView).toHaveBeenCalledWith({ type: 'repositories' });
    });

    it('handles null workspaceId and sessionId', () => {
      navigate({ workspaceId: null, sessionId: null });

      expect(mockSelectWorkspace).toHaveBeenCalledWith(null);
      expect(mockSelectSession).toHaveBeenCalledWith(null);
    });
  });

  // ---------- goBack ----------

  describe('goBack', () => {
    it('restores the most recent back entry', () => {
      const entry = makeEntry({
        workspaceId: 'ws-prev',
        sessionId: 'sess-prev',
        conversationId: 'conv-prev',
        contentView: { type: 'repositories' },
      });
      useNavigationStore.setState({
        tabs: { default: { backStack: [entry], forwardStack: [] } },
      });

      goBack();

      expect(mockSelectWorkspace).toHaveBeenCalledWith('ws-prev');
      expect(mockSelectSession).toHaveBeenCalledWith('sess-prev');
      expect(mockSelectConversation).toHaveBeenCalledWith('conv-prev');
      expect(mockSetContentView).toHaveBeenCalledWith({ type: 'repositories' });
    });

    it('pushes current state to forwardStack', () => {
      // Add sess-prev to sessions so the back entry is valid
      mockAppState.sessions = [
        { id: 'sess-1', name: 'boston', branch: 'main', workspaceId: 'ws-1' },
        { id: 'sess-prev', name: 'prev', branch: 'feat', workspaceId: 'ws-1' },
      ];
      useNavigationStore.setState({
        tabs: { default: { backStack: [makeEntry({ sessionId: 'sess-prev' })], forwardStack: [] } },
      });

      goBack();

      const tab = getTab();
      expect(tab.forwardStack.length).toBeGreaterThanOrEqual(1);
      // The current state (ws-1, sess-1) should be on the forward stack
      const fwd = tab.forwardStack[tab.forwardStack.length - 1];
      expect(fwd.workspaceId).toBe('ws-1');
      expect(fwd.sessionId).toBe('sess-1');
    });

    it('no-ops on empty backStack', () => {
      goBack();

      expect(mockSelectWorkspace).not.toHaveBeenCalled();
      expect(mockSelectSession).not.toHaveBeenCalled();
    });

    it('skips invalid entries (deleted session) and discards them', () => {
      const invalidEntry = makeEntry({ sessionId: 'deleted-sess', label: 'invalid' });
      const validEntry = makeEntry({ sessionId: 'sess-1', label: 'valid' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [validEntry, invalidEntry], forwardStack: [] } },
      });
      // sess-1 exists in mockAppState.sessions but deleted-sess does not

      goBack();

      // Should skip the invalid entry and apply the valid one
      expect(mockSelectSession).toHaveBeenCalledWith('sess-1');

      // Invalid entry should be discarded, not pushed to forward stack
      const tab = getTab();
      const forwardLabels = tab.forwardStack.map((e) => e.label);
      expect(forwardLabels).not.toContain('invalid');
    });

    it('sets and clears isRestoring during apply', () => {
      const restoreStates: boolean[] = [];
      const origSelectWorkspace = mockSelectWorkspace;
      mockAppState.selectWorkspace = vi.fn((...args) => {
        restoreStates.push(useNavigationStore.getState().isRestoring);
        return origSelectWorkspace(...args);
      });

      useNavigationStore.setState({
        tabs: { default: { backStack: [makeEntry()], forwardStack: [] } },
      });

      goBack();

      expect(restoreStates).toContain(true);
      expect(useNavigationStore.getState().isRestoring).toBe(false);

      // Restore mock
      mockAppState.selectWorkspace = mockSelectWorkspace;
    });
  });

  // ---------- goForward ----------

  describe('goForward', () => {
    it('restores the most recent forward entry', () => {
      // Use a non-conversation contentView so isEntryValid doesn't need matching sessions
      const entry = makeEntry({
        workspaceId: 'ws-1',
        sessionId: null,
        contentView: { type: 'repositories' },
      });
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: [entry] } },
      });

      goForward();

      expect(mockSelectWorkspace).toHaveBeenCalledWith('ws-1');
      expect(mockSelectSession).toHaveBeenCalledWith(null);
      expect(mockSetContentView).toHaveBeenCalledWith({ type: 'repositories' });
    });

    it('pushes current state to backStack', () => {
      // Use a repositories view so the entry is always valid
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: [makeEntry({ sessionId: null, contentView: { type: 'repositories' } })] } },
      });

      goForward();

      const tab = getTab();
      expect(tab.backStack.length).toBeGreaterThanOrEqual(1);
      const back = tab.backStack[tab.backStack.length - 1];
      expect(back.workspaceId).toBe('ws-1');
    });

    it('no-ops on empty forwardStack', () => {
      goForward();

      expect(mockSelectWorkspace).not.toHaveBeenCalled();
    });

    it('skips invalid entries (deleted workspace) and discards them', () => {
      const invalidEntry = makeEntry({
        workspaceId: 'deleted-ws',
        contentView: { type: 'conversation' },
        label: 'invalid',
      });
      const validEntry = makeEntry({
        workspaceId: 'ws-1',
        contentView: { type: 'conversation' },
        label: 'valid',
      });
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: [validEntry, invalidEntry] } },
      });

      goForward();

      // Should skip the invalid entry (deleted-ws) and apply the valid one
      expect(mockSelectWorkspace).toHaveBeenCalledWith('ws-1');

      // Invalid entry should be discarded, not pushed to back stack
      const tab = getTab();
      const backLabels = tab.backStack.map((e) => e.label);
      expect(backLabels).not.toContain('invalid');
    });
  });

  // ---------- goToBackEntry ----------

  describe('goToBackEntry', () => {
    it('jumps to a specific back entry by index', () => {
      const entries = [
        makeEntry({ label: 'oldest', sessionId: 'sess-0' }),
        makeEntry({ label: 'middle', sessionId: 'sess-1' }),
        makeEntry({ label: 'newest', sessionId: 'sess-1' }),
      ];
      useNavigationStore.setState({
        tabs: { default: { backStack: entries, forwardStack: [] } },
      });

      // index 0 = most recent back entry
      goToBackEntry(0);

      expect(mockSelectSession).toHaveBeenCalled();
    });

    it('does not apply an invalid entry', () => {
      const invalidEntry = makeEntry({ sessionId: 'gone', label: 'deleted' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [invalidEntry], forwardStack: [] } },
      });

      goToBackEntry(0);

      expect(mockSelectWorkspace).not.toHaveBeenCalled();
    });
  });

  // ---------- goToForwardEntry ----------

  describe('goToForwardEntry', () => {
    it('jumps to a specific forward entry by index', () => {
      const entries = [
        makeEntry({ label: 'fwd-oldest', sessionId: 'sess-0' }),
        makeEntry({ label: 'fwd-newest', sessionId: 'sess-1' }),
      ];
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: entries } },
      });

      goToForwardEntry(0);

      expect(mockSelectSession).toHaveBeenCalled();
    });

    it('does not apply an invalid entry', () => {
      const invalidEntry = makeEntry({ conversationId: 'gone', label: 'deleted' });
      useNavigationStore.setState({
        tabs: { default: { backStack: [], forwardStack: [invalidEntry] } },
      });

      goToForwardEntry(0);

      expect(mockSelectWorkspace).not.toHaveBeenCalled();
    });
  });

  // ---------- Entry validation ----------

  describe('entry validation (via goBack)', () => {
    it('considers global views valid even without matching data', () => {
      const entry = makeEntry({
        contentView: { type: 'repositories' },
        sessionId: null,
        workspaceId: null,
        conversationId: null,
      });
      useNavigationStore.setState({
        tabs: { default: { backStack: [entry], forwardStack: [] } },
      });

      goBack();

      expect(mockSetContentView).toHaveBeenCalledWith({ type: 'repositories' });
    });

    it('rejects branches view when workspace is deleted', () => {
      const entry = makeEntry({
        contentView: { type: 'branches', workspaceId: 'deleted-ws' },
        sessionId: null,
        conversationId: null,
      });
      useNavigationStore.setState({
        tabs: { default: { backStack: [entry], forwardStack: [] } },
      });

      goBack();

      // Should not apply since workspace is deleted
      expect(mockSetContentView).not.toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'deleted-ws' })
      );
    });

    it('rejects conversation view when session is deleted', () => {
      const entry = makeEntry({
        sessionId: 'deleted-sess',
        contentView: { type: 'conversation' },
      });
      useNavigationStore.setState({
        tabs: { default: { backStack: [entry], forwardStack: [] } },
      });

      goBack();

      expect(mockSelectSession).not.toHaveBeenCalledWith('deleted-sess');
    });
  });
});
