import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  // Chat settings
  confirmCloseActiveTab: boolean;
  defaultModel: string;
  defaultThinking: boolean;
  desktopNotifications: boolean;
  soundEffects: boolean;
  sendWithEnter: boolean;

  // Actions
  setConfirmCloseActiveTab: (value: boolean) => void;
  setDefaultModel: (value: string) => void;
  setDefaultThinking: (value: boolean) => void;
  setDesktopNotifications: (value: boolean) => void;
  setSoundEffects: (value: boolean) => void;
  setSendWithEnter: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      confirmCloseActiveTab: true,
      defaultModel: 'opus-4.5',
      defaultThinking: true,
      desktopNotifications: true,
      soundEffects: false,
      sendWithEnter: true,

      // Actions
      setConfirmCloseActiveTab: (value) => set({ confirmCloseActiveTab: value }),
      setDefaultModel: (value) => set({ defaultModel: value }),
      setDefaultThinking: (value) => set({ defaultThinking: value }),
      setDesktopNotifications: (value) => set({ desktopNotifications: value }),
      setSoundEffects: (value) => set({ soundEffects: value }),
      setSendWithEnter: (value) => set({ sendWithEnter: value }),
    }),
    {
      name: 'chatml-settings',
    }
  )
);
