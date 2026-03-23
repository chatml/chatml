import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { server } from '@/__mocks__/server';
import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:9876';

// Mock dependencies (these are hoisted before module evaluation)
vi.mock('@/lib/tauri', () => ({
  isTauri: vi.fn(() => false),
  safeListen: vi.fn(async () => vi.fn()),
  safeInvoke: vi.fn(async () => null),
}));

vi.mock('@/lib/backend-port', () => ({
  getBackendPortSync: vi.fn(() => 9876),
}));

vi.mock('@/lib/pkce', () => ({
  generateRandomString: vi.fn(() => 'mock-random-string'),
  generateCodeChallenge: vi.fn(async () => 'mock-challenge'),
}));

vi.mock('@/lib/linearAuth', () => ({
  LINEAR_STATE_PREFIX: 'linear:',
  handleLinearOAuthCallback: vi.fn(),
}));

/**
 * Re-apply vi.doMock() calls after vi.resetModules() and import fresh modules.
 * The auth module reads from sessionStorage on load, so resetModules is required
 * to get a fresh module with clean state for each test.
 */
function applyDoMocks() {
  vi.doMock('@/lib/tauri', () => ({
    isTauri: vi.fn(() => false),
    safeListen: vi.fn(async () => vi.fn()),
    safeInvoke: vi.fn(async () => null),
  }));
  vi.doMock('@/lib/backend-port', () => ({
    getBackendPortSync: vi.fn(() => 9876),
  }));
  vi.doMock('@/lib/pkce', () => ({
    generateRandomString: vi.fn(() => 'mock-random-string'),
    generateCodeChallenge: vi.fn(async () => 'mock-challenge'),
  }));
  vi.doMock('@/lib/linearAuth', () => ({
    LINEAR_STATE_PREFIX: 'linear:',
    handleLinearOAuthCallback: vi.fn(),
  }));
}

async function importFreshModules() {
  const tauriMod = await import('@/lib/tauri');
  const pkceMod = await import('@/lib/pkce');
  const linearAuthMod = await import('@/lib/linearAuth');
  const authMod = await import('../auth');

  return {
    ...authMod,
    mockIsTauri: vi.mocked(tauriMod.isTauri),
    mockSafeListen: vi.mocked(tauriMod.safeListen),
    mockSafeInvoke: vi.mocked(tauriMod.safeInvoke),
    mockGenerateRandomString: vi.mocked(pkceMod.generateRandomString),
    mockGenerateCodeChallenge: vi.mocked(pkceMod.generateCodeChallenge),
    mockHandleLinearOAuthCallback: vi.mocked(linearAuthMod.handleLinearOAuthCallback),
  };
}

async function setup() {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  applyDoMocks();
  return importFreshModules();
}

// Helper to set up sessionStorage state before module loads
// (the module reads from sessionStorage on import)
async function setupWithSessionState(state: string, verifier: string) {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem('oauth_state', state);
  sessionStorage.setItem('oauth_code_verifier', verifier);
  applyDoMocks();
  return importFreshModules();
}

const mockUser = {
  login: 'testuser',
  name: 'Test User',
  avatar_url: 'https://example.com/avatar.png',
};

