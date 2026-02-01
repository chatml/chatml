import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/appStore';

/**
 * These tests verify that the context usage event handling logic works correctly
 * by simulating what the useWebSocket handler does when it receives events.
 * We test the store mutations directly since the WebSocket handler simply
 * calls store actions based on event type and fields.
 */

const CONV_ID = 'conv-1';

describe('useWebSocket — context usage event handling', () => {
  beforeEach(() => {
    useAppStore.setState({ contextUsage: {} });
  });

  // ==========================================================================
  // context_usage event
  // ==========================================================================

  describe('context_usage event', () => {
    it('updates store with token counts', () => {
      // Simulates: case 'context_usage' in useWebSocket handler
      const event = {
        inputTokens: 15000,
        outputTokens: 3000,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 2000,
      };

      if (event.inputTokens !== undefined) {
        useAppStore.getState().setContextUsage(CONV_ID, {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens || 0,
          cacheReadInputTokens: event.cacheReadInputTokens || 0,
          cacheCreationInputTokens: event.cacheCreationInputTokens || 0,
        });
      }

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(15000);
      expect(usage.outputTokens).toBe(3000);
      expect(usage.cacheReadInputTokens).toBe(5000);
      expect(usage.cacheCreationInputTokens).toBe(2000);
    });

    it('skips update when inputTokens is undefined', () => {
      // Simulates: event with no inputTokens field
      const event: Record<string, unknown> = {
        type: 'context_usage',
      };

      if (event.inputTokens !== undefined) {
        useAppStore.getState().setContextUsage(CONV_ID, {
          inputTokens: event.inputTokens as number,
        });
      }

      expect(useAppStore.getState().contextUsage[CONV_ID]).toBeUndefined();
    });

    it('handles zero values for optional token fields', () => {
      const event = {
        inputTokens: 10000,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      if (event.inputTokens !== undefined) {
        useAppStore.getState().setContextUsage(CONV_ID, {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens || 0,
          cacheReadInputTokens: event.cacheReadInputTokens || 0,
          cacheCreationInputTokens: event.cacheCreationInputTokens || 0,
        });
      }

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(10000);
      expect(usage.outputTokens).toBe(0);
      expect(usage.cacheReadInputTokens).toBe(0);
      expect(usage.cacheCreationInputTokens).toBe(0);
    });

    it('updates existing usage data (simulates successive turns)', () => {
      // First turn
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 5000,
        outputTokens: 1000,
      });

      // Second turn — inputTokens grows as context accumulates
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 12000,
        outputTokens: 2000,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(12000);
      expect(usage.outputTokens).toBe(2000);
    });
  });

  // ==========================================================================
  // context_window_size event
  // ==========================================================================

  describe('context_window_size event', () => {
    it('updates contextWindow in store', () => {
      // Simulates: case 'context_window_size' in useWebSocket handler
      const event = { contextWindow: 1000000 };

      if (event.contextWindow) {
        useAppStore.getState().setContextUsage(CONV_ID, {
          contextWindow: event.contextWindow,
        });
      }

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.contextWindow).toBe(1000000);
    });

    it('skips update when contextWindow is undefined', () => {
      const event: Record<string, unknown> = {
        type: 'context_window_size',
      };

      if (event.contextWindow) {
        useAppStore.getState().setContextUsage(CONV_ID, {
          contextWindow: event.contextWindow as number,
        });
      }

      expect(useAppStore.getState().contextUsage[CONV_ID]).toBeUndefined();
    });

    it('preserves existing token data when updating contextWindow', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 50000,
        outputTokens: 5000,
      });

      useAppStore.getState().setContextUsage(CONV_ID, {
        contextWindow: 1000000,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.contextWindow).toBe(1000000);
      expect(usage.inputTokens).toBe(50000);
      expect(usage.outputTokens).toBe(5000);
    });
  });

  // ==========================================================================
  // compact_boundary event
  // ==========================================================================

  describe('compact_boundary event', () => {
    it('resets all token fields to 0', () => {
      // First, set some usage data
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 180000,
        outputTokens: 5000,
        cacheReadInputTokens: 3000,
        cacheCreationInputTokens: 1000,
        contextWindow: 200000,
      });

      // Simulates: case 'compact_boundary' in useWebSocket handler
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.cacheReadInputTokens).toBe(0);
      expect(usage.cacheCreationInputTokens).toBe(0);
      // contextWindow should be preserved
      expect(usage.contextWindow).toBe(200000);
    });
  });

  // ==========================================================================
  // Full flow simulation
  // ==========================================================================

  describe('full flow', () => {
    it('simulates a complete conversation lifecycle', () => {
      // 1. First assistant message — context_usage
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 5000,
        outputTokens: 1000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });

      // 2. Result message — context_window_size
      useAppStore.getState().setContextUsage(CONV_ID, {
        contextWindow: 200000,
      });

      let usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(5000);
      expect(usage.contextWindow).toBe(200000);

      // 3. Second turn — context grows
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 15000,
        outputTokens: 3000,
        cacheReadInputTokens: 2000,
      });

      usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(15000);
      expect(usage.cacheReadInputTokens).toBe(2000);

      // 4. Compact boundary — all token fields reset
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });

      usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(0);
      expect(usage.contextWindow).toBe(200000); // preserved

      // 5. Post-compact turn — fresh context data
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 8000,
        outputTokens: 2000,
      });

      usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(8000);
    });
  });
});
