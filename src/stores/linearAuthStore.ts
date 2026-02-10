import { create } from 'zustand';
import type { LinearUser } from '@/lib/linearAuth';

export type LinearOAuthState = 'idle' | 'pending' | 'error';

interface LinearAuthState {
  isAuthenticated: boolean;
  user: LinearUser | null;
  oauthState: LinearOAuthState;
  oauthError: string | null;

  setAuthenticated: (authenticated: boolean, user?: LinearUser | null) => void;
  startOAuth: () => void;
  completeOAuth: () => void;
  failOAuth: (error: string) => void;
  cancelOAuth: () => void;
  reset: () => void;
}

export const useLinearAuthStore = create<LinearAuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  oauthState: 'idle',
  oauthError: null,

  setAuthenticated: (isAuthenticated, user = null) => set({
    isAuthenticated,
    user,
    oauthState: 'idle',
    oauthError: null,
  }),

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

  reset: () => set({
    isAuthenticated: false,
    user: null,
    oauthState: 'idle',
    oauthError: null,
  }),
}));
