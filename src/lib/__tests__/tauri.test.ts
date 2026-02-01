import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// We test the actual module functions — the Tauri APIs are auto-mocked by vitest aliases
import {
  startFileWatcher,
  stopFileWatcher,
  registerSession,
  unregisterSession,
  listenForFileChanges,
  isTauri,
} from '../tauri';

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

function enableTauri() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = {};
}

function disableTauri() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__;
}

describe('tauri watcher functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disableTauri();
  });

  afterEach(() => {
    disableTauri();
  });

  // ============================================
  // isTauri
  // ============================================

  describe('isTauri', () => {
    it('returns false when __TAURI_INTERNALS__ is not set', () => {
      expect(isTauri()).toBe(false);
    });

    it('returns true when __TAURI_INTERNALS__ is set', () => {
      enableTauri();
      expect(isTauri()).toBe(true);
    });
  });

  // ============================================
  // startFileWatcher
  // ============================================

  describe('startFileWatcher', () => {
    it('invokes start_file_watcher with basePath and createIfNeeded', async () => {
      enableTauri();
      mockedInvoke.mockResolvedValueOnce(undefined);

      const result = await startFileWatcher('/base/path', true);

      expect(mockedInvoke).toHaveBeenCalledWith('start_file_watcher', { basePath: '/base/path', createIfNeeded: true });
      expect(result).toBe(true);
    });

    it('returns false when not in Tauri', async () => {
      const result = await startFileWatcher('/base/path');

      expect(mockedInvoke).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('returns false on invoke error', async () => {
      enableTauri();
      mockedInvoke.mockRejectedValueOnce(new Error('watcher failed'));

      const result = await startFileWatcher('/base/path');

      expect(result).toBe(false);
    });
  });

  // ============================================
  // stopFileWatcher
  // ============================================

  describe('stopFileWatcher', () => {
    it('invokes stop_file_watcher', async () => {
      enableTauri();
      mockedInvoke.mockResolvedValueOnce(undefined);

      await stopFileWatcher();

      expect(mockedInvoke).toHaveBeenCalledWith('stop_file_watcher');
    });

    it('no-op when not in Tauri', async () => {
      await stopFileWatcher();

      expect(mockedInvoke).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // registerSession
  // ============================================

  describe('registerSession', () => {
    it('invokes register_session with correct args', async () => {
      enableTauri();
      mockedInvoke.mockResolvedValueOnce(undefined);

      await registerSession('session-dir', 'workspace-1');

      expect(mockedInvoke).toHaveBeenCalledWith('register_session', {
        sessionDirName: 'session-dir',
        workspaceId: 'workspace-1',
      });
    });

    it('no-op when not in Tauri', async () => {
      await registerSession('session-dir', 'workspace-1');

      expect(mockedInvoke).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // unregisterSession
  // ============================================

  describe('unregisterSession', () => {
    it('invokes unregister_session with correct args', async () => {
      enableTauri();
      mockedInvoke.mockResolvedValueOnce(undefined);

      await unregisterSession('session-dir');

      expect(mockedInvoke).toHaveBeenCalledWith('unregister_session', {
        sessionDirName: 'session-dir',
      });
    });

    it('no-op when not in Tauri', async () => {
      await unregisterSession('session-dir');

      expect(mockedInvoke).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // listenForFileChanges
  // ============================================

  describe('listenForFileChanges', () => {
    it('registers a Tauri event listener when in Tauri', async () => {
      enableTauri();
      const mockUnlisten = vi.fn();
      mockedListen.mockResolvedValueOnce(mockUnlisten);

      const handler = vi.fn();
      const unlisten = await listenForFileChanges(handler);

      expect(mockedListen).toHaveBeenCalledWith('file-changed', expect.any(Function));
      expect(unlisten).toBe(mockUnlisten);
    });

    it('returns no-op when not in Tauri', async () => {
      const handler = vi.fn();
      const unlisten = await listenForFileChanges(handler);

      expect(mockedListen).not.toHaveBeenCalled();
      // Should return a no-op function
      expect(typeof unlisten).toBe('function');
      unlisten(); // Should not throw
    });
  });
});
