import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useApprovalTimer,
  useApprovalKeyboard,
  TIMEOUT_MS,
  type ApprovalAction,
} from '../useApprovalPrompt';

describe('useApprovalTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial state when no requestId is provided', () => {
    const { result } = renderHook(() => useApprovalTimer(undefined, vi.fn()));
    expect(result.current.elapsed).toBe(0);
    expect(result.current.progressPct).toBe(0);
    expect(result.current.submitting).toBe(false);
  });

  it('updates elapsed on the 200ms tick when requestId is set', () => {
    const onAction = vi.fn();
    const { result } = renderHook(() => useApprovalTimer('req-1', onAction));

    expect(result.current.elapsed).toBe(0);

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.elapsed).toBeGreaterThanOrEqual(400);
    expect(result.current.progressPct).toBeGreaterThan(0);
  });

  it('auto-denies after TIMEOUT_MS elapses', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalTimer('req-1', onAction));

    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS + 200);
    });

    expect(onAction).toHaveBeenCalledWith('deny_once');
  });

  it('only auto-denies once per request even if more time passes', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalTimer('req-1', onAction));

    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);
    });

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('resets elapsed and submitting when requestId changes', () => {
    const onAction = vi.fn();
    const { result, rerender } = renderHook(
      ({ rid }: { rid: string | undefined }) => useApprovalTimer(rid, onAction),
      { initialProps: { rid: 'req-1' as string | undefined } }
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.elapsed).toBeGreaterThanOrEqual(2000);

    rerender({ rid: 'req-2' });
    // After requestId change, elapsed resets to 0
    expect(result.current.elapsed).toBe(0);
  });

  it('clears the timer on unmount', () => {
    const onAction = vi.fn();
    const { unmount } = renderHook(() => useApprovalTimer('req-1', onAction));

    unmount();
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);
    });

    expect(onAction).not.toHaveBeenCalled();
  });

  it('progressPct caps at 100', () => {
    const { result } = renderHook(() => useApprovalTimer('req-1', vi.fn()));
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS * 2);
    });
    expect(result.current.progressPct).toBeLessThanOrEqual(100);
  });
});

describe('useApprovalKeyboard', () => {
  function dispatchKey(opts: KeyboardEventInit & { target?: EventTarget }) {
    act(() => {
      const event = new KeyboardEvent('keydown', { ...opts, cancelable: true, bubbles: true });
      if (opts.target) {
        Object.defineProperty(event, 'target', { value: opts.target });
      }
      window.dispatchEvent(event);
    });
  }

  it('Escape sends deny_once', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(true, onAction));

    dispatchKey({ key: 'Escape' });
    expect(onAction).toHaveBeenCalledWith('deny_once');
  });

  it('Cmd+Enter sends allow_always by default', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(true, onAction));

    dispatchKey({ key: 'Enter', metaKey: true });
    expect(onAction).toHaveBeenCalledWith('allow_always');
  });

  it('Cmd+Enter respects custom cmdEnterAction', () => {
    const onAction = vi.fn();
    renderHook(() =>
      useApprovalKeyboard(true, onAction, { cmdEnterAction: 'allow_session' as ApprovalAction })
    );

    dispatchKey({ key: 'Enter', metaKey: true });
    expect(onAction).toHaveBeenCalledWith('allow_session');
  });

  it('Ctrl+Enter also triggers cmdEnterAction (cross-platform)', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(true, onAction));

    dispatchKey({ key: 'Enter', ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith('allow_always');
  });

  it('plain Enter sends allow_once when not inside a textarea', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(true, onAction));

    dispatchKey({ key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith('allow_once');
  });

  it('plain Enter inside a textarea is suppressed by default', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(true, onAction));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    dispatchKey({ key: 'Enter', target: textarea });
    document.body.removeChild(textarea);

    expect(onAction).not.toHaveBeenCalled();
  });

  it('plain Enter inside a textarea fires when skipEnterInTextarea=false', () => {
    const onAction = vi.fn();
    renderHook(() =>
      useApprovalKeyboard(true, onAction, { skipEnterInTextarea: false })
    );

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    dispatchKey({ key: 'Enter', target: textarea });
    document.body.removeChild(textarea);

    expect(onAction).toHaveBeenCalledWith('allow_once');
  });

  it('Shift+Enter does not trigger', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(true, onAction));

    dispatchKey({ key: 'Enter', shiftKey: true });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does nothing when active=false', () => {
    const onAction = vi.fn();
    renderHook(() => useApprovalKeyboard(false, onAction));

    dispatchKey({ key: 'Escape' });
    dispatchKey({ key: 'Enter', metaKey: true });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', () => {
    const onAction = vi.fn();
    const { unmount } = renderHook(() => useApprovalKeyboard(true, onAction));

    unmount();
    dispatchKey({ key: 'Escape' });
    expect(onAction).not.toHaveBeenCalled();
  });
});
