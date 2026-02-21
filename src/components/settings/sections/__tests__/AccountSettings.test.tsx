import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountSettings } from '../AccountSettings';
import { useAuthStore } from '@/stores/authStore';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Mock auth/linearAuth functions
const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockStartLinearOAuthFlow = vi.fn().mockResolvedValue(undefined);
const mockLinearLogout = vi.fn().mockResolvedValue(undefined);
const mockCancelLinearOAuthFlow = vi.fn();

vi.mock('@/lib/auth', () => ({
  logout: (...args: unknown[]) => mockLogout(...args),
}));

vi.mock('@/lib/linearAuth', () => ({
  startLinearOAuthFlow: (...args: unknown[]) => mockStartLinearOAuthFlow(...args),
  linearLogout: (...args: unknown[]) => mockLinearLogout(...args),
  cancelLinearOAuthFlow: (...args: unknown[]) => mockCancelLinearOAuthFlow(...args),
}));

describe('AccountSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset stores to default state
    useAuthStore.setState({
      isAuthenticated: false,
      user: null,
    });

    useLinearAuthStore.setState({
      isAuthenticated: false,
      user: null,
      oauthState: 'idle',
      oauthError: null,
    });

    useSettingsStore.setState({
      strictPrivacy: false,
    });
  });

  describe('Linear Integration - Not Connected', () => {
    it('shows connect prompt when not authenticated', () => {
      render(<AccountSettings />);

      expect(screen.getByText('Linear')).toBeInTheDocument();
      expect(screen.getByText('Connect Linear to import issues and track work.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    });

    it('calls startLinearOAuthFlow when Connect is clicked', async () => {
      render(<AccountSettings />);

      const connectButton = screen.getByRole('button', { name: 'Connect' });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(mockStartLinearOAuthFlow).toHaveBeenCalledOnce();
      });
    });
  });

  describe('Linear Integration - Pending', () => {
    beforeEach(() => {
      useLinearAuthStore.setState({ oauthState: 'pending' });
    });

    it('shows connecting spinner', () => {
      render(<AccountSettings />);

      expect(screen.getByText('Connecting...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      // Connect button should not be visible
      expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    });

    it('calls cancel functions when Cancel is clicked', () => {
      render(<AccountSettings />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(mockCancelLinearOAuthFlow).toHaveBeenCalledOnce();
    });
  });

  describe('Linear Integration - Connected', () => {
    beforeEach(() => {
      useLinearAuthStore.setState({
        isAuthenticated: true,
        user: {
          id: 'u1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          displayName: 'Jane',
          avatarUrl: 'https://example.com/avatar.png',
        },
      });
    });

    it('shows user info when authenticated', () => {
      render(<AccountSettings />);

      expect(screen.getByText(/Connected as Jane/)).toBeInTheDocument();
      expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    it('shows displayName over name when available', () => {
      render(<AccountSettings />);

      // Should show "Connected as Jane" (displayName), not "Jane Doe" (name)
      expect(screen.getByText(/Connected as Jane/)).toBeInTheDocument();
    });

    it('falls back to name when displayName is empty', () => {
      useLinearAuthStore.setState({
        isAuthenticated: true,
        user: {
          id: 'u1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          displayName: '',
          avatarUrl: '',
        },
      });

      render(<AccountSettings />);

      expect(screen.getByText(/Connected as Jane Doe/)).toBeInTheDocument();
    });

    it('calls linearLogout when Disconnect is clicked', async () => {
      render(<AccountSettings />);

      const disconnectButton = screen.getByRole('button', { name: 'Disconnect' });
      fireEvent.click(disconnectButton);

      await waitFor(() => {
        expect(mockLinearLogout).toHaveBeenCalledOnce();
      });
    });
  });

  describe('Linear Integration - Error', () => {
    it('shows error message when OAuth fails', () => {
      useLinearAuthStore.setState({
        oauthState: 'error',
        oauthError: 'Authorization was denied by the user',
      });

      render(<AccountSettings />);

      expect(screen.getByText('Authorization was denied by the user')).toBeInTheDocument();
      // Should still show Connect button to retry
      expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    });
  });

  describe('GitHub user section', () => {
    it('shows "Not signed in" when no user', () => {
      render(<AccountSettings />);

      expect(screen.getByText('Not signed in')).toBeInTheDocument();
    });

    it('shows user info when signed in', () => {
      useAuthStore.setState({
        isAuthenticated: true,
        user: {
          login: 'jdoe',
          name: 'Jane Doe',
          avatar_url: 'https://example.com/gh-avatar.png',
        },
      });

      render(<AccountSettings />);

      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('@jdoe')).toBeInTheDocument();
    });
  });

  describe('Sign out', () => {
    it('calls logout when sign out button is clicked', async () => {
      useAuthStore.setState({
        isAuthenticated: true,
        user: { login: 'jdoe', name: 'Jane', avatar_url: '' },
      });

      render(<AccountSettings />);

      const signOutButton = screen.getByRole('button', { name: /Sign out/i });
      fireEvent.click(signOutButton);

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledOnce();
      });
    });
  });
});
