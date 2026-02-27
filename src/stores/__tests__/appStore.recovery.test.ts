import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore - agent recovery', () => {
  const convId = 'conv-1';
  const otherConvId = 'conv-2';

  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      messagesByConversation: {},
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

});
