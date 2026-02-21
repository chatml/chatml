import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The vitest setup defines window.__TAURI__ as writable but not configurable,
// so we use simple assignment to toggle Tauri environment.
const win = window as Window & { __TAURI__?: unknown };

describe('auth-token', () => {
  beforeEach(() => {
    vi.resetModules();
    win.__TAURI__ = undefined;
  });

  afterEach(() => {
    win.__TAURI__ = undefined;
  });

  // After resetModules, we need to get the mock invoke from the freshly imported module
  async function setup() {
    const tauriCore = await import('@tauri-apps/api/core');
    const authToken = await import('../auth-token');
    const mockInvoke = vi.mocked(tauriCore.invoke);
    return { ...authToken, mockInvoke };
  }

  describe('getAuthToken', () => {
    it('returns null when window is undefined', async () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - testing SSR case
      delete globalThis.window;
      try {
        const { getAuthToken } = await setup();
        const result = await getAuthToken();
        expect(result).toBeNull();
      } finally {
        globalThis.window = originalWindow;
      }
    });

    it('returns null when __TAURI__ is not present', async () => {
      const { getAuthToken, mockInvoke } = await setup();
      const result = await getAuthToken();
      expect(result).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('invokes get_auth_token when in Tauri environment', async () => {
      win.__TAURI__ = {};
      const { getAuthToken, mockInvoke } = await setup();
      mockInvoke.mockResolvedValue('test-token-123');

      const result = await getAuthToken();
      expect(result).toBe('test-token-123');
      expect(mockInvoke).toHaveBeenCalledWith('get_auth_token');
    });

    it('caches the token on subsequent calls', async () => {
      win.__TAURI__ = {};
      const { getAuthToken, mockInvoke } = await setup();
      mockInvoke.mockResolvedValue('cached-token');

      const first = await getAuthToken();
      const second = await getAuthToken();

      expect(first).toBe('cached-token');
      expect(second).toBe('cached-token');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('returns null and logs error when invoke fails', async () => {
      win.__TAURI__ = {};
      const { getAuthToken, mockInvoke } = await setup();
      mockInvoke.mockRejectedValue(new Error('IPC error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const result = await getAuthToken();
        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith('Failed to get auth token:', expect.any(Error));
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('getCachedAuthToken', () => {
    it('returns null before any token is fetched', async () => {
      const { getCachedAuthToken } = await setup();
      expect(getCachedAuthToken()).toBeNull();
    });

    it('returns the token after getAuthToken has been called', async () => {
      win.__TAURI__ = {};
      const { getAuthToken, getCachedAuthToken, mockInvoke } = await setup();
      mockInvoke.mockResolvedValue('my-token');

      await getAuthToken();
      expect(getCachedAuthToken()).toBe('my-token');
    });
  });

  describe('initAuthToken', () => {
    it('calls getAuthToken to prime the cache', async () => {
      win.__TAURI__ = {};
      const { initAuthToken, getCachedAuthToken, mockInvoke } = await setup();
      mockInvoke.mockResolvedValue('init-token');

      await initAuthToken();
      expect(getCachedAuthToken()).toBe('init-token');
    });
  });

  describe('clearAuthTokenCache', () => {
    it('clears the cached token', async () => {
      win.__TAURI__ = {};
      const { getAuthToken, getCachedAuthToken, clearAuthTokenCache, mockInvoke } = await setup();
      mockInvoke.mockResolvedValue('will-be-cleared');

      await getAuthToken();
      expect(getCachedAuthToken()).toBe('will-be-cleared');

      clearAuthTokenCache();
      expect(getCachedAuthToken()).toBeNull();
    });

    it('forces re-fetch on next getAuthToken call', async () => {
      win.__TAURI__ = {};
      const { getAuthToken, clearAuthTokenCache, mockInvoke } = await setup();
      mockInvoke
        .mockResolvedValueOnce('token-v1')
        .mockResolvedValueOnce('token-v2');

      const first = await getAuthToken();
      expect(first).toBe('token-v1');

      clearAuthTokenCache();
      const second = await getAuthToken();
      expect(second).toBe('token-v2');
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });
});
