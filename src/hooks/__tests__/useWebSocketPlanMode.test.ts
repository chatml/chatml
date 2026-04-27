import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isInPlanModeExitCooldown,
  markPlanModeExited,
  clearPlanModeState,
} from '../useWebSocketPlanMode';

describe('useWebSocketPlanMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isInPlanModeExitCooldown', () => {
    it('returns false when conversation has not exited plan mode', () => {
      expect(isInPlanModeExitCooldown('conv-fresh')).toBe(false);
    });

    it('returns true immediately after marking exited', () => {
      markPlanModeExited('conv-1');
      expect(isInPlanModeExitCooldown('conv-1')).toBe(true);
    });

    it('returns true within the 5-second cooldown window', () => {
      markPlanModeExited('conv-1');
      vi.advanceTimersByTime(4999);
      expect(isInPlanModeExitCooldown('conv-1')).toBe(true);
    });

    it('returns false after the 5-second cooldown elapses', () => {
      markPlanModeExited('conv-1');
      vi.advanceTimersByTime(5000);
      expect(isInPlanModeExitCooldown('conv-1')).toBe(false);
    });
  });

  describe('markPlanModeExited', () => {
    it('refreshes the cooldown when called again before expiry', () => {
      markPlanModeExited('conv-1');
      vi.advanceTimersByTime(3000);
      // Refresh cooldown
      markPlanModeExited('conv-1');

      // Now advance to where the original cooldown would have ended (orig + 5s = 8s).
      vi.advanceTimersByTime(2500);
      // Total since refresh = 2500ms. Still within 5s cooldown of refresh.
      expect(isInPlanModeExitCooldown('conv-1')).toBe(true);
    });

    it('isolates state across conversations', () => {
      markPlanModeExited('conv-a');
      expect(isInPlanModeExitCooldown('conv-a')).toBe(true);
      expect(isInPlanModeExitCooldown('conv-b')).toBe(false);
    });

    it('auto-cleanup runs after cooldown + 100ms grace', () => {
      markPlanModeExited('conv-1');
      vi.advanceTimersByTime(5100);
      // Auto-cleanup setTimeout should have fired and removed the entry.
      expect(isInPlanModeExitCooldown('conv-1')).toBe(false);
    });

    it('auto-cleanup does NOT remove entry that was refreshed', () => {
      markPlanModeExited('conv-1');
      vi.advanceTimersByTime(3000);
      markPlanModeExited('conv-1'); // refresh

      // Original auto-cleanup fires at 5100ms total elapsed (3000 + 2100 more).
      vi.advanceTimersByTime(2100);

      // Entry was refreshed so cleanup should leave it; still within new cooldown.
      expect(isInPlanModeExitCooldown('conv-1')).toBe(true);
    });
  });

  describe('clearPlanModeState', () => {
    it('removes a marked conversation immediately', () => {
      markPlanModeExited('conv-1');
      expect(isInPlanModeExitCooldown('conv-1')).toBe(true);

      clearPlanModeState('conv-1');
      expect(isInPlanModeExitCooldown('conv-1')).toBe(false);
    });

    it('is a no-op for unknown conversations', () => {
      expect(() => clearPlanModeState('nonexistent')).not.toThrow();
    });
  });
});
