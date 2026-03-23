import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';

// Mock @/lib/tauri before importing the module under test
vi.mock('@/lib/tauri', () => ({
  isTauri: () => false,
}));

// Mock @/lib/api to return a fixed API base
vi.mock('@/lib/api', () => ({
  getApiBase: () => 'http://localhost:9876',
}));

const API_BASE = 'http://localhost:9876';

// We need to re-import after mocks since module-level code runs on import
let linearAuth: typeof import('../linearAuth');

beforeEach(async () => {
  // Clear sessionStorage between tests
  sessionStorage.clear();

  // Set Linear client ID for tests (guard requires it)
  vi.stubEnv('NEXT_PUBLIC_LINEAR_CLIENT_ID', 'test_linear_client_id');

  // Re-import to reset module-level state (pendingOAuthState, pendingCodeVerifier)
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.doMock('@/lib/tauri', () => ({ isTauri: () => false }));
  vi.doMock('@/lib/api', () => ({ getApiBase: () => API_BASE }));

  linearAuth = await import('../linearAuth');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LINEAR_STATE_PREFIX', () => {
  it('is "linear:"', () => {
    expect(linearAuth.LINEAR_STATE_PREFIX).toBe('linear:');
  });
});

describe('isLinearConfigured', () => {
  it('returns true when client ID is set', () => {
    expect(linearAuth.isLinearConfigured).toBe(true);
  });

  it('returns false when client ID is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_LINEAR_CLIENT_ID', '');
    vi.resetModules();
    vi.doMock('@/lib/tauri', () => ({ isTauri: () => false }));
    vi.doMock('@/lib/api', () => ({ getApiBase: () => API_BASE }));
    const mod = await import('../linearAuth');
    expect(mod.isLinearConfigured).toBe(false);
  });
});

describe('isLinearOAuthPending', () => {
  it('returns false initially', () => {
    expect(linearAuth.isLinearOAuthPending()).toBe(false);
  });
});

describe('cancelLinearOAuthFlow', () => {
  it('clears pending state and sessionStorage', async () => {
    // Start a flow to set pending state
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await linearAuth.startLinearOAuthFlow();
    expect(linearAuth.isLinearOAuthPending()).toBe(true);
    expect(sessionStorage.getItem('linear_oauth_state')).not.toBeNull();

    // Cancel it
    linearAuth.cancelLinearOAuthFlow();
    expect(linearAuth.isLinearOAuthPending()).toBe(false);
    expect(sessionStorage.getItem('linear_oauth_state')).toBeNull();
    expect(sessionStorage.getItem('linear_oauth_code_verifier')).toBeNull();

    openSpy.mockRestore();
  });
});

describe('startLinearOAuthFlow', () => {
  it('throws when client ID is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_LINEAR_CLIENT_ID', '');
    vi.resetModules();
    vi.doMock('@/lib/tauri', () => ({ isTauri: () => false }));
    vi.doMock('@/lib/api', () => ({ getApiBase: () => API_BASE }));
    const mod = await import('../linearAuth');

    await expect(mod.startLinearOAuthFlow())
      .rejects
      .toThrow('Linear integration is not configured for this build.');
  });

  it('opens a browser window with correct OAuth params', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await linearAuth.startLinearOAuthFlow();

    expect(openSpy).toHaveBeenCalledOnce();
    const url = new URL(openSpy.mock.calls[0][0] as string);

    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('chatml://oauth/callback');
    expect(url.searchParams.get('scope')).toBe('read');
    expect(url.searchParams.get('prompt')).toBe('consent');

    // State must start with "linear:" prefix
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^linear:/);

    // Code challenge must be present
    expect(url.searchParams.get('code_challenge')).toBeTruthy();

    openSpy.mockRestore();
  });

  it('persists state and code verifier to sessionStorage', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await linearAuth.startLinearOAuthFlow();

    expect(sessionStorage.getItem('linear_oauth_state')).toMatch(/^linear:/);
    expect(sessionStorage.getItem('linear_oauth_code_verifier')).toBeTruthy();

    openSpy.mockRestore();
  });

  it('sets pending state', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await linearAuth.startLinearOAuthFlow();
    expect(linearAuth.isLinearOAuthPending()).toBe(true);

    openSpy.mockRestore();
  });
});

