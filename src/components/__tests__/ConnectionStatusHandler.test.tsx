import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ConnectionStatusHandler } from '../shared/ConnectionStatusHandler';
import { ToastProvider } from '../ui/toast';
import { useConnectionStore } from '@/stores/connectionStore';
import { WEBSOCKET_DISCONNECT_GRACE_MS } from '@/lib/constants';

function renderHandler() {
  return render(
    <ToastProvider>
      <ConnectionStatusHandler />
    </ToastProvider>
  );
}

describe('ConnectionStatusHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConnectionStore.setState({
      status: 'connected',
      reconnectAttempt: 0,
      lastDisconnectedAt: null,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does not show toast when connected', () => {
    renderHandler();

    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS + 1000);
    });

    expect(document.body.textContent).not.toContain('Connection Lost');
  });

  it('shows disconnect toast after grace period', () => {
    renderHandler();

    act(() => {
      useConnectionStore.setState({ status: 'disconnected' });
    });

    // Before grace period - no toast
    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS - 100);
    });
    expect(document.body.textContent).not.toContain('Connection Lost');

    // After grace period - toast appears
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.body.textContent).toContain('Real-time updates paused');
  });

  it('does not show toast if reconnected before grace period expires', () => {
    renderHandler();

    act(() => {
      useConnectionStore.setState({ status: 'disconnected' });
    });

    // Reconnect before grace period
    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS - 1000);
    });

    act(() => {
      useConnectionStore.setState({ status: 'connected' });
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(document.body.textContent).not.toContain('Connection Lost');
    expect(document.body.textContent).not.toContain('Reconnected');
  });

  it('shows reconnected toast after disconnect toast was shown', () => {
    renderHandler();

    // Disconnect
    act(() => {
      useConnectionStore.setState({ status: 'disconnected' });
    });

    // Wait past grace period
    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS + 100);
    });

    expect(document.body.textContent).toContain('Real-time updates paused');

    // Reconnect
    act(() => {
      useConnectionStore.setState({ status: 'connected' });
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.body.textContent).toContain('Real-time updates resumed');
  });

  it('shows toast for connecting status (reconnection attempts)', () => {
    renderHandler();

    act(() => {
      useConnectionStore.setState({ status: 'connecting', reconnectAttempt: 3 });
    });

    // Wait past grace period
    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS + 100);
    });

    expect(document.body.textContent).toContain('Real-time updates paused');
  });
});
