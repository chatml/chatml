import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../appStore';
import { useSettingsStore } from '../settingsStore';
import {
  createMockWorkspace,
  createMockSession,
  createMockConversation,
} from '@/test-utils/store-utils';
import type { Workspace } from '@/lib/types';

const w1 = createMockWorkspace({ id: 'ws-1', name: 'Alpha' }) as Workspace;
const w2 = createMockWorkspace({ id: 'ws-2', name: 'Beta' }) as Workspace;
const w3 = createMockWorkspace({ id: 'ws-3', name: 'Gamma' }) as Workspace;

describe('appStore — workspace actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [],
      sessions: [],
      conversations: [],
      conversationIds: new Set(),
      conversationsBySession: {},
      messagesByConversation: {},
      streamingState: {},
      activeTools: {},
      agentTodos: {},
      messagePagination: {},
      customTodos: {},
      sessionOutputs: {},
      terminalInstances: {},
      activeTerminalId: {},
      terminalPanelVisible: {},
      terminalSessions: {},
      lastActiveConversationPerSession: {},
      claudeTerminals: {},
      activeClaudeTerminalId: {},
      selectedWorkspaceId: null,
      selectedSessionId: null,
      selectedConversationId: null,
      selectedFileTabId: null,
      fileTabs: [],
    });
    useSettingsStore.setState({ workspaceOrder: [] } as never);
  });

  describe('setWorkspaces', () => {
    it('replaces the workspaces array wholesale', () => {
      useAppStore.getState().setWorkspaces([w1, w2]);
      expect(useAppStore.getState().workspaces).toHaveLength(2);

      useAppStore.getState().setWorkspaces([w3]);
      expect(useAppStore.getState().workspaces).toEqual([w3]);
    });

    it('accepts empty array', () => {
      useAppStore.getState().setWorkspaces([w1]);
      useAppStore.getState().setWorkspaces([]);
      expect(useAppStore.getState().workspaces).toEqual([]);
    });
  });

  describe('addWorkspace', () => {
    it('appends to the end of the list', () => {
      useAppStore.getState().setWorkspaces([w1]);
      useAppStore.getState().addWorkspace(w2);
      expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-1', 'ws-2']);
    });
  });

  describe('updateWorkspace', () => {
    it('merges partial updates onto matching workspace by id', () => {
      useAppStore.getState().setWorkspaces([w1, w2]);
      useAppStore.getState().updateWorkspace('ws-1', { name: 'Renamed' });

      const ws = useAppStore.getState().workspaces;
      expect(ws.find((w) => w.id === 'ws-1')?.name).toBe('Renamed');
      expect(ws.find((w) => w.id === 'ws-2')?.name).toBe('Beta');
    });

    it('is a no-op when id does not match', () => {
      useAppStore.getState().setWorkspaces([w1]);
      useAppStore.getState().updateWorkspace('nonexistent', { name: 'x' } as never);
      expect(useAppStore.getState().workspaces).toEqual([w1]);
    });
  });

  describe('selectWorkspace', () => {
    it('updates selectedWorkspaceId', () => {
      useAppStore.getState().selectWorkspace('ws-1');
      expect(useAppStore.getState().selectedWorkspaceId).toBe('ws-1');

      useAppStore.getState().selectWorkspace(null);
      expect(useAppStore.getState().selectedWorkspaceId).toBeNull();
    });
  });

  describe('reorderWorkspaces', () => {
    it('moves activeId before overId', () => {
      useAppStore.getState().setWorkspaces([w1, w2, w3]);
      useAppStore.getState().reorderWorkspaces('ws-3', 'ws-1');
      expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-3', 'ws-1', 'ws-2']);
    });

    it('persists new order to settingsStore', () => {
      const setWorkspaceOrder = vi.fn();
      useSettingsStore.setState({ setWorkspaceOrder, workspaceOrder: [] } as never);

      useAppStore.getState().setWorkspaces([w1, w2, w3]);
      useAppStore.getState().reorderWorkspaces('ws-2', 'ws-1');

      expect(setWorkspaceOrder).toHaveBeenCalledWith(['ws-2', 'ws-1', 'ws-3']);
    });

    it('returns state unchanged when activeId is missing', () => {
      useAppStore.getState().setWorkspaces([w1, w2]);
      useAppStore.getState().reorderWorkspaces('missing', 'ws-1');
      expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-1', 'ws-2']);
    });

    it('returns state unchanged when overId is missing', () => {
      useAppStore.getState().setWorkspaces([w1, w2]);
      useAppStore.getState().reorderWorkspaces('ws-1', 'missing');
      expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-1', 'ws-2']);
    });
  });

  describe('removeWorkspace cascade', () => {
    it('removes the workspace from the list', () => {
      useAppStore.getState().setWorkspaces([w1, w2]);
      useAppStore.getState().removeWorkspace('ws-1');
      expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-2']);
    });

    it('cascades to sessions, conversations, and messages of the removed workspace', () => {
      const session = createMockSession({ id: 'session-1', workspaceId: 'ws-1' });
      const otherSession = createMockSession({ id: 'session-2', workspaceId: 'ws-2' });
      const conversation = createMockConversation({ id: 'conv-1', sessionId: 'session-1' });
      const otherConv = createMockConversation({ id: 'conv-2', sessionId: 'session-2' });

      useAppStore.setState({
        workspaces: [w1, w2],
        sessions: [session as never, otherSession as never],
        conversations: [conversation as never, otherConv as never],
        conversationIds: new Set(['conv-1', 'conv-2']),
        conversationsBySession: {
          'session-1': [conversation as never],
          'session-2': [otherConv as never],
        },
        messagesByConversation: {
          'conv-1': [{ id: 'm1' }] as never,
          'conv-2': [{ id: 'm2' }] as never,
        },
        streamingState: { 'conv-1': {} as never, 'conv-2': {} as never },
        activeTools: { 'conv-1': [] as never, 'conv-2': [] as never },
        agentTodos: { 'conv-1': [] as never, 'conv-2': [] as never },
      });

      useAppStore.getState().removeWorkspace('ws-1');

      const state = useAppStore.getState();
      expect(state.sessions.map((s) => s.id)).toEqual(['session-2']);
      expect(state.conversations.map((c) => c.id)).toEqual(['conv-2']);
      expect(state.conversationIds.has('conv-1')).toBe(false);
      expect(state.conversationIds.has('conv-2')).toBe(true);
      expect(state.conversationsBySession['session-1']).toBeUndefined();
      expect(state.conversationsBySession['session-2']).toBeDefined();
      expect(state.messagesByConversation['conv-1']).toBeUndefined();
      expect(state.messagesByConversation['conv-2']).toBeDefined();
      expect(state.streamingState['conv-1']).toBeUndefined();
      expect(state.activeTools['conv-1']).toBeUndefined();
      expect(state.agentTodos['conv-1']).toBeUndefined();
    });

    it('clears selectedWorkspaceId when removing the selected workspace', () => {
      useAppStore.setState({
        workspaces: [w1, w2],
        selectedWorkspaceId: 'ws-1',
      });
      useAppStore.getState().removeWorkspace('ws-1');
      expect(useAppStore.getState().selectedWorkspaceId).toBeNull();
    });

    it('preserves selectedWorkspaceId when removing a different workspace', () => {
      useAppStore.setState({
        workspaces: [w1, w2],
        selectedWorkspaceId: 'ws-2',
      });
      useAppStore.getState().removeWorkspace('ws-1');
      expect(useAppStore.getState().selectedWorkspaceId).toBe('ws-2');
    });

    it('clears selectedSessionId/conversationId when they belong to removed workspace', () => {
      const session = createMockSession({ id: 'session-1', workspaceId: 'ws-1' });
      const conversation = createMockConversation({ id: 'conv-1', sessionId: 'session-1' });

      useAppStore.setState({
        workspaces: [w1],
        sessions: [session as never],
        conversations: [conversation as never],
        conversationIds: new Set(['conv-1']),
        selectedSessionId: 'session-1',
        selectedConversationId: 'conv-1',
        selectedFileTabId: 'tab-1',
        fileTabs: [{ id: 'tab-1', sessionId: 'session-1' }] as never,
      });

      useAppStore.getState().removeWorkspace('ws-1');

      const state = useAppStore.getState();
      expect(state.selectedSessionId).toBeNull();
      expect(state.selectedConversationId).toBeNull();
      expect(state.selectedFileTabId).toBeNull();
      expect(state.fileTabs).toEqual([]);
    });

    it('removes the workspace id from settingsStore.workspaceOrder', () => {
      const setWorkspaceOrder = vi.fn();
      useSettingsStore.setState({
        setWorkspaceOrder,
        workspaceOrder: ['ws-1', 'ws-2', 'ws-3'],
      } as never);
      useAppStore.setState({ workspaces: [w1, w2, w3] });

      useAppStore.getState().removeWorkspace('ws-2');

      expect(setWorkspaceOrder).toHaveBeenCalledWith(['ws-1', 'ws-3']);
    });

    it('does not call setWorkspaceOrder when the workspace was not in the order', () => {
      const setWorkspaceOrder = vi.fn();
      useSettingsStore.setState({
        setWorkspaceOrder,
        workspaceOrder: ['ws-2'],
      } as never);
      useAppStore.setState({ workspaces: [w1, w2] });

      useAppStore.getState().removeWorkspace('ws-1');
      expect(setWorkspaceOrder).not.toHaveBeenCalled();
    });
  });
});