describe('handleLinearOAuthCallback', () => {
  it('exchanges code via backend and returns user', async () => {
    const mockUser = {
      id: 'usr-1',
      name: 'Jane',
      email: 'jane@example.com',
      displayName: 'Jane D',
      avatarUrl: 'https://example.com/avatar.png',
    };

    server.use(
      http.post(`${API_BASE}/api/auth/linear/callback`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        // Verify the request body
        expect(body.code).toBe('auth-code-123');
        expect(body.redirect_uri).toBe('chatml://oauth/callback');
        expect(body.code_verifier).toBeTruthy();
        return HttpResponse.json({ user: mockUser });
      }),
    );

    // Start the flow to set pending state
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await linearAuth.startLinearOAuthFlow();

    const state = sessionStorage.getItem('linear_oauth_state')!;
    const callbackUrl = `chatml://oauth/callback?code=auth-code-123&state=${encodeURIComponent(state)}`;

    const result = await linearAuth.handleLinearOAuthCallback(callbackUrl);

    expect(result.user).toEqual(mockUser);
    expect(linearAuth.isLinearOAuthPending()).toBe(false);
    // SessionStorage should be cleared
    expect(sessionStorage.getItem('linear_oauth_state')).toBeNull();

    openSpy.mockRestore();
  });

  it('throws on error response from Linear', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await linearAuth.startLinearOAuthFlow();

    const state = sessionStorage.getItem('linear_oauth_state')!;
    const callbackUrl = `chatml://oauth/callback?error=access_denied&error_description=User+denied+access&state=${encodeURIComponent(state)}`;

    await expect(linearAuth.handleLinearOAuthCallback(callbackUrl))
      .rejects
      .toThrow('User denied access');

    openSpy.mockRestore();
  });

  it('throws when no authorization code is present', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await linearAuth.startLinearOAuthFlow();

    const state = sessionStorage.getItem('linear_oauth_state')!;
    const callbackUrl = `chatml://oauth/callback?state=${encodeURIComponent(state)}`;

    await expect(linearAuth.handleLinearOAuthCallback(callbackUrl))
      .rejects
      .toThrow('No authorization code received from Linear.');

    openSpy.mockRestore();
  });

  it('throws on state mismatch', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await linearAuth.startLinearOAuthFlow();

    const callbackUrl = 'chatml://oauth/callback?code=some-code&state=linear:wrong-state';

    await expect(linearAuth.handleLinearOAuthCallback(callbackUrl))
      .rejects
      .toThrow('Security error: state mismatch');

    openSpy.mockRestore();
  });

  it('throws when backend exchange fails', async () => {
    server.use(
      http.post(`${API_BASE}/api/auth/linear/callback`, () => {
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
    );

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await linearAuth.startLinearOAuthFlow();

    const state = sessionStorage.getItem('linear_oauth_state')!;
    const callbackUrl = `chatml://oauth/callback?code=code-123&state=${encodeURIComponent(state)}`;

    await expect(linearAuth.handleLinearOAuthCallback(callbackUrl))
      .rejects
      .toThrow('Failed to complete Linear authentication');

    openSpy.mockRestore();
  });
});

describe('getLinearAuthStatus', () => {
  it('returns auth status from backend', async () => {
    server.use(
      http.get(`${API_BASE}/api/auth/linear/status`, () => {
        return HttpResponse.json({
          authenticated: true,
          user: { id: 'u1', name: 'Test', email: 'test@example.com', displayName: 'Test', avatarUrl: '' },
        });
      }),
    );

    const status = await linearAuth.getLinearAuthStatus();
    expect(status.authenticated).toBe(true);
    expect(status.user?.name).toBe('Test');
  });

  it('returns unauthenticated status', async () => {
    server.use(
      http.get(`${API_BASE}/api/auth/linear/status`, () => {
        return HttpResponse.json({ authenticated: false });
      }),
    );

    const status = await linearAuth.getLinearAuthStatus();
    expect(status.authenticated).toBe(false);
    expect(status.user).toBeUndefined();
  });

  it('returns unauthenticated on non-OK response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.get(`${API_BASE}/api/auth/linear/status`, () => {
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
    );

    const status = await linearAuth.getLinearAuthStatus();
    expect(status.authenticated).toBe(false);
    expect(status.user).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[Linear Auth] Status check failed:', 500);

    errorSpy.mockRestore();
  });

  it('returns unauthenticated on network error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.get(`${API_BASE}/api/auth/linear/status`, () => {
        return HttpResponse.error();
      }),
    );

    const status = await linearAuth.getLinearAuthStatus();
    expect(status.authenticated).toBe(false);
    expect(status.user).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[Linear Auth] Status check failed:',
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});

describe('linearLogout', () => {
  it('calls backend logout endpoint', async () => {
    let logoutCalled = false;

    server.use(
      http.post(`${API_BASE}/api/auth/linear/logout`, () => {
        logoutCalled = true;
        return HttpResponse.json({});
      }),
    );

    await linearAuth.linearLogout();
    expect(logoutCalled).toBe(true);
  });

  it('logs error on non-OK response but does not throw', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.post(`${API_BASE}/api/auth/linear/logout`, () => {
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
    );

    // Should not throw
    await linearAuth.linearLogout();
    expect(errorSpy).toHaveBeenCalledWith('[Linear Auth] Logout failed:', 500);

    errorSpy.mockRestore();
  });

  it('does not throw on network error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.post(`${API_BASE}/api/auth/linear/logout`, () => {
        return HttpResponse.error();
      }),
    );

    // Should not throw
    await linearAuth.linearLogout();
    expect(errorSpy).toHaveBeenCalledWith(
      '[Linear Auth] Logout failed:',
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
