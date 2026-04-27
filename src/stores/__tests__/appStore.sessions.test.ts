import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { useAppStore } from '../appStore';
import { useSettingsStore } from '../settingsStore';
import { server } from '@/__mocks__/server';
import {
  createMockSession,
  createMockConversation,
} from '@/test-utils/store-utils';
import type { WorktreeSession } from '@/lib/types';

// selectSession triggers a background refreshPRStatus POST. MSW config is set to
// `onUnhandledRequest: 'error'`, so we install a no-op handler at the suite level.
const API_BASE = 'http://localhost:9876';

const s1 = createMockSession({ id: 's1', workspaceId: 'ws-1' }) as WorktreeSession;
const s2 = createMockSession({ id: 's2', workspaceId: 'ws-1' }) as WorktreeSession;
const s3 = createMockSession({ id: 's3', workspaceId: 'ws-2' }) as WorktreeSession;

describe('appStore — session actions', () => {
  beforeEach(() => {
    server.use(
      http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-refresh`, () =>
        new HttpResponse(null, { status: 202 })
      )
    );
    useAppStore.setState({
      sessions: [],
      conversations: [],
      conversationIds: new Set(),
      conversationsBySession: {},
      messagesByConversation: {},
      streamingState: {},
      activeTools: {},
      agentTodos: {},
      contextUsage: {},
      queuedMessages: {},
      messagePagination: {},
      customTodos: {},
      sessionOutputs: {},
      reviewComments: {},
      lastActiveConversationPerSession: {},
      sessionToggleState: {},
      draftInputs: {},
      terminalInstances: {},
      activeTerminalId: {},
      terminalPanelVisible: {},
      claudeTerminals: {},
      activeClaudeTerminalId: {},
      scriptOutputVersions: {},
      selectedSessionId: null,
      selectedConversationId: null,
      selectedFileTabId: null,
      fileTabs: [],
    });
    useSettingsStore.setState({
      markSessionRead: vi.fn(),
      markSessionUnread: vi.fn(),
      showBaseBranchSessions: false,
    } as never);
  });

  // ---- Basic CRUD --------------------------------------------------------------

  describe('setSessions', () => {
    it('replaces the sessions array', () => {
      useAppStore.getState().setSessions([s1, s2]);
      expect(useAppStore.getState().sessions).toHaveLength(2);

      useAppStore.getState().setSessions([s3]);
      expect(useAppStore.getState().sessions).toEqual([s3]);
    });
  });

  describe('addSession', () => {
    it('prepends to the sessions array', () => {
      useAppStore.getState().setSessions([s1]);
      useAppStore.getState().addSession(s2);
      expect(useAppStore.getState().sessions.map((s) => s.id)).toEqual(['s2', 's1']);
    });
  });

  describe('updateSession', () => {
    it('merges partial updates onto matching session', () => {
      useAppStore.getState().setSessions([s1, s2]);
      useAppStore.getState().updateSession('s1', { name: 'Renamed' });
      expect(useAppStore.getState().sessions.find((s) => s.id === 's1')?.name).toBe('Renamed');
      expect(useAppStore.getState().sessions.find((s) => s.id === 's2')?.name).toBe('Test Session');
    });

    it('is a no-op when id does not match', () => {
      useAppStore.getState().setSessions([s1]);
      useAppStore.getState().updateSession('missing', { name: 'x' } as never);
      expect(useAppStore.getState().sessions).toEqual([s1]);
    });
  });

  // ---- removeSession cascade ----------------------------------------------------

  describe('removeSession cascade', () => {
    it('removes the session and its conversations + messages', () => {
      const conv = createMockConversation({ id: 'c1', sessionId: 's1' });
      const otherConv = createMockConversation({ id: 'c2', sessionId: 's2' });

      useAppStore.setState({
        sessions: [s1, s2],
        conversations: [conv as never, otherConv as never],
        conversationIds: new Set(['c1', 'c2']),
        conversationsBySession: { s1: [conv as never], s2: [otherConv as never] },
        messagesByConversation: { c1: [{ id: 'm1' }] as never, c2: [] },
      });

      useAppStore.getState().removeSession('s1');

      const state = useAppStore.getState();
      expect(state.sessions.map((s) => s.id)).toEqual(['s2']);
      expect(state.conversations.map((c) => c.id)).toEqual(['c2']);
      expect(state.conversationIds.has('c1')).toBe(false);
      expect(state.messagesByConversation['c1']).toBeUndefined();
      expect(state.conversationsBySession['s1']).toBeUndefined();
    });

    it('clears per-conversation maps for removed session', () => {
      const conv = createMockConversation({ id: 'c1', sessionId: 's1' });
      useAppStore.setState({
        sessions: [s1],
        conversations: [conv as never],
        conversationIds: new Set(['c1']),
        conversationsBySession: { s1: [conv as never] },
        streamingState: { c1: {} as never },
        activeTools: { c1: [] as never },
        agentTodos: { c1: [] as never },
        contextUsage: { c1: {} as never },
        queuedMessages: { c1: [] as never },
        messagePagination: { c1: { hasMore: true } as never },
      });

      useAppStore.getState().removeSession('s1');

      const state = useAppStore.getState();
      expect(state.streamingState['c1']).toBeUndefined();
      expect(state.activeTools['c1']).toBeUndefined();
      expect(state.agentTodos['c1']).toBeUndefined();
      expect(state.contextUsage['c1']).toBeUndefined();
      expect(state.queuedMessages['c1']).toBeUndefined();
      expect(state.messagePagination['c1']).toBeUndefined();
    });

    it('clears session-keyed slices', () => {
      useAppStore.setState({
        sessions: [s1],
        customTodos: { s1: [] as never, s2: [] as never },
        sessionOutputs: { s1: [] as never },
        reviewComments: { s1: [] as never },
        sessionToggleState: { s1: {} as never },
        draftInputs: { s1: { text: 'x', attachments: [] } },
        terminalInstances: { s1: {} as never },
        activeTerminalId: { s1: 't1' },
        terminalPanelVisible: { s1: true },
        claudeTerminals: { s1: {} as never },
        activeClaudeTerminalId: { s1: 'ct1' },
      });

      useAppStore.getState().removeSession('s1');

      const state = useAppStore.getState();
      expect(state.customTodos['s1']).toBeUndefined();
      expect(state.customTodos['s2']).toBeDefined();
      expect(state.sessionOutputs['s1']).toBeUndefined();
      expect(state.reviewComments['s1']).toBeUndefined();
      expect(state.sessionToggleState['s1']).toBeUndefined();
      expect(state.draftInputs['s1']).toBeUndefined();
      expect(state.terminalInstances['s1']).toBeUndefined();
      expect(state.activeTerminalId['s1']).toBeUndefined();
      expect(state.terminalPanelVisible['s1']).toBeUndefined();
      expect(state.claudeTerminals['s1']).toBeUndefined();
      expect(state.activeClaudeTerminalId['s1']).toBeUndefined();
    });

    it('clears selectedSessionId / selectedConversationId when removing the selected session', () => {
      const conv = createMockConversation({ id: 'c1', sessionId: 's1' });
      useAppStore.setState({
        sessions: [s1],
        conversations: [conv as never],
        conversationIds: new Set(['c1']),
        selectedSessionId: 's1',
        selectedConversationId: 'c1',
        selectedFileTabId: 'tab-1',
        fileTabs: [{ id: 'tab-1', sessionId: 's1' }] as never,
      });

      useAppStore.getState().removeSession('s1');

      const state = useAppStore.getState();
      expect(state.selectedSessionId).toBeNull();
      expect(state.selectedConversationId).toBeNull();
      expect(state.selectedFileTabId).toBeNull();
      expect(state.fileTabs).toEqual([]);
    });

    it('preserves selectedSessionId when removing an unrelated session', () => {
      useAppStore.setState({
        sessions: [s1, s2],
        selectedSessionId: 's2',
      });
      useAppStore.getState().removeSession('s1');
      expect(useAppStore.getState().selectedSessionId).toBe('s2');
    });
  });

  // ---- selectSession ----------------------------------------------------------

  describe('selectSession', () => {
    it('updates selectedSessionId', () => {
      useAppStore.setState({ sessions: [s1, s2] });
      useAppStore.getState().selectSession('s1');
      expect(useAppStore.getState().selectedSessionId).toBe('s1');
    });

    it("auto-selects the first conversation in the session", () => {
      const c1 = createMockConversation({ id: 'c1', sessionId: 's1' });
      const c2 = createMockConversation({ id: 'c2', sessionId: 's1' });
      useAppStore.setState({
        sessions: [s1],
        conversations: [c1 as never, c2 as never],
        conversationIds: new Set(['c1', 'c2']),
      });

      useAppStore.getState().selectSession('s1');
      expect(useAppStore.getState().selectedConversationId).toBe('c1');
    });

    it('restores last active conversation when one was remembered', () => {
      const c1 = createMockConversation({ id: 'c1', sessionId: 's1' });
      const c2 = createMockConversation({ id: 'c2', sessionId: 's1' });
      useAppStore.setState({
        sessions: [s1],
        conversations: [c1 as never, c2 as never],
        conversationIds: new Set(['c1', 'c2']),
        lastActiveConversationPerSession: { s1: 'c2' },
      });

      useAppStore.getState().selectSession('s1');
      expect(useAppStore.getState().selectedConversationId).toBe('c2');
    });

    it('falls back to first conversation when last-active id no longer exists', () => {
      const c1 = createMockConversation({ id: 'c1', sessionId: 's1' });
      useAppStore.setState({
        sessions: [s1],
        conversations: [c1 as never],
        conversationIds: new Set(['c1']),
        lastActiveConversationPerSession: { s1: 'c-missing' },
      });

      useAppStore.getState().selectSession('s1');
      expect(useAppStore.getState().selectedConversationId).toBe('c1');
    });

    it("scopes file tabs to the selected session", () => {
      const tabA = { id: 'ta', sessionId: 's1' } as never;
      const tabB = { id: 'tb', sessionId: 's2' } as never;
      useAppStore.setState({
        sessions: [s1, s2],
        fileTabs: [tabA, tabB],
        selectedFileTabId: 'tb', // currently selected tab belongs to s2
      });

      useAppStore.getState().selectSession('s1');
      expect(useAppStore.getState().selectedFileTabId).toBe('ta');
    });

    it('clears selectedFileTabId when no tabs match the session', () => {
      useAppStore.setState({
        sessions: [s1],
        fileTabs: [],
        selectedFileTabId: 'tab-x',
      });

      useAppStore.getState().selectSession('s1');
      expect(useAppStore.getState().selectedFileTabId).toBeNull();
    });

    it('marks session as read in settings store', () => {
      const markSessionRead = vi.fn();
      useSettingsStore.setState({
        markSessionRead,
        markSessionUnread: vi.fn(),
      } as never);

      useAppStore.setState({ sessions: [s1] });
      useAppStore.getState().selectSession('s1');

      expect(markSessionRead).toHaveBeenCalledWith('s1');
    });

    it('does not call markSessionRead when id is null', () => {
      const markSessionRead = vi.fn();
      useSettingsStore.setState({
        markSessionRead,
        markSessionUnread: vi.fn(),
      } as never);

      useAppStore.getState().selectSession(null);
      expect(markSessionRead).not.toHaveBeenCalled();
    });
  });

  // ---- setSessionToggleState --------------------------------------------------

  describe('setSessionToggleState', () => {
    it('sets toggle state for a session', () => {
      useAppStore.getState().setSessionToggleState('s1', { expanded: true } as never);
      expect((useAppStore.getState().sessionToggleState as Record<string, unknown>)['s1']).toEqual({ expanded: true });
    });

    it('does not affect other sessions', () => {
      useAppStore.getState().setSessionToggleState('s1', { expanded: true } as never);
      useAppStore.getState().setSessionToggleState('s2', { expanded: false } as never);
      const state = useAppStore.getState().sessionToggleState as Record<string, { expanded: boolean }>;
      expect(state.s1.expanded).toBe(true);
      expect(state.s2.expanded).toBe(false);
    });
  });

  // ---- archiveSession --------------------------------------------------------

  describe('archiveSession', () => {
    it('marks session as archived', () => {
      useAppStore.setState({ sessions: [s1, s2] });
      useAppStore.getState().archiveSession('s1');
      const archived = useAppStore.getState().sessions.find((s) => s.id === 's1');
      expect(archived?.archived).toBe(true);
    });

    it('is a no-op when session does not exist', () => {
      useAppStore.setState({ sessions: [s1] });
      useAppStore.getState().archiveSession('missing');
      expect(useAppStore.getState().sessions[0].archived).toBeFalsy();
    });

    it('selects another non-archived session in the same workspace when archiving the selected one', () => {
      useAppStore.setState({
        sessions: [s1, s2],
        selectedSessionId: 's1',
      });
      useAppStore.getState().archiveSession('s1');
      expect(useAppStore.getState().selectedSessionId).toBe('s2');
    });

    it('clears selection when no other sessions remain in the workspace', () => {
      useAppStore.setState({
        sessions: [s1, s3], // s3 is in different workspace
        selectedSessionId: 's1',
      });
      useAppStore.getState().archiveSession('s1');
      expect(useAppStore.getState().selectedSessionId).toBeNull();
      expect(useAppStore.getState().selectedConversationId).toBeNull();
    });

    it('skips already-archived sessions when picking next selection', () => {
      const s2archived = { ...s2, archived: true };
      useAppStore.setState({
        sessions: [s1, s2archived],
        selectedSessionId: 's1',
      });
      useAppStore.getState().archiveSession('s1');
      expect(useAppStore.getState().selectedSessionId).toBeNull();
    });

    it('cleans up terminal slices for the archived session', () => {
      useAppStore.setState({
        sessions: [s1, s2],
        terminalInstances: { s1: {} as never, s2: {} as never },
        activeTerminalId: { s1: 't1', s2: 't2' },
        terminalPanelVisible: { s1: true, s2: false },
        claudeTerminals: { s1: {} as never, s2: {} as never },
        activeClaudeTerminalId: { s1: 'c1', s2: 'c2' },
      });

      useAppStore.getState().archiveSession('s1');

      const state = useAppStore.getState();
      expect(state.terminalInstances['s1']).toBeUndefined();
      expect(state.terminalInstances['s2']).toBeDefined();
      expect(state.activeTerminalId['s1']).toBeUndefined();
      expect(state.terminalPanelVisible['s1']).toBeUndefined();
      expect(state.claudeTerminals['s1']).toBeUndefined();
      expect(state.activeClaudeTerminalId['s1']).toBeUndefined();
    });
  });

  describe('unarchiveSession', () => {
    it('clears the archived flag', () => {
      useAppStore.setState({ sessions: [{ ...s1, archived: true }] });
      useAppStore.getState().unarchiveSession('s1');
      expect(useAppStore.getState().sessions[0].archived).toBe(false);
    });

    it('is a no-op when session does not exist', () => {
      useAppStore.setState({ sessions: [s1] });
      useAppStore.getState().unarchiveSession('missing');
      expect(useAppStore.getState().sessions).toEqual([s1]);
    });
  });

  // ---- Drafts -----------------------------------------------------------------

  describe('setDraftInput / clearDraftInput', () => {
    it('stores a draft for a session', () => {
      useAppStore.getState().setDraftInput('s1', { text: 'hello', attachments: [] });
      expect(useAppStore.getState().draftInputs['s1']).toEqual({ text: 'hello', attachments: [] });
    });

    it('replaces an existing draft', () => {
      useAppStore.getState().setDraftInput('s1', { text: 'first', attachments: [] });
      useAppStore.getState().setDraftInput('s1', { text: 'second', attachments: [] });
      expect(useAppStore.getState().draftInputs['s1']?.text).toBe('second');
    });

    it('clearDraftInput removes the entry', () => {
      useAppStore.getState().setDraftInput('s1', { text: 'hi', attachments: [] });
      useAppStore.getState().clearDraftInput('s1');
      expect(useAppStore.getState().draftInputs['s1']).toBeUndefined();
    });

    it('clearDraftInput is safe when no draft exists', () => {
      expect(() => useAppStore.getState().clearDraftInput('s1')).not.toThrow();
    });

    it('isolates drafts across sessions', () => {
      useAppStore.getState().setDraftInput('s1', { text: 'a', attachments: [] });
      useAppStore.getState().setDraftInput('s2', { text: 'b', attachments: [] });

      useAppStore.getState().clearDraftInput('s1');
      expect(useAppStore.getState().draftInputs['s1']).toBeUndefined();
      expect(useAppStore.getState().draftInputs['s2']?.text).toBe('b');
    });
  });
});
