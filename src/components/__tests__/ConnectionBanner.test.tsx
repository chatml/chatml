import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConnectionBanner } from '../shared/ConnectionBanner';
import { useConnectionStore } from '@/stores/connectionStore';
import { WEBSOCKET_DISCONNECT_GRACE_MS } from '@/lib/constants';

describe('ConnectionBanner', () => {
  const mockReconnect = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockReconnect.mockClear();
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

  it('does not render when connected', () => {
    const { container } = render(<ConnectionBanner onReconnect={mockReconnect} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render before grace period', () => {
    useConnectionStore.setState({
      status: 'disconnected',
      lastDisconnectedAt: Date.now(),
    });

    const { container } = render(<ConnectionBanner onReconnect={mockReconnect} />);

    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS - 100);
    });

    expect(container.textContent).not.toContain('Connection lost');
  });

  it('renders after grace period when disconnected', () => {
    useConnectionStore.setState({
      status: 'disconnected',
      lastDisconnectedAt: Date.now(),
    });

    render(<ConnectionBanner onReconnect={mockReconnect} />);

    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS + 100);
    });

    expect(document.body.textContent).toContain('Connection lost');
    expect(document.body.textContent).toContain('Reconnect');
  });

  it('shows attempt count when reconnecting', () => {
    useConnectionStore.setState({
      status: 'connecting',
      reconnectAttempt: 5,
      lastDisconnectedAt: Date.now() - WEBSOCKET_DISCONNECT_GRACE_MS - 1000,
    });

    render(<ConnectionBanner onReconnect={mockReconnect} />);

    // Already past grace period since lastDisconnectedAt is old enough
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.body.textContent).toContain('attempt 5');
  });

  it('hides when connection restores', () => {
    useConnectionStore.setState({
      status: 'disconnected',
      lastDisconnectedAt: Date.now(),
    });

    render(<ConnectionBanner onReconnect={mockReconnect} />);

    act(() => {
      vi.advanceTimersByTime(WEBSOCKET_DISCONNECT_GRACE_MS + 100);
    });

    expect(document.body.textContent).toContain('Connection lost');

    // Reconnect
    act(() => {
      useConnectionStore.setState({ status: 'connected' });
    });

    expect(document.body.textContent).not.toContain('Connection lost');
  });

  it('calls onReconnect when button is clicked', () => {
    useConnectionStore.setState({
      status: 'disconnected',
      lastDisconnectedAt: Date.now() - WEBSOCKET_DISCONNECT_GRACE_MS - 1000,
    });

    render(<ConnectionBanner onReconnect={mockReconnect} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const button = screen.getByRole('button', { name: /reconnect/i });
    fireEvent.click(button);

    expect(mockReconnect).toHaveBeenCalledOnce();
  });

  it('disables reconnect button while reconnecting', () => {
    useConnectionStore.setState({
      status: 'connecting',
      reconnectAttempt: 2,
      lastDisconnectedAt: Date.now() - WEBSOCKET_DISCONNECT_GRACE_MS - 1000,
    });

    render(<ConnectionBanner onReconnect={mockReconnect} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const button = screen.getByRole('button', { name: /reconnect/i });
    expect(button).toBeDisabled();
  });

  it('renders immediately if already past grace period', () => {
    useConnectionStore.setState({
      status: 'disconnected',
      lastDisconnectedAt: Date.now() - WEBSOCKET_DISCONNECT_GRACE_MS - 5000,
    });

    render(<ConnectionBanner onReconnect={mockReconnect} />);

    // Should be visible immediately, no timer needed
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.body.textContent).toContain('Connection lost');
  });
});
