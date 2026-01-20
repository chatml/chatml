// src/stores/authStore.ts
import { create } from 'zustand';
import type { GitHubUser } from '@/lib/auth';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: GitHubUser | null;
  error: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setAuthenticated: (authenticated: boolean, user?: GitHubUser | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoading: true, // Start with loading while checking auth
  isAuthenticated: false,
  user: null,
  error: null,

  setLoading: (isLoading) => set({ isLoading }),

  setAuthenticated: (isAuthenticated, user = null) => set({
    isAuthenticated,
    user,
    isLoading: false,
    error: null,
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
  }),
}));
