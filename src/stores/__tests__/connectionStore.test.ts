import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useConnectionStore } from '../connectionStore';

describe('connectionStore', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      status: 'connecting',
      reconnectAttempt: 0,
      lastDisconnectedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct initial state', () => {
    const state = useConnectionStore.getState();
    expect(state.status).toBe('connecting');
    expect(state.reconnectAttempt).toBe(0);
    expect(state.lastDisconnectedAt).toBeNull();
  });

  describe('setConnected', () => {
    it('sets status to connected and resets attempt count and lastDisconnectedAt', () => {
      useConnectionStore.setState({ status: 'connecting', reconnectAttempt: 5, lastDisconnectedAt: 1234567890 });

      useConnectionStore.getState().setConnected();

      const state = useConnectionStore.getState();
      expect(state.status).toBe('connected');
      expect(state.reconnectAttempt).toBe(0);
      expect(state.lastDisconnectedAt).toBeNull();
    });
  });

  describe('setDisconnected', () => {
    it('sets status to disconnected and records timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));

      useConnectionStore.setState({ status: 'connected' });
      useConnectionStore.getState().setDisconnected();

      const state = useConnectionStore.getState();
      expect(state.status).toBe('disconnected');
      expect(state.lastDisconnectedAt).toBe(Date.now());
    });

    it('does not overwrite lastDisconnectedAt if already disconnected', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));

      useConnectionStore.setState({ status: 'connected' });
      useConnectionStore.getState().setDisconnected();

      const firstTimestamp = useConnectionStore.getState().lastDisconnectedAt;

      vi.advanceTimersByTime(5000);
      useConnectionStore.getState().setDisconnected();

      expect(useConnectionStore.getState().lastDisconnectedAt).toBe(firstTimestamp);
    });
  });

  describe('setConnecting', () => {
    it('sets status to connecting with attempt number', () => {
      useConnectionStore.getState().setConnecting(3);

      const state = useConnectionStore.getState();
      expect(state.status).toBe('connecting');
      expect(state.reconnectAttempt).toBe(3);
    });
  });

  describe('state transitions', () => {
    it('full lifecycle: connecting -> connected -> disconnected -> connecting -> connected', () => {
      vi.useFakeTimers();

      // Initial connect
      useConnectionStore.getState().setConnected();
      expect(useConnectionStore.getState().status).toBe('connected');

      // Disconnect
      useConnectionStore.getState().setDisconnected();
      expect(useConnectionStore.getState().status).toBe('disconnected');
      expect(useConnectionStore.getState().lastDisconnectedAt).not.toBeNull();

      // Reconnecting
      useConnectionStore.getState().setConnecting(1);
      expect(useConnectionStore.getState().status).toBe('connecting');
      expect(useConnectionStore.getState().reconnectAttempt).toBe(1);

      // Reconnected
      useConnectionStore.getState().setConnected();
      expect(useConnectionStore.getState().status).toBe('connected');
      expect(useConnectionStore.getState().reconnectAttempt).toBe(0);
      expect(useConnectionStore.getState().lastDisconnectedAt).toBeNull();
    });
  });
});
