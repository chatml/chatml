import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore - thinking content preservation', () => {
  const conversationId = 'conv-test';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));

    // Reset store state
    useAppStore.setState({
      messages: [],
      streamingState: {},
      activeTools: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves thinking content when finalizing a streaming message', () => {
    // Set up streaming state with thinking content
    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: 'The answer is 42.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: 'Let me reason through this step by step...',
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
    });

    // Finalize the message
    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 1000,
    });

    // Check the finalized message has thinking content
    const messages = useAppStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('The answer is 42.');
    expect(messages[0].thinkingContent).toBe('Let me reason through this step by step...');
  });

  it('does not set thinkingContent when there is no thinking', () => {
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
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 500,
    });

    const messages = useAppStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Simple response.');
    expect(messages[0].thinkingContent).toBeUndefined();
  });

  it('does not set thinkingContent when thinking is empty string', () => {
    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: 'Response.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: '',
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 500,
    });

    const messages = useAppStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].thinkingContent).toBeUndefined();
  });

  it('clears streaming thinking state after finalization', () => {
    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: 'Done.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: 'Some deep thoughts here...',
          isThinking: true,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 2000,
    });

    // Streaming state should be cleared
    const streaming = useAppStore.getState().streamingState[conversationId];
    expect(streaming?.thinking).toBeNull();
    expect(streaming?.isThinking).toBe(false);
  });

  it('preserves long thinking content', () => {
    const longThinking = 'Step 1: '.padEnd(500, 'analyze ') +
      'Step 2: '.padEnd(500, 'synthesize ') +
      'Step 3: conclusion.';

    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: 'Final answer.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: longThinking,
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 3000,
    });

    const messages = useAppStore.getState().messages;
    expect(messages[0].thinkingContent).toBe(longThinking);
  });

  it('does not create a message when there is no streaming text', () => {
    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: '',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: 'Thinking without output',
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 500,
    });

    // No message should be created since there's no text
    const messages = useAppStore.getState().messages;
    expect(messages).toHaveLength(0);
  });

  it('preserves thinking content alongside other metadata', () => {
    useAppStore.setState({
      streamingState: {
        [conversationId]: {
          text: 'Analysis complete.',
          segments: [],
          currentSegmentId: null,
          isStreaming: true,
          error: null,
          thinking: 'Reasoning about the problem...',
          isThinking: false,
          planModeActive: false,
          pendingPlanApproval: null,
        },
      },
    });

    useAppStore.getState().finalizeStreamingMessage(conversationId, {
      durationMs: 5000,
      toolUsage: [
        { id: 't1', tool: 'Read', success: true, durationMs: 100 },
      ],
      runSummary: { success: true, durationMs: 5000, turns: 2 },
    });

    const msg = useAppStore.getState().messages[0];
    expect(msg.thinkingContent).toBe('Reasoning about the problem...');
    expect(msg.durationMs).toBe(5000);
    expect(msg.toolUsage).toHaveLength(1);
    expect(msg.runSummary?.success).toBe(true);
  });
});

describe('appStore - appendThinkingText', () => {
  const conversationId = 'conv-test';

  beforeEach(() => {
    useAppStore.setState({
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
    });
  });

  it('appends thinking text to empty thinking state', () => {
    useAppStore.getState().appendThinkingText(conversationId, 'First thought.');

    const streaming = useAppStore.getState().streamingState[conversationId];
    expect(streaming?.thinking).toBe('First thought.');
    expect(streaming?.isThinking).toBe(true);
  });

  it('appends thinking text incrementally', () => {
    useAppStore.getState().appendThinkingText(conversationId, 'First. ');
    useAppStore.getState().appendThinkingText(conversationId, 'Second.');

    const streaming = useAppStore.getState().streamingState[conversationId];
    expect(streaming?.thinking).toBe('First. Second.');
  });
});
