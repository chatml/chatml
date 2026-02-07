import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DisclosureState {
  // Persisted: replaces the old uiMode toggle
  fullModeEnabled: boolean;
  setFullModeEnabled: (value: boolean) => void;
}

export const useDisclosureStore = create<DisclosureState>()(
  persist(
    (set) => ({
      fullModeEnabled: false,
      setFullModeEnabled: (value) => set({ fullModeEnabled: value }),
    }),
    {
      name: 'chatml-disclosure',
    }
  )
);
