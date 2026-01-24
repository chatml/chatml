import { create } from 'zustand';

// Default toolbar background - regular dark background
export const DEFAULT_TOOLBAR_BG = '';

export type ToolbarId = 'left' | 'center' | 'right';

interface ToolbarBackgrounds {
  left: string;
  center: string;
  right: string;
}

interface UIState {
  // Toolbar backgrounds
  toolbarBackgrounds: ToolbarBackgrounds;

  // Actions
  setToolbarBackground: (toolbar: ToolbarId, className: string) => void;
  setAllToolbarBackgrounds: (className: string) => void;
  resetToolbarBackgrounds: () => void;
}

const defaultBackgrounds: ToolbarBackgrounds = {
  left: DEFAULT_TOOLBAR_BG,
  center: DEFAULT_TOOLBAR_BG,
  right: DEFAULT_TOOLBAR_BG,
};

export const useUIStore = create<UIState>()((set) => ({
  toolbarBackgrounds: { ...defaultBackgrounds },

  setToolbarBackground: (toolbar, className) =>
    set((state) => ({
      toolbarBackgrounds: {
        ...state.toolbarBackgrounds,
        [toolbar]: className,
      },
    })),

  setAllToolbarBackgrounds: (className) =>
    set(() => ({
      toolbarBackgrounds: {
        left: className,
        center: className,
        right: className,
      },
    })),

  resetToolbarBackgrounds: () =>
    set(() => ({
      toolbarBackgrounds: { ...defaultBackgrounds },
    })),
}));
