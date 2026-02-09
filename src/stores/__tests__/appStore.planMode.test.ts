import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

// Helper to initialize streaming state for a conversation by setting isStreaming
function initStreamingState(conversationId: string) {
  useAppStore.getState().setStreaming(conversationId, false);
}

describe('appStore - Plan Mode State', () => {
  const convId = 'test-conv-1';

  beforeEach(() => {
    // Reset store state
    useAppStore.setState({ streamingState: {} });
  });

  describe('setPlanModeActive', () => {
    it('sets planModeActive to true for a conversation', () => {
      initStreamingState(convId);

      useAppStore.getState().setPlanModeActive(convId, true);

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(true);
    });

    it('sets planModeActive to false for a conversation', () => {
      initStreamingState(convId);

      useAppStore.getState().setPlanModeActive(convId, true);
      useAppStore.getState().setPlanModeActive(convId, false);

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(false);
    });

    it('does not affect other conversations', () => {
      const otherId = 'other-conv';
      initStreamingState(convId);
      initStreamingState(otherId);

      useAppStore.getState().setPlanModeActive(convId, true);

      expect(useAppStore.getState().streamingState[convId]?.planModeActive).toBe(true);
      expect(useAppStore.getState().streamingState[otherId]?.planModeActive).toBe(false);
    });

    it('initializes streaming state if not present', () => {
      // No initStreamingState call - setPlanModeActive should still work
      useAppStore.getState().setPlanModeActive(convId, true);

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(true);
    });
  });

  describe('setPendingPlanApproval / clearPendingPlanApproval', () => {
    it('sets pendingPlanApproval with requestId', () => {
      initStreamingState(convId);

      useAppStore.getState().setPendingPlanApproval(convId, 'req-123');

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.pendingPlanApproval).toEqual({ requestId: 'req-123' });
    });

    it('clears pendingPlanApproval', () => {
      initStreamingState(convId);

      useAppStore.getState().setPendingPlanApproval(convId, 'req-123');
      useAppStore.getState().clearPendingPlanApproval(convId);

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.pendingPlanApproval).toBeNull();
    });

    it('does not affect planModeActive', () => {
      initStreamingState(convId);

      useAppStore.getState().setPlanModeActive(convId, true);
      useAppStore.getState().setPendingPlanApproval(convId, 'req-456');

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(true);
      expect(state?.pendingPlanApproval).toEqual({ requestId: 'req-456' });
    });

    it('does not affect other conversations', () => {
      const otherId = 'other-conv';
      initStreamingState(convId);
      initStreamingState(otherId);

      useAppStore.getState().setPendingPlanApproval(convId, 'req-789');

      expect(useAppStore.getState().streamingState[convId]?.pendingPlanApproval).toEqual({ requestId: 'req-789' });
      expect(useAppStore.getState().streamingState[otherId]?.pendingPlanApproval).toBeNull();
    });
  });

  describe('plan mode state defaults', () => {
    it('defaults planModeActive to false when streaming state initialized', () => {
      initStreamingState(convId);

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(false);
    });

    it('defaults pendingPlanApproval to null when streaming state initialized', () => {
      initStreamingState(convId);

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.pendingPlanApproval).toBeNull();
    });
  });

  describe('plan mode state isolation between conversations', () => {
    it('maintains independent plan mode state per conversation', () => {
      const conv1 = 'conv-1';
      const conv2 = 'conv-2';
      const conv3 = 'conv-3';

      initStreamingState(conv1);
      initStreamingState(conv2);
      initStreamingState(conv3);

      useAppStore.getState().setPlanModeActive(conv1, true);
      useAppStore.getState().setPendingPlanApproval(conv2, 'req-abc');

      expect(useAppStore.getState().streamingState[conv1]?.planModeActive).toBe(true);
      expect(useAppStore.getState().streamingState[conv1]?.pendingPlanApproval).toBeNull();

      expect(useAppStore.getState().streamingState[conv2]?.planModeActive).toBe(false);
      expect(useAppStore.getState().streamingState[conv2]?.pendingPlanApproval).toEqual({ requestId: 'req-abc' });

      expect(useAppStore.getState().streamingState[conv3]?.planModeActive).toBe(false);
      expect(useAppStore.getState().streamingState[conv3]?.pendingPlanApproval).toBeNull();
    });
  });

  describe('finalizeStreamingMessage preserves planModeActive', () => {
    it('preserves planModeActive after message finalization', () => {
      initStreamingState(convId);
      useAppStore.getState().setPlanModeActive(convId, true);
      useAppStore.getState().appendStreamingText(convId, 'Some response text');

      useAppStore.getState().finalizeStreamingMessage(convId, {});

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(true);
    });

    it('clears pendingPlanApproval after message finalization', () => {
      initStreamingState(convId);
      useAppStore.getState().setPendingPlanApproval(convId, 'req-fin');
      useAppStore.getState().appendStreamingText(convId, 'Some response text');

      useAppStore.getState().finalizeStreamingMessage(convId, {});

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.pendingPlanApproval).toBeNull();
    });

    it('preserves planModeActive=false after finalization', () => {
      initStreamingState(convId);
      useAppStore.getState().setPlanModeActive(convId, false);
      useAppStore.getState().appendStreamingText(convId, 'Text');

      useAppStore.getState().finalizeStreamingMessage(convId, {});

      const state = useAppStore.getState().streamingState[convId];
      expect(state?.planModeActive).toBe(false);
    });
  });
});
