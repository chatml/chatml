import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'waiting' | 'error';

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number;
  error: string | null;

  checkForUpdates: () => Promise<'up-to-date' | 'available' | null>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
  waitForAgents: () => void;
  cancelWait: () => void;
}

// Hold the Update object outside of Zustand state (not serializable)
let pendingUpdate: Update | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: 'idle',
  version: null,
  progress: 0,
  error: null,

  checkForUpdates: async () => {
    if (!isTauri()) return null;

    const { status } = get();
    if (status === 'checking' || status === 'downloading' || status === 'waiting') return null;

    try {
      set({ status: 'checking', error: null });
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();

      if (result) {
        pendingUpdate = result;
        set({ status: 'available', version: result.version });
        return 'available';
      } else {
        pendingUpdate = null;
        set({ status: 'idle', version: null });
        return 'up-to-date';
      }
    } catch (err) {
      console.debug('Update check failed:', err);
      // Silently return to idle on check failure — not actionable for users
      set({ status: 'idle' });
      return null;
    }
  },

  downloadAndInstall: async () => {
    if (!pendingUpdate) return;

    try {
      set({ status: 'downloading', progress: 0, error: null });

      let contentLength = 0;
      let downloaded = 0;

      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = (event.data as { contentLength?: number }).contentLength || 0;
            downloaded = 0;
            set({ progress: 0 });
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              set({ progress: Math.min((downloaded / contentLength) * 100, 99) });
            }
            break;
          case 'Finished':
            set({ progress: 100 });
            break;
        }
      });

      set({ status: 'ready' });
    } catch (err) {
      console.error('Update download failed:', err);
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Download failed',
      });
    }
  },

  relaunch: async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },

  waitForAgents: () => {
    const { status } = get();
    if (status === 'ready') {
      set({ status: 'waiting' });
    }
  },

  cancelWait: () => {
    const { status } = get();
    if (status === 'waiting') {
      set({ status: 'ready' });
    }
  },
}));
