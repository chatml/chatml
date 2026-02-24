import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStreamingBatcher, StreamingBatcher } from '../useStreamingBatcher';

/**
 * Tests for the streaming event batcher.
 *
 * The batcher accumulates text/thinking chunks per conversation and flushes
 * once per animation frame. We use fake timers and mock requestAnimationFrame
 * to control flush timing precisely.
 */

const CONV_A = 'conv-a';
const CONV_B = 'conv-b';

describe('createStreamingBatcher', () => {
  let batcher: StreamingBatcher;
  let onFlushText: ReturnType<typeof vi.fn>;
  let onFlushThinking: ReturnType<typeof vi.fn>;
  let rafCallbacks: Array<() => void>;
  let nextRafId: number;

  beforeEach(() => {
    vi.useFakeTimers();

    // Track requestAnimationFrame callbacks manually so we can trigger them
    rafCallbacks = [];
    nextRafId = 1;

    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      const id = nextRafId++;
      rafCallbacks.push(cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    onFlushText = vi.fn();
    onFlushThinking = vi.fn();
    batcher = createStreamingBatcher(onFlushText, onFlushThinking);
  });

  afterEach(() => {
    batcher.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Helper: trigger the next scheduled requestAnimationFrame callback. */
  function triggerRAF() {
    const cb = rafCallbacks.shift();
    if (cb) cb();
  }

  // ==========================================================================
  // 1. Batches multiple text events into a single flush
  // ==========================================================================

  describe('text batching', () => {
    it('batches multiple text events into a single flush', () => {
      batcher.batchText(CONV_A, 'Hello');
      batcher.batchText(CONV_A, ' ');
      batcher.batchText(CONV_A, 'World');

      // Nothing flushed yet — still waiting for the animation frame
      expect(onFlushText).not.toHaveBeenCalled();

      // Trigger the scheduled frame
      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'Hello World');
    });

    it('does not call onFlushThinking when only text was batched', () => {
      batcher.batchText(CONV_A, 'some text');
      triggerRAF();

      expect(onFlushThinking).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 2. Batches thinking events separately from text events
  // ==========================================================================

  describe('thinking batching', () => {
    it('batches thinking events separately from text events', () => {
      batcher.batchText(CONV_A, 'visible ');
      batcher.batchText(CONV_A, 'text');
      batcher.batchThinking(CONV_A, 'internal ');
      batcher.batchThinking(CONV_A, 'reasoning');

      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'visible text');

      expect(onFlushThinking).toHaveBeenCalledTimes(1);
      expect(onFlushThinking).toHaveBeenCalledWith(CONV_A, 'internal reasoning');
    });

    it('flushes thinking without text when only thinking was batched', () => {
      batcher.batchThinking(CONV_A, 'thinking only');
      triggerRAF();

      expect(onFlushText).not.toHaveBeenCalled();
      expect(onFlushThinking).toHaveBeenCalledTimes(1);
      expect(onFlushThinking).toHaveBeenCalledWith(CONV_A, 'thinking only');
    });
  });

  // ==========================================================================
  // 3. Force-flush immediately on flush() call
  // ==========================================================================

  describe('flush()', () => {
    it('force-flushes all pending buffers immediately', () => {
      batcher.batchText(CONV_A, 'pending');
      batcher.batchThinking(CONV_A, 'thought');

      // Force flush without waiting for rAF
      batcher.flush();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'pending');
      expect(onFlushThinking).toHaveBeenCalledTimes(1);
      expect(onFlushThinking).toHaveBeenCalledWith(CONV_A, 'thought');
    });

    it('cancels the pending animation frame when flush is called', () => {
      batcher.batchText(CONV_A, 'data');

      // flush() should cancel the scheduled frame and flush synchronously
      batcher.flush();

      expect(cancelAnimationFrame).toHaveBeenCalled();
      expect(onFlushText).toHaveBeenCalledTimes(1);

      // Triggering the (now-cancelled) rAF should not double-flush
      triggerRAF();
      expect(onFlushText).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there are no pending buffers', () => {
      batcher.flush();

      expect(onFlushText).not.toHaveBeenCalled();
      expect(onFlushThinking).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 4. Handles concurrent conversations independently
  // ==========================================================================

  describe('concurrent conversations', () => {
    it('maintains separate buffers per conversation', () => {
      batcher.batchText(CONV_A, 'Hello from A');
      batcher.batchText(CONV_B, 'Hello from B');
      batcher.batchThinking(CONV_A, 'Thinking A');
      batcher.batchThinking(CONV_B, 'Thinking B');

      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(2);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'Hello from A');
      expect(onFlushText).toHaveBeenCalledWith(CONV_B, 'Hello from B');

      expect(onFlushThinking).toHaveBeenCalledTimes(2);
      expect(onFlushThinking).toHaveBeenCalledWith(CONV_A, 'Thinking A');
      expect(onFlushThinking).toHaveBeenCalledWith(CONV_B, 'Thinking B');
    });

    it('accumulates independently per conversation', () => {
      batcher.batchText(CONV_A, 'A1');
      batcher.batchText(CONV_B, 'B1');
      batcher.batchText(CONV_A, 'A2');
      batcher.batchText(CONV_B, 'B2');

      triggerRAF();

      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'A1A2');
      expect(onFlushText).toHaveBeenCalledWith(CONV_B, 'B1B2');
    });

    it('flushes only conversations that have pending data', () => {
      batcher.batchText(CONV_A, 'only A');

      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'only A');
    });
  });

  // ==========================================================================
  // 5. destroy() cancels pending animation frames
  // ==========================================================================

  describe('destroy()', () => {
    it('cancels the pending animation frame', () => {
      batcher.batchText(CONV_A, 'buffered');

      batcher.destroy();

      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('clears all pending buffers so they are not flushed', () => {
      batcher.batchText(CONV_A, 'text');
      batcher.batchThinking(CONV_A, 'thinking');

      batcher.destroy();

      // Manually trigger rAF callback — buffers should have been cleared
      triggerRAF();

      expect(onFlushText).not.toHaveBeenCalled();
      expect(onFlushThinking).not.toHaveBeenCalled();
    });

    it('is safe to call destroy multiple times', () => {
      batcher.batchText(CONV_A, 'data');

      batcher.destroy();
      batcher.destroy();

      expect(onFlushText).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 6. Multiple rapid calls accumulate before flush
  // ==========================================================================

  describe('rapid accumulation', () => {
    it('accumulates many rapid calls into one flush', () => {
      for (let i = 0; i < 100; i++) {
        batcher.batchText(CONV_A, `chunk${i}`);
      }

      // Only one rAF should have been scheduled despite 100 calls
      expect(rafCallbacks).toHaveLength(1);

      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      const expectedText = Array.from({ length: 100 }, (_, i) => `chunk${i}`).join('');
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, expectedText);
    });

    it('schedules only one frame for interleaved text and thinking calls', () => {
      batcher.batchText(CONV_A, 't1');
      batcher.batchThinking(CONV_A, 'th1');
      batcher.batchText(CONV_A, 't2');
      batcher.batchThinking(CONV_A, 'th2');

      // Should still be a single scheduled rAF
      expect(rafCallbacks).toHaveLength(1);

      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 't1t2');
      expect(onFlushThinking).toHaveBeenCalledTimes(1);
      expect(onFlushThinking).toHaveBeenCalledWith(CONV_A, 'th1th2');
    });

    it('allows new batching after a flush cycle completes', () => {
      // First batch + flush
      batcher.batchText(CONV_A, 'first');
      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'first');

      // Second batch + flush
      batcher.batchText(CONV_A, 'second');
      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(2);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'second');
    });

    it('does not leak data between flush cycles', () => {
      batcher.batchText(CONV_A, 'cycle1');
      triggerRAF();

      onFlushText.mockClear();
      onFlushThinking.mockClear();

      batcher.batchText(CONV_A, 'cycle2');
      triggerRAF();

      expect(onFlushText).toHaveBeenCalledTimes(1);
      expect(onFlushText).toHaveBeenCalledWith(CONV_A, 'cycle2');
    });
  });
});
