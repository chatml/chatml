import { describe, it, expect } from 'vitest';
import {
  resolveThinkingParams,
  clampThinkingLevel,
  canDisableThinking,
  THINKING_TOKEN_MAP,
  type ModelThinkingCapabilities,
  type ThinkingLevel,
} from '../thinkingLevels';

const opusModel: ModelThinkingCapabilities = { supportsEffort: true, supportsThinking: true };
const sonnetModel: ModelThinkingCapabilities = { supportsEffort: false, supportsThinking: true };
const noThinkingModel: ModelThinkingCapabilities = { supportsEffort: false, supportsThinking: false };

describe('resolveThinkingParams', () => {
  describe('effort-capable model (Opus)', () => {
    it('maps "off" to effort "low" (cannot disable)', () => {
      expect(resolveThinkingParams('off', opusModel)).toEqual({ effort: 'low' });
    });

    it('maps "low" to effort "low"', () => {
      expect(resolveThinkingParams('low', opusModel)).toEqual({ effort: 'low' });
    });

    it('maps "medium" to effort "medium"', () => {
      expect(resolveThinkingParams('medium', opusModel)).toEqual({ effort: 'medium' });
    });

    it('maps "high" to no effort param (default)', () => {
      expect(resolveThinkingParams('high', opusModel)).toEqual({ effort: undefined });
    });

    it('maps "max" to effort "max"', () => {
      expect(resolveThinkingParams('max', opusModel)).toEqual({ effort: 'max' });
    });

    it('never includes maxThinkingTokens', () => {
      const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];
      for (const level of levels) {
        const result = resolveThinkingParams(level, opusModel);
        expect(result.maxThinkingTokens).toBeUndefined();
      }
    });

    it('ignores maxThinkingTokensCap', () => {
      expect(resolveThinkingParams('medium', opusModel, 1000)).toEqual({ effort: 'medium' });
    });
  });

  describe('token-budget model (Sonnet/Haiku)', () => {
    it('maps "off" to empty params', () => {
      expect(resolveThinkingParams('off', sonnetModel)).toEqual({});
    });

    it.each([
      ['low', 8000],
      ['medium', 10000],
      ['high', 16000],
      ['max', 32000],
    ] as [ThinkingLevel, number][])('maps "%s" to maxThinkingTokens %d', (level, expected) => {
      expect(resolveThinkingParams(level, sonnetModel)).toEqual({ maxThinkingTokens: expected });
    });

    it('never includes effort param', () => {
      const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'max'];
      for (const level of levels) {
        const result = resolveThinkingParams(level, sonnetModel);
        expect(result.effort).toBeUndefined();
      }
    });

    it('caps tokens with maxThinkingTokensCap', () => {
      expect(resolveThinkingParams('max', sonnetModel, 5000)).toEqual({ maxThinkingTokens: 5000 });
    });

    it('does not increase tokens when cap is higher than level budget', () => {
      expect(resolveThinkingParams('low', sonnetModel, 100000)).toEqual({ maxThinkingTokens: 8000 });
    });
  });

  describe('model without thinking support', () => {
    it('returns empty params for all levels', () => {
      const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];
      for (const level of levels) {
        expect(resolveThinkingParams(level, noThinkingModel)).toEqual({});
      }
    });
  });
});

describe('clampThinkingLevel', () => {
  it('clamps "off" to "low" for effort-capable models', () => {
    expect(clampThinkingLevel('off', opusModel)).toBe('low');
  });

  it('passes through other levels for effort-capable models', () => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'max'];
    for (const level of levels) {
      expect(clampThinkingLevel(level, opusModel)).toBe(level);
    }
  });

  it('allows "off" for non-effort models', () => {
    expect(clampThinkingLevel('off', sonnetModel)).toBe('off');
  });
});

describe('canDisableThinking', () => {
  it('returns false for effort-capable models', () => {
    expect(canDisableThinking(opusModel)).toBe(false);
  });

  it('returns true for non-effort models', () => {
    expect(canDisableThinking(sonnetModel)).toBe(true);
  });

  it('returns true for models without thinking support', () => {
    expect(canDisableThinking(noThinkingModel)).toBe(true);
  });
});

describe('THINKING_TOKEN_MAP', () => {
  it('has undefined for "off"', () => {
    expect(THINKING_TOKEN_MAP.off).toBeUndefined();
  });

  it('has increasing token budgets', () => {
    const low = THINKING_TOKEN_MAP.low!;
    const medium = THINKING_TOKEN_MAP.medium!;
    const high = THINKING_TOKEN_MAP.high!;
    const max = THINKING_TOKEN_MAP.max!;
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
    expect(high).toBeLessThan(max);
  });
});
