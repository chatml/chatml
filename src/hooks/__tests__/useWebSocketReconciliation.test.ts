import { describe, it, expect } from 'vitest';
import {
  startReconciling,
  stopReconciling,
  isReconciling,
  clearReconciliationState,
} from '../useWebSocketReconciliation';

// All tests must clean up their conversation IDs since the underlying state is module-level.

describe('useWebSocketReconciliation', () => {
  describe('isReconciling', () => {
    it('returns false for unknown conversation', () => {
      expect(isReconciling('never-touched')).toBe(false);
    });
  });

  describe('startReconciling / stopReconciling', () => {
    it('marks a conversation as reconciling and clears it after stop', () => {
      const id = 'rc-basic';
      startReconciling(id);
      expect(isReconciling(id)).toBe(true);
      stopReconciling(id);
      expect(isReconciling(id)).toBe(false);
    });

    it('handles concurrent reconciles via ref-counting', () => {
      const id = 'rc-nested';
      startReconciling(id);
      startReconciling(id);
      expect(isReconciling(id)).toBe(true);

      // First stop reduces counter from 2 to 1; still reconciling.
      stopReconciling(id);
      expect(isReconciling(id)).toBe(true);

      // Second stop drops counter to 0; cleared.
      stopReconciling(id);
      expect(isReconciling(id)).toBe(false);
    });

    it('stopReconciling on unknown id does not throw and stays cleared', () => {
      expect(() => stopReconciling('never-started')).not.toThrow();
      expect(isReconciling('never-started')).toBe(false);
    });

    it('isolates state across conversations', () => {
      startReconciling('rc-a');
      expect(isReconciling('rc-a')).toBe(true);
      expect(isReconciling('rc-b')).toBe(false);

      stopReconciling('rc-a');
    });
  });

  describe('clearReconciliationState', () => {
    it('clears regardless of pending counter', () => {
      const id = 'rc-clear';
      startReconciling(id);
      startReconciling(id);
      startReconciling(id);
      expect(isReconciling(id)).toBe(true);

      clearReconciliationState(id);
      expect(isReconciling(id)).toBe(false);
    });

    it('is a no-op for unknown conversations', () => {
      expect(() => clearReconciliationState('not-tracked')).not.toThrow();
    });
  });
});
