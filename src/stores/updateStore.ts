import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number;
  error: string | null;

  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
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
    if (!isTauri()) return;

    const { status } = get();
    if (status === 'checking' || status === 'downloading') return;

    try {
      set({ status: 'checking', error: null });
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();

      if (result) {
        pendingUpdate = result;
        set({ status: 'available', version: result.version });
      } else {
        pendingUpdate = null;
        set({ status: 'idle', version: null });
      }
    } catch (err) {
      console.error('Update check failed:', err);
      // Silently return to idle on check failure — not actionable for users
      set({ status: 'idle' });
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
}));
