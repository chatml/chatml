import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '../appStore';

/** Minimal streaming state stub with just turnStartMeta for context window tests */
function streamingStateWithModel(model: string) {
  return { turnStartMeta: { model } } as unknown as ReturnType<typeof useAppStore.getState>['streamingState'][string];
}

const CONV_ID = 'conv-1';
const CONV_ID_2 = 'conv-2';

describe('appStore — contextUsage', () => {
  beforeEach(() => {
    useAppStore.setState({ contextUsage: {}, streamingState: {}, conversations: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial state is empty object', () => {
    expect(useAppStore.getState().contextUsage).toEqual({});
  });

  describe('setContextUsage', () => {
    it('creates entry with defaults when none exists', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 5000,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage).toBeDefined();
      expect(usage.inputTokens).toBe(5000);
      expect(usage.outputTokens).toBe(0);
      expect(usage.cacheReadInputTokens).toBe(0);
      expect(usage.cacheCreationInputTokens).toBe(0);
      expect(usage.contextWindow).toBe(200000);
    });

    it('merges partial updates into existing entry', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 5000,
        outputTokens: 1000,
      });
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 8000,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(8000);
      expect(usage.outputTokens).toBe(1000);
    });

    it('sets lastUpdated to current timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));

      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 1000,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.lastUpdated).toBe(Date.now());
    });

    it('updates lastUpdated on subsequent calls', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));

      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 1000 });
      const firstUpdate = useAppStore.getState().contextUsage[CONV_ID].lastUpdated;

      vi.setSystemTime(new Date('2025-07-01T12:01:00Z'));
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 2000 });
      const secondUpdate = useAppStore.getState().contextUsage[CONV_ID].lastUpdated;

      expect(secondUpdate).toBeGreaterThan(firstUpdate);
    });

    it('defaults contextWindow to 200000', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 1000,
      });

      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(200000);
    });

    it('updates contextWindow when provided', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 1000,
      });
      useAppStore.getState().setContextUsage(CONV_ID, {
        contextWindow: 1000000,
      });

      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1000000);
      expect(useAppStore.getState().contextUsage[CONV_ID].inputTokens).toBe(1000);
    });

    it('sets all token fields', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 15000,
        outputTokens: 3000,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 2000,
      });

      const usage = useAppStore.getState().contextUsage[CONV_ID];
      expect(usage.inputTokens).toBe(15000);
      expect(usage.outputTokens).toBe(3000);
      expect(usage.cacheReadInputTokens).toBe(5000);
      expect(usage.cacheCreationInputTokens).toBe(2000);
    });

    it('maintains independent state per conversation', () => {
      useAppStore.getState().setContextUsage(CONV_ID, {
        inputTokens: 5000,
        contextWindow: 200000,
      });
      useAppStore.getState().setContextUsage(CONV_ID_2, {
        inputTokens: 80000,
        contextWindow: 1000000,
      });

      const state = useAppStore.getState().contextUsage;
      expect(state[CONV_ID].inputTokens).toBe(5000);
      expect(state[CONV_ID].contextWindow).toBe(200000);
      expect(state[CONV_ID_2].inputTokens).toBe(80000);
      expect(state[CONV_ID_2].contextWindow).toBe(1000000);
    });

    it('clamps SDK contextWindow to 1M for [1m]-suffixed model variants', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-opus-4-6[1m]'),
        },
      });

      // First call creates entry with 1M default
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 1000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);

      // SDK sends contextWindow: 200000 — should be clamped to 1M
      useAppStore.getState().setContextUsage(CONV_ID, { contextWindow: 200000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
      // Token counts should be preserved
      expect(useAppStore.getState().contextUsage[CONV_ID].inputTokens).toBe(1000);
    });

    it('defaults to 1M for suffix-less 1M-capable models (claude-opus-4-7)', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-opus-4-7'),
        },
      });

      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 1000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
    });

    it('clamps SDK 200K contextWindow to 1M for suffix-less 1M-capable models', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-opus-4-7'),
        },
      });

      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 1000 });
      useAppStore.getState().setContextUsage(CONV_ID, { contextWindow: 200000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
    });

    it('treats claude-sonnet-4-6 (with date suffix) as 1M-capable', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-sonnet-4-6-20250514'),
        },
      });

      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 1000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
    });

    it('allows SDK contextWindow for non-1M-capable models (Haiku)', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-haiku-4-5-20251001'),
        },
      });

      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 1000 });
      useAppStore.getState().setContextUsage(CONV_ID, { contextWindow: 200000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(200000);
    });

    it('passes through 1M contextWindow for [1m] models without clamping', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-opus-4-6[1m]'),
        },
      });

      useAppStore.getState().setContextUsage(CONV_ID, { contextWindow: 1_000_000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
    });

    it('falls back to conversation.model for 1M detection when turnStartMeta is cleared', () => {
      // Simulate turn 1: turnStartMeta has model, context_usage sets 1M default
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-opus-4-7'),
        },
      });
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 5000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);

      // After finalization clears turnStartMeta, conversation.model is still available
      useAppStore.setState({
        streamingState: { [CONV_ID]: {} as ReturnType<typeof useAppStore.getState>['streamingState'][string] },
        conversations: [{ id: CONV_ID, model: 'claude-opus-4-7' } as ReturnType<typeof useAppStore.getState>['conversations'][number]],
      });

      // SDK-reported 200K arrives AFTER finalization — still clamped because
      // supportsExtendedContext resolves from the conversation's base model.
      useAppStore.getState().setContextUsage(CONV_ID, { contextWindow: 200000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
    });

    it('clamps correctly when called BEFORE finalization clears turnStartMeta', () => {
      useAppStore.setState({
        streamingState: {
          [CONV_ID]: streamingStateWithModel('claude-opus-4-6[1m]'),
        },
      });
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 5000 });

      useAppStore.getState().setContextUsage(CONV_ID, { contextWindow: 200000 });
      expect(useAppStore.getState().contextUsage[CONV_ID].contextWindow).toBe(1_000_000);
    });

    it('does not affect other conversations when updating one', () => {
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 5000 });
      useAppStore.getState().setContextUsage(CONV_ID_2, { inputTokens: 10000 });
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 7000 });

      expect(useAppStore.getState().contextUsage[CONV_ID_2].inputTokens).toBe(10000);
    });
  });

  describe('clearContextUsage', () => {
    it('removes entry for conversationId', () => {
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 5000 });
      useAppStore.getState().clearContextUsage(CONV_ID);

      expect(useAppStore.getState().contextUsage[CONV_ID]).toBeUndefined();
    });

    it('is a no-op for nonexistent conversationId', () => {
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 5000 });
      useAppStore.getState().clearContextUsage('nonexistent');

      expect(useAppStore.getState().contextUsage[CONV_ID]).toBeDefined();
      expect(useAppStore.getState().contextUsage['nonexistent']).toBeUndefined();
    });

    it('does not affect other conversations', () => {
      useAppStore.getState().setContextUsage(CONV_ID, { inputTokens: 5000 });
      useAppStore.getState().setContextUsage(CONV_ID_2, { inputTokens: 10000 });
      useAppStore.getState().clearContextUsage(CONV_ID);

      expect(useAppStore.getState().contextUsage[CONV_ID]).toBeUndefined();
      expect(useAppStore.getState().contextUsage[CONV_ID_2]).toBeDefined();
      expect(useAppStore.getState().contextUsage[CONV_ID_2].inputTokens).toBe(10000);
    });
  });
});
