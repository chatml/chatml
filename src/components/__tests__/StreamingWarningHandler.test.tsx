import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { StreamingWarningHandler } from '../StreamingWarningHandler';
import { ToastProvider } from '../ui/toast';

describe('StreamingWarningHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows toast when streaming-warning event is dispatched', () => {
    render(
      <ToastProvider>
        <StreamingWarningHandler />
      </ToastProvider>
    );

    // Dispatch custom event inside act
    act(() => {
      window.dispatchEvent(
        new CustomEvent('streaming-warning', {
          detail: {
            source: 'process',
            reason: 'buffer_full',
            message: 'Some streaming data may have been lost',
          },
        })
      );
      vi.advanceTimersByTime(100);
    });

    expect(document.body.textContent).toContain('Some streaming data may have been lost');
  });

  it('uses default message when none provided', () => {
    render(
      <ToastProvider>
        <StreamingWarningHandler />
      </ToastProvider>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('streaming-warning', {
          detail: {
            source: 'hub',
            reason: 'broadcast_timeout',
          },
        })
      );
      vi.advanceTimersByTime(100);
    });

    expect(document.body.textContent).toContain('Some streaming data may have been lost');
  });

  it('debounces multiple warnings within 10 seconds', () => {
    render(
      <ToastProvider>
        <StreamingWarningHandler />
      </ToastProvider>
    );

    // Dispatch first warning
    act(() => {
      window.dispatchEvent(
        new CustomEvent('streaming-warning', {
          detail: { message: 'Warning 1' },
        })
      );
      vi.advanceTimersByTime(100);
    });

    // Dispatch second warning immediately (should be debounced)
    act(() => {
      window.dispatchEvent(
        new CustomEvent('streaming-warning', {
          detail: { message: 'Warning 2' },
        })
      );
      vi.advanceTimersByTime(100);
    });

    // Only first warning should appear
    expect(document.body.textContent).toContain('Warning 1');
    expect(document.body.textContent).not.toContain('Warning 2');
  });

  it('allows new warning after debounce period expires', () => {
    render(
      <ToastProvider>
        <StreamingWarningHandler />
      </ToastProvider>
    );

    // First warning
    act(() => {
      window.dispatchEvent(
        new CustomEvent('streaming-warning', {
          detail: { message: 'Warning 1' },
        })
      );
      vi.advanceTimersByTime(100);
    });

    // Wait for debounce to expire (10 seconds) + toast to clear (5 seconds + 200ms animation)
    act(() => {
      vi.advanceTimersByTime(15200);
    });

    // Second warning should now work
    act(() => {
      window.dispatchEvent(
        new CustomEvent('streaming-warning', {
          detail: { message: 'Warning 2' },
        })
      );
      vi.advanceTimersByTime(100);
    });

    expect(document.body.textContent).toContain('Warning 2');
  });

  it('cleans up event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(
      <ToastProvider>
        <StreamingWarningHandler />
      </ToastProvider>
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('streaming-warning', expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });
});
