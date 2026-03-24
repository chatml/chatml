import { describe, it, expect, vi, afterEach } from 'vitest';

// The store checks for __TAURI_INTERNALS__ in window
const win = window as Window & { __TAURI_INTERNALS__?: unknown };

describe('updateStore', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  /** Create a fake update object matching the shape returned by the updater plugin. */
  function makeFakeUpdate(overrides: { version?: string; downloadAndInstall?: ReturnType<typeof vi.fn> } = {}) {
    return {
      version: overrides.version ?? '2.0.0',
      downloadAndInstall: overrides.downloadAndInstall ?? vi.fn(),
    };
  }

  // Get fresh store + fresh mocks after each resetModules
  async function setup() {
    vi.resetModules();
    win.__TAURI_INTERNALS__ = {};
    const updaterMod = await import('@tauri-apps/plugin-updater');
    const processMod = await import('@tauri-apps/plugin-process');
    const { useUpdateStore } = await import('../updateStore');
    return {
      store: useUpdateStore,
      mockCheck: vi.mocked(updaterMod.check),
      mockRelaunch: vi.mocked(processMod.relaunch),
    };
  }

  describe('checkForUpdates', () => {
    it('auto-downloads when update found', async () => {
      const { store, mockCheck } = await setup();
      const fakeUpdate = makeFakeUpdate();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCheck.mockResolvedValueOnce(fakeUpdate as any);

      await store.getState().checkForUpdates();
      // Wait for the fire-and-forget downloadAndInstall to settle
      await vi.waitFor(() => expect(store.getState().status).toBe('ready'));

      expect(store.getState().version).toBe('2.0.0');
      expect(fakeUpdate.downloadAndInstall).toHaveBeenCalled();
    });

    it('resets to idle when no update available', async () => {
      const { store, mockCheck } = await setup();
      mockCheck.mockResolvedValueOnce(null);

      await store.getState().checkForUpdates();

      expect(store.getState().status).toBe('idle');
      expect(store.getState().version).toBeNull();
    });

    it('returns to idle on check error', async () => {
      const { store, mockCheck } = await setup();
      mockCheck.mockRejectedValueOnce(new Error('network'));
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      await store.getState().checkForUpdates();

      expect(store.getState().status).toBe('idle');
      debugSpy.mockRestore();
    });

    it('prevents concurrent check calls', async () => {
      const { store, mockCheck } = await setup();
      store.setState({ status: 'checking' });

      await store.getState().checkForUpdates();

      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('prevents check during download', async () => {
      const { store, mockCheck } = await setup();
      store.setState({ status: 'downloading' });

      await store.getState().checkForUpdates();

      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('clears error when starting new check', async () => {
      const { store, mockCheck } = await setup();
      store.setState({ status: 'error', error: 'old error' });
      mockCheck.mockResolvedValueOnce(null);

      await store.getState().checkForUpdates();

      expect(store.getState().error).toBeNull();
    });
  });

  describe('downloadAndInstall', () => {
    it('does nothing if no pending update', async () => {
      const { store } = await setup();
      await store.getState().downloadAndInstall();
      expect(store.getState().status).toBe('idle');
    });

    it('tracks download progress events', async () => {
      const { store, mockCheck } = await setup();

      const mockDownload = vi.fn(async (callback: (event: { event: string; data: Record<string, unknown> }) => void) => {
        callback({ event: 'Started', data: { contentLength: 1000 } });
        callback({ event: 'Progress', data: { chunkLength: 500 } });
        callback({ event: 'Progress', data: { chunkLength: 500 } });
        callback({ event: 'Finished', data: {} });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCheck.mockResolvedValueOnce(makeFakeUpdate({ downloadAndInstall: mockDownload }) as any);

      await store.getState().checkForUpdates();
      await store.getState().downloadAndInstall();

      expect(store.getState().status).toBe('ready');
      expect(store.getState().progress).toBe(100);
    });

    it('sets error state on download failure', async () => {
      const { store, mockCheck } = await setup();

      const mockDownload = vi.fn().mockRejectedValue(new Error('download failed'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCheck.mockResolvedValueOnce(makeFakeUpdate({ downloadAndInstall: mockDownload }) as any);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await store.getState().checkForUpdates();
      await store.getState().downloadAndInstall();

      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toBe('download failed');
      errorSpy.mockRestore();
    });

    it('sets generic error message for non-Error throws', async () => {
      const { store, mockCheck } = await setup();

      const mockDownload = vi.fn().mockRejectedValue('string error');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCheck.mockResolvedValueOnce(makeFakeUpdate({ downloadAndInstall: mockDownload }) as any);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await store.getState().checkForUpdates();
      await store.getState().downloadAndInstall();

      expect(store.getState().error).toBe('Download failed');
      errorSpy.mockRestore();
    });
  });

  describe('relaunch', () => {
    it('calls Tauri relaunch', async () => {
      const { store, mockRelaunch } = await setup();
      await store.getState().relaunch();
      expect(mockRelaunch).toHaveBeenCalled();
    });
  });
});
