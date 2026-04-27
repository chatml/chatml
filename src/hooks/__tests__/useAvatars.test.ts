import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { useAvatars, getCachedAvatar, clearAvatarCache } from '../useAvatars';

const API_BASE = 'http://localhost:9876';

describe('useAvatars', () => {
  beforeEach(() => {
    clearAvatarCache();
    server.use(
      http.get(`${API_BASE}/api/avatars`, ({ request }) => {
        const emails = new URL(request.url).searchParams.get('emails') ?? '';
        const list = emails.split(',').filter(Boolean);
        const avatars: Record<string, string> = {};
        for (const e of list) avatars[e] = `https://avatars/${e}`;
        return HttpResponse.json({ avatars });
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getCachedAvatar / clearAvatarCache', () => {
    it('returns undefined for an uncached email', () => {
      expect(getCachedAvatar('nobody@example.com')).toBeUndefined();
    });

    it('clears all entries', async () => {
      const { result, unmount } = renderHook(() => useAvatars(['alice@example.com']));
      await waitFor(() => {
        expect(result.current['alice@example.com']).toBe('https://avatars/alice@example.com');
      });
      expect(getCachedAvatar('alice@example.com')).toBeDefined();

      clearAvatarCache();
      expect(getCachedAvatar('alice@example.com')).toBeUndefined();
      unmount();
    });
  });

  it('returns empty object for an empty email list', () => {
    const { result } = renderHook(() => useAvatars([]));
    expect(result.current).toEqual({});
  });

  it('fetches avatars for new emails (after debounce)', async () => {
    const { result } = renderHook(() => useAvatars(['alice@example.com']));

    await waitFor(() => {
      expect(result.current['alice@example.com']).toBe('https://avatars/alice@example.com');
    });
  });

  it('lowercases email keys when caching', async () => {
    const { result } = renderHook(() => useAvatars(['Alice@Example.com']));
    await waitFor(() => {
      expect(result.current['alice@example.com']).toBeDefined();
    });
    expect(getCachedAvatar('ALICE@EXAMPLE.COM')).toBeDefined();
  });

  it('serves cached avatars synchronously without re-fetching', async () => {
    let getCount = 0;
    server.use(
      http.get(`${API_BASE}/api/avatars`, ({ request }) => {
        getCount++;
        const emails = new URL(request.url).searchParams.get('emails') ?? '';
        const list = emails.split(',').filter(Boolean);
        const avatars: Record<string, string> = {};
        for (const e of list) avatars[e] = `https://avatars/${e}`;
        return HttpResponse.json({ avatars });
      })
    );

    const { result, rerender } = renderHook(({ emails }) => useAvatars(emails), {
      initialProps: { emails: ['x@example.com'] },
    });

    await waitFor(() => expect(result.current['x@example.com']).toBeDefined());
    const initial = getCount;

    // Re-render with the same email — should hit cache, not refetch
    rerender({ emails: ['x@example.com'] });
    await new Promise((r) => setTimeout(r, 100));

    expect(getCount).toBe(initial);
    expect(result.current['x@example.com']).toBe('https://avatars/x@example.com');
  });

  it('deduplicates emails before fetching', async () => {
    let capturedSearch = '';
    server.use(
      http.get(`${API_BASE}/api/avatars`, ({ request }) => {
        capturedSearch = new URL(request.url).search;
        return HttpResponse.json({
          avatars: { 'a@example.com': 'https://avatars/a@example.com' },
        });
      })
    );

    renderHook(() => useAvatars(['a@example.com', 'A@Example.com', 'a@example.com']));
    await waitFor(() => {
      expect(capturedSearch).toContain('a%40example.com');
    });

    // Only one comma-joined email should appear (no duplicates)
    const emails = new URLSearchParams(capturedSearch).get('emails') ?? '';
    expect(emails.split(',').length).toBe(1);
  });

  it('skips empty/whitespace emails', async () => {
    let capturedSearch = '';
    server.use(
      http.get(`${API_BASE}/api/avatars`, ({ request }) => {
        capturedSearch = new URL(request.url).search;
        return HttpResponse.json({
          avatars: { 'real@example.com': 'https://avatars/real@example.com' },
        });
      })
    );

    const { result } = renderHook(() => useAvatars(['', '  ', 'real@example.com']));
    await waitFor(() => expect(result.current['real@example.com']).toBeDefined());

    const emails = new URLSearchParams(capturedSearch).get('emails') ?? '';
    expect(emails).toBe('real@example.com');
  });

  it('marks emails as fetched (with empty value) on API error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server.use(
      http.get(`${API_BASE}/api/avatars`, () =>
        HttpResponse.text('boom', { status: 500 })
      )
    );

    renderHook(() => useAvatars(['failing@example.com']));

    await waitFor(() => {
      expect(getCachedAvatar('failing@example.com')).toBe('');
    });
    errorSpy.mockRestore();
  });
});
