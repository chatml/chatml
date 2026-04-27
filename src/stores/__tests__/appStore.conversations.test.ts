import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import {
  createMockConversation,
  createMockMessage,
} from '@/test-utils/store-utils';
import type { Conversation, Message } from '@/lib/types';

const c1 = createMockConversation({ id: 'c1', sessionId: 's1' }) as Conversation;
const c2 = createMockConversation({ id: 'c2', sessionId: 's1' }) as Conversation;
const c3 = createMockConversation({ id: 'c3', sessionId: 's2' }) as Conversation;

const m1 = createMockMessage({ id: 'm1', conversationId: 'c1' }) as Message;
const m2 = createMockMessage({ id: 'm2', conversationId: 'c1' }) as Message;

describe('appStore — conversation actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      conversations: [],
      conversationIds: new Set(),
      conversationsBySession: {},
      messagesByConversation: {},
      messagePagination: {},
      messagesLoading: {},
      streamingState: {},
      activeTools: {},
      agentTodos: {},
      pendingUserQuestion: {},
      pendingQAHandoff: {},
      interruptedState: {},
      contextUsage: {},
      queuedMessages: {},
      lastActiveConversationPerSession: {},
      summaries: {},
      inputSuggestions: {},
      promptSuggestions: {},
      toolUseSummaries: {},
      checkpoints: [],
      conversationsVersion: 0,
      selectedConversationId: null,
      selectedSessionId: null,
    });
  });

  // ---- setConversations -------------------------------------------------------

  describe('setConversations', () => {
    it('replaces the array and rebuilds the conversationIds set', () => {
      useAppStore.getState().setConversations([c1, c2]);
      const state = useAppStore.getState();
      expect(state.conversations).toHaveLength(2);
      expect(state.conversationIds.has('c1')).toBe(true);
      expect(state.conversationIds.has('c2')).toBe(true);
    });

    it('rebuilds conversationsBySession index', () => {
      useAppStore.getState().setConversations([c1, c2, c3]);
      const idx = useAppStore.getState().conversationsBySession;
      expect(idx['s1']?.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
      expect(idx['s2']?.map((c) => c.id)).toEqual(['c3']);
    });

    it('bumps conversationsVersion', () => {
      const before = useAppStore.getState().conversationsVersion;
      useAppStore.getState().setConversations([c1]);
      expect(useAppStore.getState().conversationsVersion).toBe(before + 1);
    });
  });

  // ---- addConversation --------------------------------------------------------

  describe('addConversation', () => {
    it('appends and updates the index', () => {
      useAppStore.getState().setConversations([c1]);
      useAppStore.getState().addConversation(c2);
      expect(useAppStore.getState().conversations.map((c) => c.id)).toEqual(['c1', 'c2']);
      expect(useAppStore.getState().conversationsBySession['s1']?.map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('is a no-op when the id already exists (deduplication)', () => {
      useAppStore.getState().setConversations([c1]);
      useAppStore.getState().addConversation(c1);
      expect(useAppStore.getState().conversations).toHaveLength(1);
    });

    it('seeds messagesByConversation when the new conversation has initial messages', () => {
      const conv = { ...c1, messages: [m1, m2] };
      useAppStore.getState().addConversation(conv);
      expect(useAppStore.getState().messagesByConversation['c1']).toHaveLength(2);
    });

    it('does not touch messagesByConversation when no initial messages', () => {
      useAppStore.getState().addConversation({ ...c1, messages: [] });
      expect(useAppStore.getState().messagesByConversation['c1']).toBeUndefined();
    });

    it('appends to existing messagesByConversation entries', () => {
      useAppStore.setState({ messagesByConversation: { c1: [m1] } });
      useAppStore.getState().addConversation({ ...c1, messages: [m2] });
      expect(useAppStore.getState().messagesByConversation['c1']?.map((m) => m.id)).toEqual([
        'm1', 'm2',
      ]);
    });
  });

  // ---- updateConversation -----------------------------------------------------

  describe('updateConversation', () => {
    it('merges partial updates onto matching conversation', () => {
      useAppStore.getState().setConversations([c1, c2]);
      useAppStore.getState().updateConversation('c1', { name: 'Renamed' });
      expect(useAppStore.getState().conversations.find((c) => c.id === 'c1')?.name).toBe('Renamed');
    });

    it('keeps the conversationsBySession index in sync', () => {
      useAppStore.getState().setConversations([c1]);
      useAppStore.getState().updateConversation('c1', { name: 'Renamed' });
      expect(useAppStore.getState().conversationsBySession['s1']?.[0].name).toBe('Renamed');
    });

    it('rebuilds the index when sessionId changes', () => {
      useAppStore.getState().setConversations([c1]);
      useAppStore.getState().updateConversation('c1', { sessionId: 's2' });
      // After moving c1 from s1 to s2, s1 has no conversations so its key is gone.
      expect(useAppStore.getState().conversationsBySession['s1']).toBeUndefined();
      expect(useAppStore.getState().conversationsBySession['s2']?.[0].id).toBe('c1');
    });
  });

  // ---- removeConversation -----------------------------------------------------

  describe('removeConversation', () => {
    it('removes the conversation and its messages', () => {
      useAppStore.setState({
        conversations: [c1, c2],
        conversationIds: new Set(['c1', 'c2']),
        conversationsBySession: { s1: [c1, c2] },
        messagesByConversation: { c1: [m1], c2: [] },
      });
      useAppStore.getState().removeConversation('c1');
      const state = useAppStore.getState();
      expect(state.conversations.map((c) => c.id)).toEqual(['c2']);
      expect(state.conversationIds.has('c1')).toBe(false);
      expect(state.messagesByConversation['c1']).toBeUndefined();
    });

    it('cleans up per-conversation slices', () => {
      useAppStore.setState({
        conversations: [c1],
        conversationIds: new Set(['c1']),
        conversationsBySession: { s1: [c1] },
        streamingState: { c1: {} as never, other: {} as never },
        activeTools: { c1: [] as never },
        agentTodos: { c1: [] as never },
        pendingUserQuestion: { c1: {} as never },
        pendingQAHandoff: { c1: {} as never },
        interruptedState: { c1: {} as never },
        contextUsage: { c1: {} as never },
        queuedMessages: { c1: [] as never },
        messagePagination: { c1: {} as never },
        messagesLoading: { c1: true },
      });
      useAppStore.getState().removeConversation('c1');
      const state = useAppStore.getState();
      expect(state.streamingState['c1']).toBeUndefined();
      expect(state.streamingState['other']).toBeDefined();
      expect(state.activeTools['c1']).toBeUndefined();
      expect(state.agentTodos['c1']).toBeUndefined();
      expect(state.pendingUserQuestion['c1']).toBeUndefined();
      expect(state.pendingQAHandoff['c1']).toBeUndefined();
      expect(state.interruptedState['c1']).toBeUndefined();
      expect(state.contextUsage['c1']).toBeUndefined();
      expect(state.queuedMessages['c1']).toBeUndefined();
      expect(state.messagePagination['c1']).toBeUndefined();
      expect(state.messagesLoading['c1']).toBeUndefined();
    });

    it('selects an adjacent conversation when removing the selected one', () => {
      // c1, c2, c3 — but c3 is in s2. Remove c1, expect c2 selected.
      const c1a = createMockConversation({ id: 'c1', sessionId: 's1' }) as Conversation;
      const c2a = createMockConversation({ id: 'c2', sessionId: 's1' }) as Conversation;
      useAppStore.setState({
        conversations: [c1a, c2a],
        conversationIds: new Set(['c1', 'c2']),
        conversationsBySession: { s1: [c1a, c2a] },
        selectedConversationId: 'c1',
      });
      useAppStore.getState().removeConversation('c1');
      expect(useAppStore.getState().selectedConversationId).toBe('c2');
    });

    it('selects the previous conversation when removing the last one', () => {
      const c1a = createMockConversation({ id: 'c1', sessionId: 's1' }) as Conversation;
      const c2a = createMockConversation({ id: 'c2', sessionId: 's1' }) as Conversation;
      useAppStore.setState({
        conversations: [c1a, c2a],
        conversationIds: new Set(['c1', 'c2']),
        conversationsBySession: { s1: [c1a, c2a] },
        selectedConversationId: 'c2',
      });
      useAppStore.getState().removeConversation('c2');
      expect(useAppStore.getState().selectedConversationId).toBe('c1');
    });

    it('clears selection when removing the only conversation in the session', () => {
      useAppStore.setState({
        conversations: [c1],
        conversationIds: new Set(['c1']),
        conversationsBySession: { s1: [c1] },
        selectedConversationId: 'c1',
      });
      useAppStore.getState().removeConversation('c1');
      expect(useAppStore.getState().selectedConversationId).toBeNull();
    });

    it('clears lastActiveConversationPerSession when the removed conv was the remembered one', () => {
      useAppStore.setState({
        conversations: [c1, c2],
        conversationIds: new Set(['c1', 'c2']),
        conversationsBySession: { s1: [c1, c2] },
        lastActiveConversationPerSession: { s1: 'c1' },
      });
      useAppStore.getState().removeConversation('c1');
      expect(useAppStore.getState().lastActiveConversationPerSession['s1']).toBeUndefined();
    });

    it('preserves lastActiveConversationPerSession when removing a non-remembered conv', () => {
      useAppStore.setState({
        conversations: [c1, c2],
        conversationIds: new Set(['c1', 'c2']),
        conversationsBySession: { s1: [c1, c2] },
        lastActiveConversationPerSession: { s1: 'c2' },
      });
      useAppStore.getState().removeConversation('c1');
      expect(useAppStore.getState().lastActiveConversationPerSession['s1']).toBe('c2');
    });
  });

  // ---- selectConversation -----------------------------------------------------

  describe('selectConversation', () => {
    it('updates selectedConversationId', () => {
      useAppStore.setState({ conversations: [c1] });
      useAppStore.getState().selectConversation('c1');
      expect(useAppStore.getState().selectedConversationId).toBe('c1');
    });

    it('persists last active conversation per session', () => {
      useAppStore.setState({ conversations: [c1, c2] });
      useAppStore.getState().selectConversation('c1');
      expect(useAppStore.getState().lastActiveConversationPerSession['s1']).toBe('c1');

      useAppStore.getState().selectConversation('c2');
      expect(useAppStore.getState().lastActiveConversationPerSession['s1']).toBe('c2');
    });

    it('clears checkpoints when changing conversation', () => {
      useAppStore.setState({
        conversations: [c1],
        checkpoints: [{ uuid: 'cp-1' } as never, { uuid: 'cp-2' } as never],
      });
      useAppStore.getState().selectConversation('c1');
      expect(useAppStore.getState().checkpoints).toEqual([]);
    });

    it('handles null id (deselect)', () => {
      useAppStore.setState({
        conversations: [c1],
        selectedConversationId: 'c1',
      });
      useAppStore.getState().selectConversation(null);
      expect(useAppStore.getState().selectedConversationId).toBeNull();
    });
  });

  // ---- Summary actions --------------------------------------------------------

  describe('setSummary / updateSummary', () => {
    it('setSummary stores summary by conversationId', () => {
      const summary = { id: 'sum-1', content: 'Hello', status: 'completed' } as never;
      useAppStore.getState().setSummary('c1', summary);
      expect(useAppStore.getState().summaries['c1']).toEqual(summary);
    });

    it('setSummary overwrites existing summary', () => {
      useAppStore.getState().setSummary('c1', { content: 'first' } as never);
      useAppStore.getState().setSummary('c1', { content: 'second' } as never);
      expect((useAppStore.getState().summaries['c1'] as { content: string }).content).toBe('second');
    });

    it('updateSummary merges into existing summary', () => {
      useAppStore.getState().setSummary('c1', { content: 'a', status: 'generating' } as never);
      useAppStore.getState().updateSummary('c1', { status: 'completed' } as never);
      const result = useAppStore.getState().summaries['c1'] as { content: string; status: string };
      expect(result.content).toBe('a');
      expect(result.status).toBe('completed');
    });

    it('updateSummary is a no-op when no summary exists', () => {
      useAppStore.getState().updateSummary('c1', { status: 'completed' } as never);
      expect(useAppStore.getState().summaries['c1']).toBeUndefined();
    });
  });

  // ---- Input suggestions ------------------------------------------------------

  describe('setInputSuggestion / clearInputSuggestion', () => {
    it('stores suggestion with timestamp', () => {
      useAppStore.getState().setInputSuggestion('c1', { text: 'hint' } as never);
      const result = useAppStore.getState().inputSuggestions['c1'] as { text: string; timestamp: number };
      expect(result.text).toBe('hint');
      expect(typeof result.timestamp).toBe('number');
    });

    it('clearInputSuggestion removes entry', () => {
      useAppStore.getState().setInputSuggestion('c1', { text: 'hint' } as never);
      useAppStore.getState().clearInputSuggestion('c1');
      expect(useAppStore.getState().inputSuggestions['c1']).toBeUndefined();
    });

    it('clearInputSuggestion is a no-op when no suggestion exists', () => {
      const before = useAppStore.getState().inputSuggestions;
      useAppStore.getState().clearInputSuggestion('c1');
      expect(useAppStore.getState().inputSuggestions).toBe(before);
    });
  });

  // ---- Prompt suggestions ----------------------------------------------------

  describe('addPromptSuggestion / clearPromptSuggestions', () => {
    it('appends a new suggestion', () => {
      useAppStore.getState().addPromptSuggestion('c1', 'first');
      expect(useAppStore.getState().promptSuggestions['c1']).toEqual(['first']);
    });

    it('deduplicates within the same conversation', () => {
      useAppStore.getState().addPromptSuggestion('c1', 'first');
      useAppStore.getState().addPromptSuggestion('c1', 'first');
      expect(useAppStore.getState().promptSuggestions['c1']).toEqual(['first']);
    });

    it('caps at 3 entries (keeps the most recent)', () => {
      useAppStore.getState().addPromptSuggestion('c1', 'a');
      useAppStore.getState().addPromptSuggestion('c1', 'b');
      useAppStore.getState().addPromptSuggestion('c1', 'c');
      useAppStore.getState().addPromptSuggestion('c1', 'd');
      expect(useAppStore.getState().promptSuggestions['c1']).toEqual(['b', 'c', 'd']);
    });

    it('clearPromptSuggestions removes the entry', () => {
      useAppStore.getState().addPromptSuggestion('c1', 'a');
      useAppStore.getState().clearPromptSuggestions('c1');
      expect(useAppStore.getState().promptSuggestions['c1']).toBeUndefined();
    });

    it('isolates suggestions across conversations', () => {
      useAppStore.getState().addPromptSuggestion('c1', 'a');
      useAppStore.getState().addPromptSuggestion('c2', 'b');
      useAppStore.getState().clearPromptSuggestions('c1');
      expect(useAppStore.getState().promptSuggestions['c2']).toEqual(['b']);
    });
  });

  // ---- Tool use summaries ----------------------------------------------------

  describe('addToolUseSummary / clearToolUseSummaries', () => {
    it('accumulates tool use summaries', () => {
      useAppStore.getState().addToolUseSummary('c1', { summary: 'a', toolUseIds: ['t1'] });
      useAppStore.getState().addToolUseSummary('c1', { summary: 'b', toolUseIds: ['t2'] });
      const list = useAppStore.getState().toolUseSummaries['c1'];
      expect(list).toHaveLength(2);
    });

    it('clearToolUseSummaries removes the entry', () => {
      useAppStore.getState().addToolUseSummary('c1', { summary: 's', toolUseIds: [] });
      useAppStore.getState().clearToolUseSummaries('c1');
      expect(useAppStore.getState().toolUseSummaries['c1']).toBeUndefined();
    });
  });

  // ---- Messages ---------------------------------------------------------------

  describe('addMessage', () => {
    it('appends message to conversation messagesByConversation', () => {
      useAppStore.getState().addMessage(m1);
      expect(useAppStore.getState().messagesByConversation['c1']).toEqual([m1]);

      useAppStore.getState().addMessage(m2);
      expect(useAppStore.getState().messagesByConversation['c1']).toHaveLength(2);
    });

    it('keeps pagination totalCount in sync', () => {
      useAppStore.setState({
        messagePagination: {
          c1: { hasMore: false, totalCount: 5, oldestPosition: 0, isLoadingMore: false } as never,
        },
      });
      useAppStore.getState().addMessage(m1);
      expect((useAppStore.getState().messagePagination['c1'] as { totalCount: number }).totalCount).toBe(6);
    });

    it('does not create pagination entry when none existed', () => {
      useAppStore.getState().addMessage(m1);
      expect(useAppStore.getState().messagePagination['c1']).toBeUndefined();
    });
  });

  describe('updateMessage', () => {
    it('merges updates onto matching message', () => {
      useAppStore.setState({ messagesByConversation: { c1: [m1, m2] } });
      useAppStore.getState().updateMessage('c1', 'm1', { content: 'updated' });
      expect(useAppStore.getState().messagesByConversation['c1']?.[0].content).toBe('updated');
      expect(useAppStore.getState().messagesByConversation['c1']?.[1].content).toBe('Test message');
    });

    it('is a no-op when conversation has no messages map entry', () => {
      const before = useAppStore.getState().messagesByConversation;
      useAppStore.getState().updateMessage('missing-conv', 'm1', { content: 'x' });
      expect(useAppStore.getState().messagesByConversation).toBe(before);
    });
  });

  describe('setMessagePage', () => {
    it('replaces messages and writes pagination metadata', () => {
      useAppStore.getState().setMessagePage('c1', [m1, m2], true, 0, 50);
      const state = useAppStore.getState();
      expect(state.messagesByConversation['c1']).toHaveLength(2);
      expect(state.messagePagination['c1']).toEqual({
        hasMore: true,
        oldestPosition: 0,
        isLoadingMore: false,
        totalCount: 50,
      });
      expect(state.messagesLoading['c1']).toBe(false);
    });
  });

  describe('prependMessages', () => {
    it('prepends new messages and de-duplicates against existing IDs', () => {
      useAppStore.setState({
        messagesByConversation: { c1: [m2] },
        messagePagination: {
          c1: { hasMore: true, oldestPosition: 5, isLoadingMore: true, totalCount: 10 } as never,
        },
      });
      const m0 = createMockMessage({ id: 'm0', conversationId: 'c1' }) as Message;
      useAppStore.getState().prependMessages('c1', [m0, m2], false, 0);

      const state = useAppStore.getState();
      expect(state.messagesByConversation['c1']?.map((m) => m.id)).toEqual(['m0', 'm2']);
      expect((state.messagePagination['c1'] as { hasMore: boolean; oldestPosition: number; isLoadingMore: boolean }).hasMore).toBe(false);
      expect((state.messagePagination['c1'] as { hasMore: boolean; oldestPosition: number; isLoadingMore: boolean }).oldestPosition).toBe(0);
      expect((state.messagePagination['c1'] as { hasMore: boolean; oldestPosition: number; isLoadingMore: boolean }).isLoadingMore).toBe(false);
    });
  });

  describe('setLoadingMoreMessages', () => {
    it('updates the isLoadingMore flag in pagination', () => {
      useAppStore.setState({
        messagePagination: {
          c1: { hasMore: true, oldestPosition: 0, isLoadingMore: false, totalCount: 0 } as never,
        },
      });
      useAppStore.getState().setLoadingMoreMessages('c1', true);
      expect((useAppStore.getState().messagePagination['c1'] as { isLoadingMore: boolean }).isLoadingMore).toBe(true);
    });
  });

  describe('setMessagesLoading', () => {
    it('toggles initial-load flag for a conversation', () => {
      useAppStore.getState().setMessagesLoading('c1', true);
      expect(useAppStore.getState().messagesLoading['c1']).toBe(true);

      useAppStore.getState().setMessagesLoading('c1', false);
      expect(useAppStore.getState().messagesLoading['c1']).toBe(false);
    });
  });

  describe('hydrateMessage', () => {
    it('replaces a message in place by id', () => {
      useAppStore.setState({ messagesByConversation: { c1: [m1, m2] } });
      const hydrated = { ...m1, content: 'fully-hydrated', toolUsage: [] } as Message;
      useAppStore.getState().hydrateMessage('c1', 'm1', hydrated);

      const messages = useAppStore.getState().messagesByConversation['c1']!;
      expect(messages[0].content).toBe('fully-hydrated');
      expect(messages[1]).toBe(m2);
    });

    it('is a no-op when conversation has no messages', () => {
      useAppStore.getState().hydrateMessage('c-missing', 'm1', m1);
      expect(useAppStore.getState().messagesByConversation['c-missing']).toBeUndefined();
    });

    it('is a no-op when message id is not found in conversation', () => {
      useAppStore.setState({ messagesByConversation: { c1: [m1] } });
      useAppStore.getState().hydrateMessage('c1', 'missing', m1);
      expect(useAppStore.getState().messagesByConversation['c1']).toEqual([m1]);
    });
  });
});
