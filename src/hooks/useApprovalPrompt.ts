import { useEffect, useRef, useState } from 'react';

const TIMEOUT_MS = 55_000; // 55s — 5s before agent-runner's 60s timeout so our deny arrives first

export type ApprovalAction = 'allow_once' | 'allow_session' | 'deny_once' | 'deny_always';

/**
 * Shared approval timer + auto-deny logic for both single-tool and batch-tool
 * approval prompts. Handles:
 * - Elapsed time tracking with 200ms updates
 * - Auto-deny on timeout (TIMEOUT_MS)
 * - Submitting guard (prevents double-submit)
 * - State reset when request changes
 */
export function useApprovalTimer(
  requestId: string | undefined,
  onAction: (action: ApprovalAction) => void,
) {
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const autoDeniedRef = useRef(false);
  const onActionRef = useRef(onAction);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track previous requestId with useState (not useRef) so we can derive
  // state resets during render without violating react-hooks/refs.
  const [prevRequestId, setPrevRequestId] = useState<string>();

  // Keep the action ref in sync
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  // Reset state when request changes — render-time derivation pattern
  // (React's official "adjusting state based on props" approach).
  // Ref resets and Date.now() are deferred to the timer effect below.
  if (requestId !== prevRequestId) {
    setPrevRequestId(requestId);
    if (requestId) {
      setSubmitting(false);
      setElapsed(0);
    }
  }

  // Timer + auto-deny. Also resets refs when requestId changes (effects
  // run after render, so the render-time setState above is already batched).
  useEffect(() => {
    if (!requestId) return;
    submittingRef.current = false;
    autoDeniedRef.current = false;
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const now = Date.now() - startTime;
      setElapsed(now);
      if (now >= TIMEOUT_MS && !autoDeniedRef.current) {
        autoDeniedRef.current = true;
        onActionRef.current('deny_once');
      }
    }, 200);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [requestId]);

  const progressPct = Math.min(100, (elapsed / TIMEOUT_MS) * 100);

  return { elapsed, progressPct, submitting, setSubmitting, submittingRef };
}

/**
 * Shared keyboard shortcut handler for approval prompts.
 * - Escape → deny_once
 * - Cmd/Ctrl+Enter → allow_session
 * - Enter (plain, outside textarea) → allow_once
 *
 * Set `skipEnterInTextarea` to true (default) to let Enter pass through to
 * textareas without triggering an action. Set to false when there are no
 * editable fields (e.g., batch approval) so Enter always triggers allow_once.
 */
export function useApprovalKeyboard(
  active: boolean,
  onAction: (action: ApprovalAction) => void,
  opts?: { skipEnterInTextarea?: boolean },
) {
  const skipEnterInTextarea = opts?.skipEnterInTextarea ?? true;

  // Stable ref so the event listener doesn't re-register on every render
  const onActionRef = useRef(onAction);
  useEffect(() => { onActionRef.current = onAction; }, [onAction]);

  useEffect(() => {
    if (!active) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onActionRef.current('deny_once');
        return;
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onActionRef.current('allow_session');
        return;
      }

      // Plain Enter = Allow once. Skip if inside textarea when skipEnterInTextarea is set.
      if (e.key === 'Enter' && !e.shiftKey) {
        if (skipEnterInTextarea) {
          const target = e.target as HTMLElement;
          if (target.tagName === 'TEXTAREA') return;
        }
        e.preventDefault();
        onActionRef.current('allow_once');
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [active, skipEnterInTextarea]);
}

export { TIMEOUT_MS };
