// src/stores/authStore.ts
import { create } from 'zustand';
import type { GitHubUser } from '@/lib/auth';

// OAuth flow states
export type OAuthState = 'idle' | 'pending' | 'error';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: GitHubUser | null;
  error: string | null;

  // OAuth flow state
  oauthState: OAuthState;
  oauthError: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setAuthenticated: (authenticated: boolean, user?: GitHubUser | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  // OAuth actions
  startOAuth: () => void;
  completeOAuth: () => void;
  failOAuth: (error: string) => void;
  cancelOAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoading: true, // Start with loading while checking auth
  isAuthenticated: false,
  user: null,
  error: null,

  // OAuth starts idle
  oauthState: 'idle',
  oauthError: null,

  setLoading: (isLoading) => set({ isLoading }),

  setAuthenticated: (isAuthenticated, user = null) => set({
    isAuthenticated,
    user,
    isLoading: false,
    error: null,
    oauthState: 'idle',
    oauthError: null,
  }),

  setError: (error) => set({
    error,
    isLoading: false,
  }),

  reset: () => set({
    isLoading: false,
    isAuthenticated: false,
    user: null,
    error: null,
    oauthState: 'idle',
    oauthError: null,
  }),

  // OAuth flow actions
  startOAuth: () => set({
    oauthState: 'pending',
    oauthError: null,
  }),

  completeOAuth: () => set({
    oauthState: 'idle',
    oauthError: null,
  }),

  failOAuth: (error) => set({
    oauthState: 'error',
    oauthError: error,
  }),

  cancelOAuth: () => set({
    oauthState: 'idle',
    oauthError: null,
  }),
}));
