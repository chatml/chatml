import type { PendingUserQuestion, UserQuestion } from '@/lib/types';

/**
 * Build the API-facing answers map from a PendingUserQuestion's selection state.
 *
 * Wire format: `Record<string, string>` keyed by question header. Multiple
 * selected labels are joined with a plain `,` (no space). This is intentionally
 * a model-facing display string — the model reads it as text, it is NOT a
 * structured/round-trippable encoding. Do not `.split(',')` it back into labels:
 * comma-containing labels would be parsed incorrectly. The internal selection
 * state (selectedIndices) is the source of truth for round-tripping.
 *
 * Empty "Other" (otherSelected with no text) is excluded so it doesn't pad the
 * answer or count toward "answered" gates.
 */
export function serializeUserQuestionAnswers(pending: PendingUserQuestion): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of pending.questions) {
    if (q.options.length === 0) {
      // Free-text question — single answer slot.
      const free = pending.freeTextAnswer[q.header];
      if (free && free.length > 0) out[q.header] = free;
      continue;
    }
    // Option-based question.
    const indices = pending.selectedIndices[q.header] ?? [];
    const labels = [...indices]
      .sort((a, b) => a - b)
      .map((i) => q.options[i]?.label)
      .filter((l): l is string => typeof l === 'string');
    const otherText = pending.otherText[q.header];
    if (pending.otherSelected[q.header] && otherText && otherText.length > 0) {
      labels.push(otherText);
    }
    if (labels.length > 0) out[q.header] = labels.join(',');
  }
  return out;
}

/**
 * Whether the user has provided an answer for the given question. Used both
 * for the per-question "advance" gate and the all-questions submit gate.
 *
 * - Option-based: at least one option index OR Other selected with non-empty text.
 * - Free-text: non-empty freeTextAnswer.
 */
export function isUserQuestionAnswered(pending: PendingUserQuestion, q: UserQuestion): boolean {
  if (q.options.length === 0) {
    const free = pending.freeTextAnswer[q.header];
    return typeof free === 'string' && free.length > 0;
  }
  const indices = pending.selectedIndices[q.header] ?? [];
  if (indices.length > 0) return true;
  if (!pending.otherSelected[q.header]) return false;
  const otherText = pending.otherText[q.header];
  return typeof otherText === 'string' && otherText.length > 0;
}
