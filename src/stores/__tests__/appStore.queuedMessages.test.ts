import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore - queued message ordering', () => {
  const conversationId = 'conv-test';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));

    // Reset store state
    useAppStore.setState({
      messagesByConversation: {},
      streamingState: {},
      activeTools: {},
      queuedMessages: {},
      subAgents: {},
      pendingCheckpointUuid: {},
      messagePagination: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('places queued user message AFTER assistant message on turn_complete', () => {
    // Set up: user1 already in messages, assistant is streaming, user2 is queued
    useAppStore.setState({
      messagesByConversation: {
        [conversationId]: [
          {
            id: 'msg-user1',
            conversationId,
            role: 'user',
            content: 'First user message',
            timestamp: '2025-07-01T12:00:00Z',
          },
        ],
      },
      streamingState: {
        [conversationId]: {
          text: 'Assistant response to first message.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {
        [conversationId]: [
          {
            id: 'msg-user2',
            content: 'Second user message',
            attachments: [],
            timestamp: '2025-07-01T12:00:05Z',
          },
        ],
      },
    });

    // Simulate turn_complete: commitQueued=true, non-terminal
    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 5000,
      commitQueued: true,
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(3);
    // Order: user1, assistant1, user2
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('First user message');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Assistant response to first message.');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second user message');
  });

  it('commits queued user message on result event with runSummary', () => {
    // Simulates the result event handler which now passes commitQueued: true alongside runSummary
    useAppStore.setState({
      messagesByConversation: {
        [conversationId]: [
          {
            id: 'msg-user1',
            conversationId,
            role: 'user',
            content: 'First user message',
            timestamp: '2025-07-01T12:00:00Z',
          },
        ],
      },
      streamingState: {
        [conversationId]: {
          text: 'Assistant response to first message.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {
        [conversationId]: [
          {
            id: 'msg-user2',
            content: 'Second user message',
            attachments: [],
            timestamp: '2025-07-01T12:00:05Z',
          },
        ],
      },
    });

    // Simulate result event: commitQueued=true with runSummary, non-terminal
    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 5000,
      commitQueued: true,
      runSummary: {
        success: true,
        cost: 0.01,
        turns: 1,
        durationMs: 5000,
      },
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(3);
    // Order: user1, assistant1 (with runSummary), user2
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('First user message');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Assistant response to first message.');
    expect(messages[1].runSummary).toBeDefined();
    expect(messages[1].runSummary?.success).toBe(true);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second user message');

    // Queue should be empty (one message committed, none remaining)
    const queued = useAppStore.getState().queuedMessages[conversationId] ?? [];
    expect(queued).toHaveLength(0);

    // keepStreaming is computed before the queue is drained, so isStreaming
    // remains true (queue had 1 message → hasQueuedMessages was true, non-terminal).
    const streaming = useAppStore.getState().streamingState[conversationId];
    expect(streaming?.isStreaming).toBe(true);
  });

  it('places queued user message AFTER assistant message on terminal event', () => {
    useAppStore.setState({
      messagesByConversation: {
        [conversationId]: [
          {
            id: 'msg-user1',
            conversationId,
            role: 'user',
            content: 'First user message',
            timestamp: '2025-07-01T12:00:00Z',
          },
        ],
      },
      streamingState: {
        [conversationId]: {
          text: 'Assistant response.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {
        [conversationId]: [
          {
            id: 'msg-user2',
            content: 'Second user message',
            attachments: [],
            timestamp: '2025-07-01T12:00:05Z',
          },
        ],
      },
    });

    // Simulate complete/error: commitQueued=true, terminal=true
    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      commitQueued: true,
      terminal: true,
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second user message');

    // Terminal should clear the queue
    const queued = useAppStore.getState().queuedMessages[conversationId] ?? [];
    expect(queued).toHaveLength(0);
  });

  it('appends queued message correctly when no streaming text exists', () => {
    // This covers the !streaming?.text branch (e.g. turn_complete after result already finalized)
    useAppStore.setState({
      messagesByConversation: {
        [conversationId]: [
          {
            id: 'msg-user1',
            conversationId,
            role: 'user',
            content: 'First user message',
            timestamp: '2025-07-01T12:00:00Z',
          },
          {
            id: 'msg-assistant1',
            conversationId,
            role: 'assistant',
            content: 'Assistant response.',
            timestamp: '2025-07-01T12:00:03Z',
          },
        ],
      },
      streamingState: {
        [conversationId]: {
          text: '', // No streaming text (already finalized by result event)
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {
        [conversationId]: [
          {
            id: 'msg-user2',
            content: 'Second user message',
            attachments: [],
            timestamp: '2025-07-01T12:00:05Z',
          },
        ],
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      commitQueued: true,
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second user message');
  });

  it('commits queued message on init-triggered finalize (streaming text still present)', () => {
    // Scenario: result/turn_complete was missed, init fires for the new turn
    // while the queued message is still in the queue and streaming text remains.
    useAppStore.setState({
      messagesByConversation: {
        [conversationId]: [
          {
            id: 'msg-user1',
            conversationId,
            role: 'user',
            content: 'First user message',
            timestamp: '2025-07-01T12:00:00Z',
          },
        ],
      },
      streamingState: {
        [conversationId]: {
          text: 'Assistant response to first message.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {
        [conversationId]: [
          {
            id: 'msg-user2',
            content: 'Second user message',
            attachments: [],
            timestamp: '2025-07-01T12:00:05Z',
          },
        ],
      },
    });

    // Simulate what the init handler does when queued messages exist
    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      commitQueued: true,
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('First user message');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Assistant response to first message.');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second user message');

    const queued = useAppStore.getState().queuedMessages[conversationId] ?? [];
    expect(queued).toHaveLength(0);
  });

  it('commits queued message on init-triggered finalize without creating empty assistant message', () => {
    // Scenario: result already finalized the assistant message and cleared streaming text,
    // but did NOT commit the queued message. Init fires with empty streaming text.
    useAppStore.setState({
      messagesByConversation: {
        [conversationId]: [
          {
            id: 'msg-user1',
            conversationId,
            role: 'user',
            content: 'First user message',
            timestamp: '2025-07-01T12:00:00Z',
          },
          {
            id: 'msg-assistant1',
            conversationId,
            role: 'assistant',
            content: 'Already finalized response.',
            timestamp: '2025-07-01T12:00:03Z',
          },
        ],
      },
      streamingState: {
        [conversationId]: {
          text: '',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {
        [conversationId]: [
          {
            id: 'msg-user2',
            content: 'Second user message',
            attachments: [],
            timestamp: '2025-07-01T12:00:05Z',
          },
        ],
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      commitQueued: true,
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Already finalized response.');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second user message');
  });

  it('does not add queued message when none exists', () => {
    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: 'Simple response.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: null,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
      queuedMessages: {},
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 1000,
      commitQueued: true,
    });

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('Simple response.');
  });
});
