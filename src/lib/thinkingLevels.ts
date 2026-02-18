/**
 * Unified thinking level configuration.
 *
 * Replaces the previous 3-control approach (thinking on/off, effort level,
 * max thinking tokens) with a single ThinkingLevel that maps to the correct
 * backend params per model.
 */

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export const THINKING_LEVELS: { id: ThinkingLevel; label: string; description: string }[] = [
  { id: 'off', label: 'Off', description: 'Disable extended thinking' },
  { id: 'low', label: 'Low', description: 'Minimal reasoning, may skip on simple tasks' },
  { id: 'medium', label: 'Medium', description: 'Balanced reasoning for moderate tasks' },
  { id: 'high', label: 'High', description: 'Strong reasoning for most problems' },
  { id: 'max', label: 'Max', description: 'Maximum reasoning depth and capability' },
];

/** Default thinking token budgets for non-effort models (Sonnet/Haiku). */
export const THINKING_TOKEN_MAP: Record<ThinkingLevel, number | undefined> = {
  off: undefined,
  low: 8000,
  medium: 10000,
  high: 16000,
  max: 32000,
};

export interface ModelThinkingCapabilities {
  /** Whether the model supports the effort parameter (Opus 4.6+). */
  supportsEffort: boolean;
  /** Whether the model supports extended thinking at all. */
  supportsThinking: boolean;
}

export interface ThinkingParams {
  effort?: string;
  maxThinkingTokens?: number;
}

/**
 * Translate a unified ThinkingLevel into backend API params based on model.
 *
 * - Opus 4.6 (supportsEffort): uses adaptive thinking + effort param.
 *   maxThinkingTokens is omitted — the model handles it dynamically.
 * - Sonnet/Haiku: uses manual thinking with budget_tokens.
 *   effort is omitted — not supported.
 *   The thinking level selects a token budget from THINKING_TOKEN_MAP,
 *   capped by maxThinkingTokensCap (the user's settings override).
 */
export function resolveThinkingParams(
  level: ThinkingLevel,
  model: ModelThinkingCapabilities,
  maxThinkingTokensCap?: number,
): ThinkingParams {
  if (model.supportsEffort) {
    // Opus 4.6: adaptive thinking — only send effort, no maxThinkingTokens
    const effectiveLevel = level === 'off' ? 'low' : level;
    return {
      effort: effectiveLevel !== 'high' ? effectiveLevel : undefined,
    };
  }

  if (!model.supportsThinking || level === 'off') {
    return {};
  }

  // Sonnet/Haiku: level picks the budget, settings value caps it
  const levelTokens = THINKING_TOKEN_MAP[level];
  const tokens = maxThinkingTokensCap != null && levelTokens != null
    ? Math.min(levelTokens, maxThinkingTokensCap)
    : levelTokens;
  return {
    maxThinkingTokens: tokens,
  };
}

/**
 * Clamp a ThinkingLevel for a given model.
 * Opus 4.6 can't disable thinking — 'off' becomes 'low'.
 */
export function clampThinkingLevel(
  level: ThinkingLevel,
  model: ModelThinkingCapabilities,
): ThinkingLevel {
  if (model.supportsEffort && level === 'off') return 'low';
  return level;
}

/**
 * Whether "Off" is allowed for this model.
 * Opus 4.6 always has implicit thinking — can't disable it.
 */
export function canDisableThinking(model: ModelThinkingCapabilities): boolean {
  return !model.supportsEffort;
}
