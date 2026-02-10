import { describe, it, expect, beforeEach } from 'vitest';
import { useLinearAuthStore } from '../linearAuthStore';
import type { LinearUser } from '@/lib/linearAuth';

const mockUser: LinearUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  displayName: 'Test',
  avatarUrl: 'https://example.com/avatar.png',
};

describe('linearAuthStore', () => {
  beforeEach(() => {
    useLinearAuthStore.setState({
      isAuthenticated: false,
      user: null,
      oauthState: 'idle',
      oauthError: null,
    });
  });

  it('has correct initial state', () => {
    const state = useLinearAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.oauthState).toBe('idle');
    expect(state.oauthError).toBeNull();
  });

  describe('setAuthenticated', () => {
    it('sets authenticated with user', () => {
      useLinearAuthStore.getState().setAuthenticated(true, mockUser);

      const state = useLinearAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockUser);
      expect(state.oauthState).toBe('idle');
      expect(state.oauthError).toBeNull();
    });

    it('sets unauthenticated and clears user', () => {
      useLinearAuthStore.getState().setAuthenticated(true, mockUser);
      useLinearAuthStore.getState().setAuthenticated(false);

      const state = useLinearAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });

    it('clears any existing error when authenticating', () => {
      useLinearAuthStore.getState().failOAuth('some error');
      useLinearAuthStore.getState().setAuthenticated(true, mockUser);

      const state = useLinearAuthStore.getState();
      expect(state.oauthError).toBeNull();
      expect(state.oauthState).toBe('idle');
    });

    it('defaults user to null when not provided', () => {
      useLinearAuthStore.getState().setAuthenticated(true);

      const state = useLinearAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toBeNull();
    });
  });

  describe('startOAuth', () => {
    it('sets state to pending and clears error', () => {
      useLinearAuthStore.getState().failOAuth('previous error');
      useLinearAuthStore.getState().startOAuth();

      const state = useLinearAuthStore.getState();
      expect(state.oauthState).toBe('pending');
      expect(state.oauthError).toBeNull();
    });
  });

  describe('completeOAuth', () => {
    it('resets oauth state to idle', () => {
      useLinearAuthStore.getState().startOAuth();
      useLinearAuthStore.getState().completeOAuth();

      const state = useLinearAuthStore.getState();
      expect(state.oauthState).toBe('idle');
      expect(state.oauthError).toBeNull();
    });
  });

  describe('failOAuth', () => {
    it('sets error state with message', () => {
      useLinearAuthStore.getState().failOAuth('Authorization failed');

      const state = useLinearAuthStore.getState();
      expect(state.oauthState).toBe('error');
      expect(state.oauthError).toBe('Authorization failed');
    });
  });

  describe('cancelOAuth', () => {
    it('resets to idle from pending', () => {
      useLinearAuthStore.getState().startOAuth();
      useLinearAuthStore.getState().cancelOAuth();

      const state = useLinearAuthStore.getState();
      expect(state.oauthState).toBe('idle');
      expect(state.oauthError).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useLinearAuthStore.getState().setAuthenticated(true, mockUser);
      useLinearAuthStore.getState().startOAuth();
      useLinearAuthStore.getState().reset();

      const state = useLinearAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.oauthState).toBe('idle');
      expect(state.oauthError).toBeNull();
    });
  });

  describe('state transitions', () => {
    it('full OAuth lifecycle: idle -> pending -> complete -> authenticated', () => {
      // Start flow
      useLinearAuthStore.getState().startOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('pending');

      // Complete flow
      useLinearAuthStore.getState().completeOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('idle');

      // Set authenticated
      useLinearAuthStore.getState().setAuthenticated(true, mockUser);
      expect(useLinearAuthStore.getState().isAuthenticated).toBe(true);
      expect(useLinearAuthStore.getState().user).toEqual(mockUser);
    });

    it('failed OAuth lifecycle: idle -> pending -> error -> retry -> pending -> complete', () => {
      // Start flow
      useLinearAuthStore.getState().startOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('pending');

      // Fail
      useLinearAuthStore.getState().failOAuth('network error');
      expect(useLinearAuthStore.getState().oauthState).toBe('error');
      expect(useLinearAuthStore.getState().oauthError).toBe('network error');

      // Retry
      useLinearAuthStore.getState().startOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('pending');
      expect(useLinearAuthStore.getState().oauthError).toBeNull();

      // Success
      useLinearAuthStore.getState().completeOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('idle');
    });

    it('cancelled OAuth lifecycle: idle -> pending -> cancel -> idle', () => {
      useLinearAuthStore.getState().startOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('pending');

      useLinearAuthStore.getState().cancelOAuth();
      expect(useLinearAuthStore.getState().oauthState).toBe('idle');
    });

    it('disconnect lifecycle: authenticated -> reset -> unauthenticated', () => {
      useLinearAuthStore.getState().setAuthenticated(true, mockUser);
      expect(useLinearAuthStore.getState().isAuthenticated).toBe(true);

      useLinearAuthStore.getState().reset();
      expect(useLinearAuthStore.getState().isAuthenticated).toBe(false);
      expect(useLinearAuthStore.getState().user).toBeNull();
    });
  });
});
