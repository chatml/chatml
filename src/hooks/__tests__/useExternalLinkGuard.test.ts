import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExternalLinkGuard } from '../useExternalLinkGuard';

vi.mock('@/lib/tauri', () => ({
  openUrlInBrowser: vi.fn(),
}));

import { openUrlInBrowser } from '@/lib/tauri';

function clickAnchor(anchor: HTMLAnchorElement) {
  let prevented = false;
  let stopped = false;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'preventDefault', {
    value: () => {
      prevented = true;
    },
  });
  Object.defineProperty(event, 'stopPropagation', {
    value: () => {
      stopped = true;
    },
  });
  act(() => {
    anchor.dispatchEvent(event);
  });
  return { prevented, stopped };
}

describe('useExternalLinkGuard', () => {
  beforeEach(() => {
    vi.mocked(openUrlInBrowser).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens external https links in the system browser', () => {
    renderHook(() => useExternalLinkGuard());
    const a = document.createElement('a');
    a.href = 'https://example.com';
    document.body.appendChild(a);

    const { prevented } = clickAnchor(a);

    expect(prevented).toBe(true);
    expect(openUrlInBrowser).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/example\.com\/?$/));
  });

  it('opens external http links in the system browser', () => {
    renderHook(() => useExternalLinkGuard());
    const a = document.createElement('a');
    a.href = 'http://example.com';
    document.body.appendChild(a);

    clickAnchor(a);
    expect(openUrlInBrowser).toHaveBeenCalled();
  });

  it('does not intercept relative links', () => {
    renderHook(() => useExternalLinkGuard());
    const a = document.createElement('a');
    a.setAttribute('href', '/internal/path');
    document.body.appendChild(a);

    clickAnchor(a);
    expect(openUrlInBrowser).not.toHaveBeenCalled();
  });

  it('does not intercept empty href', () => {
    renderHook(() => useExternalLinkGuard());
    const a = document.createElement('a');
    document.body.appendChild(a);

    clickAnchor(a);
    expect(openUrlInBrowser).not.toHaveBeenCalled();
  });

  it('does not intercept clicks not on an anchor', () => {
    renderHook(() => useExternalLinkGuard());
    const div = document.createElement('div');
    document.body.appendChild(div);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      div.dispatchEvent(event);
    });

    expect(openUrlInBrowser).not.toHaveBeenCalled();
  });

  it('skips intercept when URL hash matches an in-page element', () => {
    renderHook(() => useExternalLinkGuard());
    const target = document.createElement('div');
    target.id = 'section-1';
    document.body.appendChild(target);

    const a = document.createElement('a');
    a.href = 'https://example.com/#section-1';
    document.body.appendChild(a);

    clickAnchor(a);
    // The in-page anchor matches → external open is skipped
    expect(openUrlInBrowser).not.toHaveBeenCalled();
  });

  it('still intercepts when URL hash does not match any element', () => {
    renderHook(() => useExternalLinkGuard());
    const a = document.createElement('a');
    a.href = 'https://example.com/#missing-anchor';
    document.body.appendChild(a);

    clickAnchor(a);
    expect(openUrlInBrowser).toHaveBeenCalled();
  });

  it('handles bubbled clicks from inside an anchor (e.g. a span child)', () => {
    renderHook(() => useExternalLinkGuard());
    const a = document.createElement('a');
    a.href = 'https://example.com';
    const span = document.createElement('span');
    a.appendChild(span);
    document.body.appendChild(a);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      span.dispatchEvent(event);
    });

    expect(openUrlInBrowser).toHaveBeenCalled();
  });

  it('cleans up the listener on unmount', () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());
    unmount();

    const a = document.createElement('a');
    a.href = 'https://example.com';
    document.body.appendChild(a);

    clickAnchor(a);
    expect(openUrlInBrowser).not.toHaveBeenCalled();
  });
});
