/**
 * Streaming event batcher for WebSocket text and thinking deltas.
 *
 * During heavy streaming the agent SDK can emit 60+ `assistant_text` and
 * `thinking_delta` events per second. Each event triggering a Zustand store
 * update (and React re-render) overwhelms reconciliation and causes jank.
 *
 * The batcher accumulates text per-conversation and flushes once per animation
 * frame (~16 ms), reducing store updates from 60+/sec to ~10/sec while keeping
 * the UI visually in-sync with the display refresh rate.
 *
 * Force-flush semantics: callers must call `flush()` before processing any
 * event that depends on up-to-date store state (tool_start, result, complete,
 * error, interrupted, turn_complete, conversation_status).
 */

export interface StreamingBatcher {
  /** Buffer an assistant_text chunk for deferred store update. */
  batchText(conversationId: string, text: string): void;
  /** Buffer a thinking_delta chunk for deferred store update. */
  batchThinking(conversationId: string, text: string): void;
  /** Force-flush all pending buffers immediately. */
  flush(): void;
  /** Tear down — cancel pending frame and clear buffers. */
  destroy(): void;
}

/**
 * Factory that creates a streaming batcher instance.
 *
 * @param onFlushText  Called once per conversation per flush with the accumulated text.
 *                     Should handle `appendStreamingText`, `setThinking(false)`, and
 *                     `clearInputSuggestion` since those are deferred to flush time.
 * @param onFlushThinking  Called once per conversation per flush with accumulated thinking text.
 */
export function createStreamingBatcher(
  onFlushText: (conversationId: string, text: string) => void,
  onFlushThinking: (conversationId: string, text: string) => void,
): StreamingBatcher {
  const textBuffers = new Map<string, string>();
  const thinkingBuffers = new Map<string, string>();
  let frameId: number | null = null;

  const useRAF = typeof requestAnimationFrame === 'function';

  function flushAll() {
    frameId = null;

    // Flush text buffers
    for (const [convId, text] of textBuffers) {
      onFlushText(convId, text);
    }
    textBuffers.clear();

    // Flush thinking buffers
    for (const [convId, text] of thinkingBuffers) {
      onFlushThinking(convId, text);
    }
    thinkingBuffers.clear();
  }

  function scheduleFlush() {
    if (frameId !== null) return; // Already scheduled
    frameId = useRAF
      ? requestAnimationFrame(flushAll)
      : (setTimeout(flushAll, 0) as unknown as number);
  }

  function cancelFrame() {
    if (frameId === null) return;
    if (useRAF) {
      cancelAnimationFrame(frameId);
    } else {
      clearTimeout(frameId);
    }
    frameId = null;
  }

  return {
    batchText(conversationId: string, text: string) {
      textBuffers.set(conversationId, (textBuffers.get(conversationId) || '') + text);
      scheduleFlush();
    },

    batchThinking(conversationId: string, text: string) {
      thinkingBuffers.set(conversationId, (thinkingBuffers.get(conversationId) || '') + text);
      scheduleFlush();
    },

    flush() {
      cancelFrame();
      flushAll();
    },

    destroy() {
      cancelFrame();
      textBuffers.clear();
      thinkingBuffers.clear();
    },
  };
}
