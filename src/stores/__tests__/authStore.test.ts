import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore';
import type { GitHubUser } from '@/lib/auth';

const mockUser: GitHubUser = {
  login: 'testuser',
  id: 12345,
  avatar_url: 'https://example.com/avatar.png',
  name: 'Test User',
  email: 'test@example.com',
};

beforeEach(() => {
  useAuthStore.setState({
    isLoading: true,
    isAuthenticated: false,
    user: null,
    error: null,
    oauthState: 'idle',
    oauthError: null,
  });
});

// ============================================================================
// Initial State
// ============================================================================

describe('initial state', () => {
  it('starts with loading true and not authenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.error).toBeNull();
    expect(state.oauthState).toBe('idle');
    expect(state.oauthError).toBeNull();
  });
});

// ============================================================================
// setLoading
// ============================================================================

describe('setLoading', () => {
  it('sets loading state', () => {
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);

    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
  });
});

// ============================================================================
// setAuthenticated
// ============================================================================

describe('setAuthenticated', () => {
  it('sets authenticated with user', () => {
    useAuthStore.getState().setAuthenticated(true, mockUser);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('clears oauth state on authentication', () => {
    useAuthStore.setState({ oauthState: 'pending', oauthError: 'some error' });
    useAuthStore.getState().setAuthenticated(true, mockUser);
    const state = useAuthStore.getState();
    expect(state.oauthState).toBe('idle');
    expect(state.oauthError).toBeNull();
  });

  it('sets unauthenticated with null user by default', () => {
    useAuthStore.getState().setAuthenticated(false);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});

// ============================================================================
// setError
// ============================================================================

describe('setError', () => {
  it('sets error and stops loading', () => {
    useAuthStore.getState().setError('Something went wrong');
    const state = useAuthStore.getState();
    expect(state.error).toBe('Something went wrong');
    expect(state.isLoading).toBe(false);
  });

  it('clears error when set to null', () => {
    useAuthStore.setState({ error: 'old error' });
    useAuthStore.getState().setError(null);
    expect(useAuthStore.getState().error).toBeNull();
  });
});

// ============================================================================
// reset
// ============================================================================

describe('reset', () => {
  it('resets all state to defaults', () => {
    useAuthStore.setState({
      isLoading: true,
      isAuthenticated: true,
      user: mockUser,
      error: 'some error',
      oauthState: 'error',
      oauthError: 'oauth failed',
    });
    useAuthStore.getState().reset();
    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.error).toBeNull();
    expect(state.oauthState).toBe('idle');
    expect(state.oauthError).toBeNull();
  });
});

// ============================================================================
// OAuth Flow
// ============================================================================

describe('OAuth flow', () => {
  it('startOAuth sets pending state and clears error', () => {
    useAuthStore.setState({ oauthError: 'previous error' });
    useAuthStore.getState().startOAuth();
    const state = useAuthStore.getState();
    expect(state.oauthState).toBe('pending');
    expect(state.oauthError).toBeNull();
  });

  it('completeOAuth resets to idle', () => {
    useAuthStore.setState({ oauthState: 'pending' });
    useAuthStore.getState().completeOAuth();
    const state = useAuthStore.getState();
    expect(state.oauthState).toBe('idle');
    expect(state.oauthError).toBeNull();
  });

  it('failOAuth sets error state', () => {
    useAuthStore.setState({ oauthState: 'pending' });
    useAuthStore.getState().failOAuth('token expired');
    const state = useAuthStore.getState();
    expect(state.oauthState).toBe('error');
    expect(state.oauthError).toBe('token expired');
  });

  it('cancelOAuth resets to idle from pending', () => {
    useAuthStore.setState({ oauthState: 'pending' });
    useAuthStore.getState().cancelOAuth();
    const state = useAuthStore.getState();
    expect(state.oauthState).toBe('idle');
    expect(state.oauthError).toBeNull();
  });

  it('full OAuth flow: start → fail → start → complete', () => {
    const { startOAuth, failOAuth, completeOAuth } = useAuthStore.getState();

    startOAuth();
    expect(useAuthStore.getState().oauthState).toBe('pending');

    failOAuth('network error');
    expect(useAuthStore.getState().oauthState).toBe('error');
    expect(useAuthStore.getState().oauthError).toBe('network error');

    startOAuth();
    expect(useAuthStore.getState().oauthState).toBe('pending');
    expect(useAuthStore.getState().oauthError).toBeNull();

    completeOAuth();
    expect(useAuthStore.getState().oauthState).toBe('idle');
  });
});
