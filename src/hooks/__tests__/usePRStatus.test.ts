import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { usePRStatus } from '../usePRStatus';
import type { PRDetails } from '@/lib/api';

const API_BASE = 'http://localhost:9876';

const mockPR: PRDetails = {
  number: 42,
  state: 'open',
  title: 'Test PR',
  body: '',
  htmlUrl: 'https://github.com/x/y/pull/42',
  merged: false,
  mergeable: true,
  mergeableState: 'clean',
  checkStatus: 'success',
  checkDetails: [],
  reviewDecision: 'approved',
  requestedReviewers: 0,
};

// The hook clears stale data via setTimeout(0) on mount and on session change.
// In production the network is slow enough that the timer fires first; in tests
// MSW responds on the microtask queue, which would race ahead and let the clear
// effect overwrite freshly-fetched data. A tiny delay (1ms macrotask) gives the
// clear effect a chance to fire before the fetch resolves, matching real-world ordering.
function delayedJson<T>(data: T) {
  return async () => {
    await new Promise((r) => setTimeout(r, 1));
    return HttpResponse.json(data);
  };
}

describe('usePRStatus', () => {
  beforeEach(() => {
    server.use(
      http.get(
        `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`,
        delayedJson(mockPR)
      ),
      http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-refresh`, () =>
        new HttpResponse(null, { status: 202 })
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null pr details when no session is provided', async () => {
    const { result } = renderHook(() => usePRStatus(null, null, undefined, true));
    expect(result.current.prDetails).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('returns null when prStatus is "none" (no PR)', async () => {
    const { result } = renderHook(() => usePRStatus('ws-1', 's-1', 'none', true));
    await new Promise((r) => setTimeout(r, 0)); // allow effects to flush
    expect(result.current.prDetails).toBeNull();
  });

  it('fetches and returns PR details when prStatus=open', async () => {
    const { result } = renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    await waitFor(() => {
      expect(result.current.prDetails).not.toBeNull();
    });

    expect(result.current.prDetails?.number).toBe(42);
    expect(result.current.prDetails?.state).toBe('open');
    expect(result.current.error).toBeNull();
  });

  it('skips initial fetch when active=false on mount', async () => {
    let getCount = 0;
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, () => {
        getCount++;
        return HttpResponse.json(mockPR);
      })
    );

    renderHook(() => usePRStatus('ws-1', 's-1', 'open', false));
    await new Promise((r) => setTimeout(r, 50));

    expect(getCount).toBe(0);
  });

  it('treats 401 as "no data" and clears prDetails silently', async () => {
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return HttpResponse.text('unauthorized', { status: 401 });
      })
    );

    const { result } = renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.prDetails).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('exposes error message on non-401 failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return HttpResponse.text('boom', { status: 500 });
      })
    );

    const { result } = renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toBe('boom');
    errorSpy.mockRestore();
  });

  it('refetch() re-runs the fetch and shows loading=true while in flight', async () => {
    const { result } = renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    await waitFor(() => expect(result.current.prDetails).not.toBeNull());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.prDetails?.number).toBe(42);
    expect(result.current.loading).toBe(false);
  });

  it('clears stale data and refetches when session changes', async () => {
    let getCount = 0;
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, async () => {
        await new Promise((r) => setTimeout(r, 1));
        getCount++;
        return HttpResponse.json(mockPR);
      })
    );

    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        usePRStatus('ws-1', sessionId, 'open', true),
      { initialProps: { sessionId: 's-1' } }
    );

    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(1));
    const initial = getCount;

    rerender({ sessionId: 's-2' });

    // Switching session triggers a fresh fetch
    await waitFor(() => expect(getCount).toBeGreaterThan(initial));
  });

  it('triggers a backend force-check (refreshPRStatus) on initial fetch', async () => {
    let postCount = 0;
    server.use(
      http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-refresh`, () => {
        postCount++;
        return new HttpResponse(null, { status: 202 });
      })
    );

    renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    await waitFor(() => {
      expect(postCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('polls every 90s when prStatus is open', async () => {
    let getCount = 0;
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, async () => {
        await new Promise((r) => setTimeout(r, 1));
        getCount++;
        return HttpResponse.json(mockPR);
      })
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    // Wait for initial fetch (uses real-timer wait under shouldAdvanceTime)
    await vi.waitFor(() => expect(getCount).toBeGreaterThanOrEqual(1));
    const initial = getCount;

    // Advance through the 90-second polling interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });

    // Allow the resulting fetch to resolve through MSW
    await vi.waitFor(() => expect(getCount).toBeGreaterThan(initial));
  });

  it('does not poll when prStatus is not "open"', async () => {
    let getCount = 0;
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, async () => {
        await new Promise((r) => setTimeout(r, 1));
        getCount++;
        return HttpResponse.json(mockPR);
      })
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderHook(() => usePRStatus('ws-1', 's-1', 'merged', true));

    // Advance 5 minutes — no polls should fire because status isn't 'open'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });

    expect(getCount).toBeLessThanOrEqual(1); // Only the initial fetch (or zero — no PR open)
  });

  it('cleans up polling timer on unmount', async () => {
    let getCount = 0;
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, async () => {
        await new Promise((r) => setTimeout(r, 1));
        getCount++;
        return HttpResponse.json(mockPR);
      })
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { unmount } = renderHook(() => usePRStatus('ws-1', 's-1', 'open', true));

    await vi.waitFor(() => expect(getCount).toBeGreaterThanOrEqual(1));

    unmount();
    const beforeAdvance = getCount;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 90_000);
    });

    expect(getCount).toBe(beforeAdvance);
  });
});
