import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAttentionCount } from '../useAttentionCount';
import { useAppStore } from '@/stores/appStore';
import { useDismissedAttentionStore, attentionId } from '@/stores/dismissedAttentionStore';
import type { WorktreeSession } from '@/lib/types';

function makeSession(overrides: Partial<WorktreeSession> = {}): WorktreeSession {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: 'ws-1',
    name: 'Test',
    branch: 'main',
    worktreePath: '/wt',
    status: 'idle',
    archived: false,
    ...overrides,
  } as WorktreeSession;
}

describe('useAttentionCount', () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: [] });
    useDismissedAttentionStore.setState({ entries: [] } as never);
  });

  it('returns 0 when there are no sessions', () => {
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(0);
  });

  it('counts sessions with status=error', () => {
    useAppStore.setState({
      sessions: [
        makeSession({ id: 's1', status: 'error' }),
        makeSession({ id: 's2', status: 'idle' }),
      ],
    });
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(1);
  });

  it('counts sessions with hasMergeConflict', () => {
    useAppStore.setState({
      sessions: [
        makeSession({ id: 's1', hasMergeConflict: true }),
        makeSession({ id: 's2' }),
      ],
    });
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(1);
  });

  it('counts CI failures only when PR is open', () => {
    useAppStore.setState({
      sessions: [
        makeSession({ id: 's1', checkStatus: 'failure', prStatus: 'open' }),
        // CI failure but no open PR — does not count
        makeSession({ id: 's2', checkStatus: 'failure', prStatus: 'merged' }),
      ],
    });
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(1);
  });

  it('skips archived sessions entirely', () => {
    useAppStore.setState({
      sessions: [
        makeSession({ id: 's1', status: 'error', archived: true }),
        makeSession({ id: 's2', hasMergeConflict: true, archived: true }),
      ],
    });
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(0);
  });

  it('respects dismissed attention items', () => {
    useAppStore.setState({
      sessions: [makeSession({ id: 's1', status: 'error' })],
    });
    useDismissedAttentionStore.setState({
      entries: [{ id: attentionId.error('s1'), at: Date.now() }],
    } as never);

    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(0);
  });

  it('sums multiple attention reasons across sessions', () => {
    useAppStore.setState({
      sessions: [
        makeSession({ id: 's1', status: 'error' }),
        makeSession({ id: 's2', hasMergeConflict: true }),
        makeSession({ id: 's3', checkStatus: 'failure', prStatus: 'open' }),
      ],
    });
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(3);
  });

  it('counts a session with multiple attention reasons multiple times', () => {
    useAppStore.setState({
      sessions: [
        makeSession({
          id: 's1',
          status: 'error',
          hasMergeConflict: true,
          checkStatus: 'failure',
          prStatus: 'open',
        }),
      ],
    });
    const { result } = renderHook(() => useAttentionCount());
    expect(result.current).toBe(3);
  });
});