describe('auth', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    server.resetHandlers();
  });

  // =========================================================
  // getOAuthErrorMessage (tested indirectly via handleOAuthCallback)
  // =========================================================
  describe('getOAuthErrorMessage (via handleOAuthCallback)', () => {
    it('maps access_denied to user-friendly message', async () => {
      const { handleOAuthCallback } = await setup();
      const url = 'chatml://oauth/callback?error=access_denied';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'You declined to authorize ChatML',
      );
    });

    it('maps redirect_uri_mismatch to config error', async () => {
      const { handleOAuthCallback } = await setup();
      const url = 'chatml://oauth/callback?error=redirect_uri_mismatch';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'redirect URL is not registered',
      );
    });

    it('maps application_suspended to suspended message', async () => {
      const { handleOAuthCallback } = await setup();
      const url = 'chatml://oauth/callback?error=application_suspended';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'application has been suspended',
      );
    });

    it('maps incorrect_client_credentials to contact support', async () => {
      const { handleOAuthCallback } = await setup();
      const url = 'chatml://oauth/callback?error=incorrect_client_credentials';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'Please contact support',
      );
    });

    it('uses error_description for unknown errors when provided', async () => {
      const { handleOAuthCallback } = await setup();
      const url = 'chatml://oauth/callback?error=unknown_error&error_description=Something+went+wrong';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'Something went wrong',
      );
    });

    it('uses generic message for unknown errors without description', async () => {
      const { handleOAuthCallback } = await setup();
      const url = 'chatml://oauth/callback?error=unknown_error';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'GitHub authorization failed: unknown_error',
      );
    });
  });

  // =========================================================
  // isOAuthPending / cancelOAuthFlow
  // =========================================================
  describe('isOAuthPending', () => {
    it('returns false initially (no pending state)', async () => {
      const { isOAuthPending } = await setup();
      expect(isOAuthPending()).toBe(false);
    });

    it('returns true after startOAuthFlow', async () => {
      const { isOAuthPending, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();
      expect(isOAuthPending()).toBe(true);
      openSpy.mockRestore();
    });

    it('returns true when sessionStorage has state on module load', async () => {
      const { isOAuthPending } = await setupWithSessionState(
        'restored-state',
        'restored-verifier',
      );
      expect(isOAuthPending()).toBe(true);
    });
  });

  describe('cancelOAuthFlow', () => {
    it('clears pending state and sessionStorage', async () => {
      const { isOAuthPending, cancelOAuthFlow, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();
      expect(isOAuthPending()).toBe(true);
      expect(sessionStorage.getItem('oauth_state')).not.toBeNull();
      expect(sessionStorage.getItem('oauth_code_verifier')).not.toBeNull();

      cancelOAuthFlow();
      expect(isOAuthPending()).toBe(false);
      expect(sessionStorage.getItem('oauth_state')).toBeNull();
      expect(sessionStorage.getItem('oauth_code_verifier')).toBeNull();

      openSpy.mockRestore();
    });
  });

  // =========================================================
  // startOAuthFlow
  // =========================================================
  describe('startOAuthFlow', () => {
    it('generates PKCE state and verifier', async () => {
      const { startOAuthFlow, mockGenerateRandomString } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();

      // generateRandomString is called twice: once for state, once for verifier
      expect(mockGenerateRandomString).toHaveBeenCalledTimes(2);
      expect(mockGenerateRandomString).toHaveBeenCalledWith(32);

      openSpy.mockRestore();
    });

    it('stores state and verifier in sessionStorage', async () => {
      const { startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();

      expect(sessionStorage.getItem('oauth_state')).toBe('mock-random-string');
      expect(sessionStorage.getItem('oauth_code_verifier')).toBe('mock-random-string');

      openSpy.mockRestore();
    });

    it('opens correct GitHub auth URL with proper params in non-Tauri', async () => {
      const { startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();

      expect(openSpy).toHaveBeenCalledOnce();
      const url = new URL(openSpy.mock.calls[0][0] as string);

      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('redirect_uri')).toBe('chatml://oauth/callback');
      expect(url.searchParams.get('scope')).toBe('repo,read:user');
      expect(url.searchParams.get('state')).toBe('mock-random-string');
      expect(url.searchParams.get('code_challenge')).toBe('mock-challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(openSpy.mock.calls[0][1]).toBe('_blank');

      openSpy.mockRestore();
    });

    it('calls generateCodeChallenge with the verifier', async () => {
      const { startOAuthFlow, mockGenerateCodeChallenge } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();

      expect(mockGenerateCodeChallenge).toHaveBeenCalledWith('mock-random-string');

      openSpy.mockRestore();
    });

    it('in Tauri env: calls shell.open instead of window.open', async () => {
      const { startOAuthFlow, mockIsTauri } = await setup();
      mockIsTauri.mockReturnValue(true);

      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      // The mock for @tauri-apps/plugin-shell is already set up by vitest.config.ts alias
      const shellMod = await import('@tauri-apps/plugin-shell');
      const shellOpen = vi.mocked(shellMod.open);
      shellOpen.mockClear();

      await startOAuthFlow();

      expect(openSpy).not.toHaveBeenCalled();
      expect(shellOpen).toHaveBeenCalledOnce();

      // Verify the URL structure
      const authUrl = shellOpen.mock.calls[0][0];
      expect(authUrl).toContain('https://github.com/login/oauth/authorize');
      expect(authUrl).toContain('code_challenge=mock-challenge');

      openSpy.mockRestore();
    });
  });

  // =========================================================
  // handleOAuthCallback
  // =========================================================
  describe('handleOAuthCallback', () => {
    it('exchanges code for token successfully', async () => {
      const { handleOAuthCallback, startOAuthFlow, isOAuthPending } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();

      const state = sessionStorage.getItem('oauth_state')!;

      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          expect(body.code).toBe('test-code');
          expect(body.code_verifier).toBe('mock-random-string');
          return HttpResponse.json({ token: 'gh-token-123', user: mockUser });
        }),
      );

      const result = await handleOAuthCallback(
        `chatml://oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
      );

      expect(result.token).toBe('gh-token-123');
      expect(result.user).toEqual(mockUser);
      // State should be cleared after success
      expect(isOAuthPending()).toBe(false);
      expect(sessionStorage.getItem('oauth_state')).toBeNull();
      expect(sessionStorage.getItem('oauth_code_verifier')).toBeNull();

      openSpy.mockRestore();
    });

    it('throws on GitHub error response (access_denied)', async () => {
      const { handleOAuthCallback, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();

      const url = 'chatml://oauth/callback?error=access_denied&error_description=User+denied+access';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'You declined to authorize ChatML',
      );

      openSpy.mockRestore();
    });

    it('throws on missing authorization code', async () => {
      const { handleOAuthCallback, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();

      const state = sessionStorage.getItem('oauth_state')!;
      const url = `chatml://oauth/callback?state=${encodeURIComponent(state)}`;
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'No authorization code received from GitHub',
      );

      openSpy.mockRestore();
    });

    it('throws on state mismatch (CRITICAL SECURITY)', async () => {
      const { handleOAuthCallback, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();

      const url = 'chatml://oauth/callback?code=test-code&state=wrong-state-value';
      await expect(handleOAuthCallback(url)).rejects.toThrow(
        'Security error: state mismatch',
      );

      openSpy.mockRestore();
    });

    it('validates state against sessionStorage when module state lost', async () => {
      // Simulate module reload: set sessionStorage, then import fresh module.
      // The module reads from sessionStorage on load.
      const { handleOAuthCallback } = await setupWithSessionState(
        'stored-state-value',
        'stored-verifier-value',
      );

      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          expect(body.code_verifier).toBe('stored-verifier-value');
          return HttpResponse.json({ token: 'gh-token', user: mockUser });
        }),
      );

      const result = await handleOAuthCallback(
        'chatml://oauth/callback?code=test-code&state=stored-state-value',
      );
      expect(result.token).toBe('gh-token');
    });

    it('clears state after successful exchange', async () => {
      const { handleOAuthCallback, startOAuthFlow, isOAuthPending } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();
      const state = sessionStorage.getItem('oauth_state')!;

      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, () => {
          return HttpResponse.json({ token: 'tok', user: mockUser });
        }),
      );

      await handleOAuthCallback(
        `chatml://oauth/callback?code=c&state=${encodeURIComponent(state)}`,
      );

      expect(isOAuthPending()).toBe(false);
      expect(sessionStorage.getItem('oauth_state')).toBeNull();
      expect(sessionStorage.getItem('oauth_code_verifier')).toBeNull();

      openSpy.mockRestore();
    });

    it('sends code_verifier in the exchange request', async () => {
      const { handleOAuthCallback, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();
      const state = sessionStorage.getItem('oauth_state')!;

      let capturedVerifier: unknown;
      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          capturedVerifier = body.code_verifier;
          return HttpResponse.json({ token: 'tok', user: mockUser });
        }),
      );

      await handleOAuthCallback(
        `chatml://oauth/callback?code=c&state=${encodeURIComponent(state)}`,
      );

      expect(capturedVerifier).toBe('mock-random-string');

      openSpy.mockRestore();
    });

    it('throws when backend exchange returns non-OK', async () => {
      const { handleOAuthCallback, startOAuthFlow } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();
      const state = sessionStorage.getItem('oauth_state')!;

      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, () => {
          return new HttpResponse('Bad Request', { status: 400 });
        }),
      );

      await expect(
        handleOAuthCallback(
          `chatml://oauth/callback?code=c&state=${encodeURIComponent(state)}`,
        ),
      ).rejects.toThrow('Failed to complete authentication');

      openSpy.mockRestore();
    });
  });

  // =========================================================
  // Token storage: storeToken / loadToken / clearToken
  // =========================================================
  describe('storeToken / loadToken / clearToken', () => {
    describe('non-Tauri (localStorage)', () => {
      it('storeToken saves to localStorage', async () => {
        const { storeToken } = await setup();
        await storeToken('my-token');
        expect(localStorage.getItem('github_token')).toBe('my-token');
      });

      it('loadToken reads from localStorage', async () => {
        const { loadToken } = await setup();
        localStorage.setItem('github_token', 'stored-token');
        const token = await loadToken();
        expect(token).toBe('stored-token');
      });

      it('loadToken returns null when no token', async () => {
        const { loadToken } = await setup();
        const token = await loadToken();
        expect(token).toBeNull();
      });

      it('clearToken removes from localStorage', async () => {
        const { clearToken } = await setup();
        localStorage.setItem('github_token', 'to-clear');
        await clearToken();
        expect(localStorage.getItem('github_token')).toBeNull();
      });
    });

    describe('Tauri (Stronghold with localStorage fallback)', () => {
      it('storeToken falls back to localStorage when Stronghold is unavailable', async () => {
        const { storeToken, mockIsTauri } = await setup();
        mockIsTauri.mockReturnValue(true);

        // In tests, the Stronghold mock doesn't fully implement
        // getStrongholdStore (appDataDir is missing), so storeToken
        // falls back to localStorage.
        await storeToken('stronghold-token');

        expect(localStorage.getItem('github_token')).toBe('stronghold-token');
      });

      it('clearToken clears both localStorage and attempts Stronghold', async () => {
        const { clearToken, mockIsTauri } = await setup();
        mockIsTauri.mockReturnValue(true);
        localStorage.setItem('github_token', 'legacy');

        await clearToken();
        expect(localStorage.getItem('github_token')).toBeNull();
      });
    });
  });

  // =========================================================
  // sendTokenToBackend
  // =========================================================
  describe('sendTokenToBackend', () => {
    it('sends token with POST and returns user info', async () => {
      const { sendTokenToBackend } = await setup();

      server.use(
        http.post(`${API_BASE}/api/auth/token`, async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          expect(body.token).toBe('my-token');
          return HttpResponse.json({ user: mockUser });
        }),
      );

      const result = await sendTokenToBackend('my-token');
      expect(result).toEqual({ user: mockUser });
    });

    it('returns null on non-OK response', async () => {
      const { sendTokenToBackend } = await setup();

      server.use(
        http.post(`${API_BASE}/api/auth/token`, () => {
          return new HttpResponse('Unauthorized', { status: 401 });
        }),
      );

      const result = await sendTokenToBackend('bad-token');
      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      const { sendTokenToBackend } = await setup();

      server.use(
        http.post(`${API_BASE}/api/auth/token`, () => {
          return HttpResponse.error();
        }),
      );

      const result = await sendTokenToBackend('any-token');
      expect(result).toBeNull();
    });
  });

  // =========================================================
  // getAuthStatus
  // =========================================================
  describe('getAuthStatus', () => {
    it('returns auth status from backend', async () => {
      const { getAuthStatus } = await setup();

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.json({ authenticated: true, user: mockUser });
        }),
      );

      const status = await getAuthStatus();
      expect(status.authenticated).toBe(true);
      expect(status.user).toEqual(mockUser);
    });

    it('returns unauthenticated status', async () => {
      const { getAuthStatus } = await setup();

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.json({ authenticated: false });
        }),
      );

      const status = await getAuthStatus();
      expect(status.authenticated).toBe(false);
    });
  });

  // =========================================================
  // logout
  // =========================================================
  describe('logout', () => {
    it('clears token and calls backend logout', async () => {
      const { logout } = await setup();
      localStorage.setItem('github_token', 'tok');

      let logoutCalled = false;
      server.use(
        http.post(`${API_BASE}/api/auth/logout`, () => {
          logoutCalled = true;
          return HttpResponse.json({});
        }),
      );

      await logout();
      expect(localStorage.getItem('github_token')).toBeNull();
      expect(logoutCalled).toBe(true);
    });
  });

  // =========================================================
  // initAuth
  // =========================================================
  describe('initAuth', () => {
    it('returns authenticated:false when no token', async () => {
      const { initAuth } = await setup();

      const status = await initAuth();
      expect(status).toEqual({ authenticated: false });
    });

    it('returns authenticated:true when token exists in localStorage', async () => {
      const { initAuth } = await setup();
      localStorage.setItem('github_token', 'existing-token');

      const status = await initAuth();
      expect(status).toEqual({ authenticated: true });
    });
  });

  // =========================================================
  // validateStoredToken
  // =========================================================
  describe('validateStoredToken', () => {
    it('returns user from backend if already authenticated', async () => {
      const { validateStoredToken } = await setup();

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.json({ authenticated: true, user: mockUser });
        }),
      );

      const user = await validateStoredToken();
      expect(user).toEqual(mockUser);
    });

    it('falls back to stored token if backend not authenticated', async () => {
      const { validateStoredToken } = await setup();
      localStorage.setItem('github_token', 'stored-token');

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.json({ authenticated: false });
        }),
        http.post(`${API_BASE}/api/auth/token`, () => {
          return HttpResponse.json({ user: mockUser });
        }),
      );

      const user = await validateStoredToken();
      expect(user).toEqual(mockUser);
    });

    it('clears token if validation fails', async () => {
      const { validateStoredToken } = await setup();
      localStorage.setItem('github_token', 'invalid-token');

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.json({ authenticated: false });
        }),
        http.post(`${API_BASE}/api/auth/token`, () => {
          return new HttpResponse('Unauthorized', { status: 401 });
        }),
      );

      const user = await validateStoredToken();
      expect(user).toBeNull();
      expect(localStorage.getItem('github_token')).toBeNull();
    });

    it('returns null if no token stored', async () => {
      const { validateStoredToken } = await setup();

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.json({ authenticated: false });
        }),
      );

      const user = await validateStoredToken();
      expect(user).toBeNull();
    });

    it('falls back to token path when getAuthStatus throws', async () => {
      const { validateStoredToken } = await setup();
      localStorage.setItem('github_token', 'my-token');

      server.use(
        http.get(`${API_BASE}/api/auth/status`, () => {
          return HttpResponse.error();
        }),
        http.post(`${API_BASE}/api/auth/token`, () => {
          return HttpResponse.json({ user: mockUser });
        }),
      );

      const user = await validateStoredToken();
      expect(user).toEqual(mockUser);
    });
  });

  // =========================================================
  // listenForOAuthCallback
  // =========================================================
  describe('listenForOAuthCallback', () => {
    it('sets up Tauri event listener via safeListen', async () => {
      const { listenForOAuthCallback, mockSafeListen } = await setup();

      const githubCb = vi.fn();
      const githubErr = vi.fn();
      await listenForOAuthCallback(githubCb, githubErr);

      expect(mockSafeListen).toHaveBeenCalledWith(
        'oauth-callback',
        expect.any(Function),
      );
    });

    it('sets up DOM custom event listener', async () => {
      const { listenForOAuthCallback } = await setup();
      const addSpy = vi.spyOn(window, 'addEventListener');

      const githubCb = vi.fn();
      const githubErr = vi.fn();
      await listenForOAuthCallback(githubCb, githubErr);

      const domListenerCalls = addSpy.mock.calls.filter(
        (c) => c[0] === 'tauri-oauth-callback',
      );
      expect(domListenerCalls.length).toBe(1);

      addSpy.mockRestore();
    });

    it('sets up focus poll listener', async () => {
      const { listenForOAuthCallback } = await setup();
      const addSpy = vi.spyOn(window, 'addEventListener');

      const githubCb = vi.fn();
      const githubErr = vi.fn();
      await listenForOAuthCallback(githubCb, githubErr);

      const focusListenerCalls = addSpy.mock.calls.filter(
        (c) => c[0] === 'focus',
      );
      expect(focusListenerCalls.length).toBe(1);

      addSpy.mockRestore();
    });

    it('returns cleanup function that removes all listeners', async () => {
      const { listenForOAuthCallback, mockSafeListen } = await setup();
      const unlistenTauri = vi.fn();
      mockSafeListen.mockResolvedValue(unlistenTauri);

      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const cleanup = await listenForOAuthCallback(vi.fn(), vi.fn());
      cleanup();

      expect(unlistenTauri).toHaveBeenCalled();

      const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedEvents).toContain('tauri-oauth-callback');
      expect(removedEvents).toContain('focus');

      removeSpy.mockRestore();
    });

    it('routes GitHub callbacks to github handler', async () => {
      const { listenForOAuthCallback, startOAuthFlow, mockSafeListen } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      await startOAuthFlow();
      const state = sessionStorage.getItem('oauth_state')!;

      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, () => {
          return HttpResponse.json({ token: 'tok', user: mockUser });
        }),
      );

      // Capture the event handler
      let tauriHandler: ((url: string) => Promise<void>) | undefined;
      mockSafeListen.mockImplementation(async (_event, handler) => {
        tauriHandler = handler as (url: string) => Promise<void>;
        return vi.fn();
      });

      const githubCb = vi.fn();
      const githubErr = vi.fn();
      await listenForOAuthCallback(githubCb, githubErr);

      // Simulate Tauri event with GitHub callback
      await tauriHandler!(
        `chatml://oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
      );

      expect(githubCb).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'tok', user: mockUser }),
      );

      openSpy.mockRestore();
    });

    it('routes Linear callbacks to linear handler', async () => {
      const { listenForOAuthCallback, mockSafeListen, mockHandleLinearOAuthCallback } = await setup();

      const linearUser = { id: 'l1', name: 'Lin', email: 'l@example.com', displayName: 'Lin', avatarUrl: '' };
      mockHandleLinearOAuthCallback.mockResolvedValue({ user: linearUser });

      let tauriHandler: ((url: string) => Promise<void>) | undefined;
      mockSafeListen.mockImplementation(async (_event, handler) => {
        tauriHandler = handler as (url: string) => Promise<void>;
        return vi.fn();
      });

      const githubCb = vi.fn();
      const githubErr = vi.fn();
      const linearCb = vi.fn();
      const linearErr = vi.fn();
      await listenForOAuthCallback(githubCb, githubErr, linearCb, linearErr);

      // Simulate Tauri event with Linear callback (state starts with "linear:")
      await tauriHandler!(
        'chatml://oauth/callback?code=lin-code&state=linear:some-state',
      );

      expect(linearCb).toHaveBeenCalledWith({ user: linearUser });
      expect(githubCb).not.toHaveBeenCalled();
    });

    it('deduplicates callbacks (processed flag)', async () => {
      const { listenForOAuthCallback, startOAuthFlow, mockSafeListen } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await startOAuthFlow();
      const state = sessionStorage.getItem('oauth_state')!;

      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, () => {
          return HttpResponse.json({ token: 'tok', user: mockUser });
        }),
      );

      let tauriHandler: ((url: string) => Promise<void>) | undefined;
      mockSafeListen.mockImplementation(async (_event, handler) => {
        tauriHandler = handler as (url: string) => Promise<void>;
        return vi.fn();
      });

      const githubCb = vi.fn();
      await listenForOAuthCallback(githubCb, vi.fn());

      const url = `chatml://oauth/callback?code=test-code&state=${encodeURIComponent(state)}`;
      await tauriHandler!(url);
      await tauriHandler!(url); // Second call should be skipped

      expect(githubCb).toHaveBeenCalledTimes(1);

      openSpy.mockRestore();
    });

    it('retries on error (resets processed flag)', async () => {
      const { listenForOAuthCallback, startOAuthFlow, mockSafeListen, mockGenerateRandomString } = await setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      // First flow
      await startOAuthFlow();
      const state1 = sessionStorage.getItem('oauth_state')!;

      let callCount = 0;
      server.use(
        http.post(`${API_BASE}/api/auth/github/callback`, () => {
          callCount++;
          if (callCount === 1) {
            return new HttpResponse('Server Error', { status: 500 });
          }
          return HttpResponse.json({ token: 'tok', user: mockUser });
        }),
      );

      let tauriHandler: ((url: string) => Promise<void>) | undefined;
      mockSafeListen.mockImplementation(async (_event, handler) => {
        tauriHandler = handler as (url: string) => Promise<void>;
        return vi.fn();
      });

      const githubCb = vi.fn();
      const githubErr = vi.fn();
      await listenForOAuthCallback(githubCb, githubErr);

      // First attempt: will fail (state is cleared by handleOAuthCallback on error-free path,
      // but this path has a state match then a backend 500)
      const url1 = `chatml://oauth/callback?code=c&state=${encodeURIComponent(state1)}`;
      await tauriHandler!(url1);

      // Error callback should have been called
      expect(githubErr).toHaveBeenCalledTimes(1);
      expect(githubCb).not.toHaveBeenCalled();

      // Start a new flow for retry (state was consumed)
      mockGenerateRandomString.mockReturnValue('retry-random-string');
      await startOAuthFlow();
      const state2 = sessionStorage.getItem('oauth_state')!;

      // Second attempt: should succeed because processed was reset on error
      const url2 = `chatml://oauth/callback?code=c2&state=${encodeURIComponent(state2)}`;
      await tauriHandler!(url2);

      expect(githubCb).toHaveBeenCalledTimes(1);

      openSpy.mockRestore();
    });
  });

  // =========================================================
  // OAUTH_TIMEOUT_MS export
  // =========================================================
  describe('OAUTH_TIMEOUT_MS', () => {
    it('is 120000 (2 minutes)', async () => {
      const { OAUTH_TIMEOUT_MS } = await setup();
      expect(OAUTH_TIMEOUT_MS).toBe(120000);
    });
  });
});
