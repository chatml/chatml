import { type ReactNode } from 'react';
import { create } from 'zustand';

// Default toolbar background - regular dark background
export const DEFAULT_TOOLBAR_BG = '';

export type ToolbarId = 'left' | 'center' | 'right';

interface ToolbarBackgrounds {
  left: string;
  center: string;
  right: string;
}

/** Shared slot layout for toolbar rows (leading | title | spacer | actions) */
export interface ToolbarSlots {
  /** Widget on the far left (e.g. back button, icon) */
  leading?: ReactNode;
  /** Primary content — rendered according to titlePosition */
  title?: ReactNode;
  /** Where to place the title: 'left' (default) or 'center' */
  titlePosition?: 'left' | 'center';
  /** Widgets on the right side */
  actions?: ReactNode;
}

/** Flutter AppBar-style toolbar configuration */
export interface ToolbarConfig extends ToolbarSlots {
  /** Action bar below the main toolbar — same slot layout */
  bottom?: ToolbarSlots;
}

interface UIState {
  // Toolbar backgrounds
  toolbarBackgrounds: ToolbarBackgrounds;

  // Dynamic toolbar configuration (Flutter AppBar-style)
  toolbarConfig: ToolbarConfig | null;

  // Per-tab cached rich titles (ReactNode) for the tab strip
  tabTitles: Record<string, ReactNode>;

  // Actions
  setToolbarBackground: (toolbar: ToolbarId, className: string) => void;
  setAllToolbarBackgrounds: (className: string) => void;
  resetToolbarBackgrounds: () => void;
  setToolbarConfig: (config: ToolbarConfig | null) => void;
  setTabTitle: (tabId: string, title: ReactNode) => void;
  removeTabTitle: (tabId: string) => void;
}

const defaultBackgrounds: ToolbarBackgrounds = {
  left: DEFAULT_TOOLBAR_BG,
  center: DEFAULT_TOOLBAR_BG,
  right: DEFAULT_TOOLBAR_BG,
};

export const useUIStore = create<UIState>()((set) => ({
  toolbarBackgrounds: { ...defaultBackgrounds },
  toolbarConfig: null,
  tabTitles: {},

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

  setToolbarConfig: (config) => set({ toolbarConfig: config }),

  setTabTitle: (tabId, title) =>
    set((state) => ({
      tabTitles: { ...state.tabTitles, [tabId]: title },
    })),

  removeTabTitle: (tabId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [tabId]: _removed, ...rest } = state.tabTitles;
      return { tabTitles: rest };
    }),

}));
