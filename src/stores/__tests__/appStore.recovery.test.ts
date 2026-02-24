import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore - agent recovery & message truncation', () => {
  const convId = 'conv-1';
  const otherConvId = 'conv-2';

  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      messages: [],
    });
  });

  // ---------------------------------------------------------------------------
  // setAgentRecovering
  // ---------------------------------------------------------------------------
  describe('setAgentRecovering', () => {
    it('sets recovery state on the streaming state for a conversation', () => {
      useAppStore.getState().setAgentRecovering(convId, 1, 3);

      const streaming = useAppStore.getState().streamingState[convId];
      expect(streaming.recovery).toEqual({ attempt: 1, maxAttempts: 3 });
    });

    it('updates recovery state on subsequent calls', () => {
      useAppStore.getState().setAgentRecovering(convId, 1, 3);
      useAppStore.getState().setAgentRecovering(convId, 2, 3);

      const streaming = useAppStore.getState().streamingState[convId];
      expect(streaming.recovery).toEqual({ attempt: 2, maxAttempts: 3 });
    });

    it('does not affect other conversations', () => {
      useAppStore.getState().setAgentRecovering(convId, 1, 3);

      expect(useAppStore.getState().streamingState[otherConvId]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // clearAgentRecovery
  // ---------------------------------------------------------------------------
  describe('clearAgentRecovery', () => {
    it('clears recovery state for a conversation', () => {
      useAppStore.getState().setAgentRecovering(convId, 2, 5);
      useAppStore.getState().clearAgentRecovery(convId);

      const streaming = useAppStore.getState().streamingState[convId];
      expect(streaming.recovery).toBeUndefined();
    });

    it('does not affect other conversations that have recovery set', () => {
      useAppStore.getState().setAgentRecovering(convId, 1, 3);
      useAppStore.getState().setAgentRecovering(otherConvId, 2, 5);

      useAppStore.getState().clearAgentRecovery(convId);

      expect(useAppStore.getState().streamingState[convId].recovery).toBeUndefined();
      expect(useAppStore.getState().streamingState[otherConvId].recovery).toEqual({
        attempt: 2,
        maxAttempts: 5,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // setStreamingError clears recovery
  // ---------------------------------------------------------------------------
  describe('setStreamingError clears recovery', () => {
    it('sets recovery to undefined when an error is set', () => {
      useAppStore.getState().setAgentRecovering(convId, 3, 3);
      useAppStore.getState().setStreamingError(convId, 'agent crashed');

      const streaming = useAppStore.getState().streamingState[convId];
      expect(streaming.error).toBe('agent crashed');
      expect(streaming.recovery).toBeUndefined();
    });

    it('sets recovery to undefined even when error is null', () => {
      useAppStore.getState().setAgentRecovering(convId, 1, 3);
      useAppStore.getState().setStreamingError(convId, null);

      const streaming = useAppStore.getState().streamingState[convId];
      expect(streaming.error).toBeNull();
      expect(streaming.recovery).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // truncateMessagesFrom
  // ---------------------------------------------------------------------------
  describe('truncateMessagesFrom', () => {
    const makeMessage = (id: string, conversationId: string) => ({
      id,
      conversationId,
      role: 'user' as const,
      content: `content-${id}`,
      timestamp: new Date().toISOString(),
    });

    it('removes messages from a given position onward', () => {
      const messages = [
        makeMessage('m0', convId),
        makeMessage('m1', convId),
        makeMessage('m2', convId),
        makeMessage('m3', convId),
      ];
      useAppStore.setState({ messages });

      useAppStore.getState().truncateMessagesFrom(convId, 2);

      const remaining = useAppStore.getState().messages;
      expect(remaining).toHaveLength(2);
      expect(remaining.map((m) => m.id)).toEqual(['m0', 'm1']);
    });

    it('does not affect messages from other conversations', () => {
      const messages = [
        makeMessage('m0', convId),
        makeMessage('m1', convId),
        makeMessage('m2', convId),
        makeMessage('other-0', otherConvId),
        makeMessage('other-1', otherConvId),
      ];
      useAppStore.setState({ messages });

      useAppStore.getState().truncateMessagesFrom(convId, 1);

      const remaining = useAppStore.getState().messages;
      const convMessages = remaining.filter((m) => m.conversationId === convId);
      const otherMessages = remaining.filter((m) => m.conversationId === otherConvId);

      expect(convMessages).toHaveLength(1);
      expect(convMessages[0].id).toBe('m0');
      expect(otherMessages).toHaveLength(2);
      expect(otherMessages.map((m) => m.id)).toEqual(['other-0', 'other-1']);
    });

    it('with position 0 removes all messages for that conversation', () => {
      const messages = [
        makeMessage('m0', convId),
        makeMessage('m1', convId),
        makeMessage('m2', convId),
        makeMessage('other-0', otherConvId),
      ];
      useAppStore.setState({ messages });

      useAppStore.getState().truncateMessagesFrom(convId, 0);

      const remaining = useAppStore.getState().messages;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('other-0');
    });

    it('is a no-op when position is beyond the message count', () => {
      const messages = [
        makeMessage('m0', convId),
        makeMessage('m1', convId),
      ];
      useAppStore.setState({ messages });

      useAppStore.getState().truncateMessagesFrom(convId, 10);

      const remaining = useAppStore.getState().messages;
      expect(remaining).toHaveLength(2);
      expect(remaining.map((m) => m.id)).toEqual(['m0', 'm1']);
    });
  });
});
