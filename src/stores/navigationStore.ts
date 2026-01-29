import { create } from 'zustand';
import type { ContentView } from './settingsStore';

/** Snapshot of navigation state at a point in time */
export interface NavigationEntry {
  workspaceId: string | null;
  sessionId: string | null;
  conversationId: string | null;
  contentView: ContentView;
  timestamp: number;
  /** Display label for history popover (e.g., session name or dashboard type) */
  label: string;
}

/** Per-tab back/forward stacks */
interface TabHistory {
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
}

const MAX_HISTORY_SIZE = 50;
const DEFAULT_TAB_ID = 'default';

function emptyTabHistory(): TabHistory {
  return { backStack: [], forwardStack: [] };
}

/** Extract workspaceId from content views that carry one */
function contentViewWorkspaceId(cv: ContentView): string | undefined {
  switch (cv.type) {
    case 'workspace-dashboard':
    case 'branches':
    case 'pr-dashboard':
      return cv.workspaceId;
    default:
      return undefined;
  }
}

/** Check if two entries represent the same navigation location */
function entriesMatch(a: NavigationEntry, b: NavigationEntry): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.sessionId === b.sessionId &&
    a.conversationId === b.conversationId &&
    a.contentView.type === b.contentView.type &&
    contentViewWorkspaceId(a.contentView) === contentViewWorkspaceId(b.contentView)
  );
}

interface NavigationState {
  tabs: Record<string, TabHistory>;
  activeTabId: string;
  /** Suppress history recording during back/forward restore */
  isRestoring: boolean;

  // Actions — all default to activeTabId when tabId is omitted
  pushEntry: (entry: NavigationEntry, tabId?: string) => void;
  goBack: (tabId?: string) => NavigationEntry | null;
  goForward: (tabId?: string) => NavigationEntry | null;
  goToBackIndex: (index: number, currentEntry: NavigationEntry, tabId?: string) => NavigationEntry | null;
  goToForwardIndex: (index: number, currentEntry: NavigationEntry, tabId?: string) => NavigationEntry | null;
  setRestoring: (value: boolean) => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  tabs: { [DEFAULT_TAB_ID]: emptyTabHistory() },
  activeTabId: DEFAULT_TAB_ID,
  isRestoring: false,

  pushEntry: (entry, tabId) => set((state) => {
    const id = tabId ?? state.activeTabId;
    const tab = state.tabs[id] ?? emptyTabHistory();

    // Dedup: skip if identical to top of backStack
    const top = tab.backStack[tab.backStack.length - 1];
    if (top && entriesMatch(top, entry)) {
      return state;
    }

    const newBackStack = [...tab.backStack, entry].slice(-MAX_HISTORY_SIZE);

    return {
      tabs: {
        ...state.tabs,
        [id]: {
          backStack: newBackStack,
          forwardStack: [], // Clear forward stack (browser semantics)
        },
      },
    };
  }),

  goBack: (tabId) => {
    // Zustand's set() is synchronous, so `popped` is assigned by the time we return it.
    let popped: NavigationEntry | null = null;
    set((state) => {
      const id = tabId ?? state.activeTabId;
      const tab = state.tabs[id] ?? emptyTabHistory();
      if (tab.backStack.length === 0) return state;

      const newBackStack = [...tab.backStack];
      popped = newBackStack.pop()!;

      return {
        tabs: {
          ...state.tabs,
          [id]: { backStack: newBackStack, forwardStack: tab.forwardStack },
        },
      };
    });
    return popped;
  },

  goForward: (tabId) => {
    // Zustand's set() is synchronous, so `popped` is assigned by the time we return it.
    let popped: NavigationEntry | null = null;
    set((state) => {
      const id = tabId ?? state.activeTabId;
      const tab = state.tabs[id] ?? emptyTabHistory();
      if (tab.forwardStack.length === 0) return state;

      const newForwardStack = [...tab.forwardStack];
      popped = newForwardStack.pop()!;

      return {
        tabs: {
          ...state.tabs,
          [id]: { backStack: tab.backStack, forwardStack: newForwardStack },
        },
      };
    });
    return popped;
  },

  goToBackIndex: (index, currentEntry, tabId) => {
    let result: NavigationEntry | null = null;
    set((state) => {
      const id = tabId ?? state.activeTabId;
      const tab = state.tabs[id] ?? emptyTabHistory();

      // index is from the reversed display (0 = most recent back entry)
      // In the actual array, most recent is at the end
      const actualIndex = tab.backStack.length - 1 - index;
      if (actualIndex < 0 || actualIndex >= tab.backStack.length) return state;

      result = tab.backStack[actualIndex];
      // Everything after actualIndex goes to forwardStack (+ current state)
      const newBackStack = tab.backStack.slice(0, actualIndex);
      const movedEntries = tab.backStack.slice(actualIndex + 1);
      const newForwardStack = [...tab.forwardStack, currentEntry, ...movedEntries];

      return {
        tabs: {
          ...state.tabs,
          [id]: { backStack: newBackStack, forwardStack: newForwardStack },
        },
      };
    });
    return result;
  },

  goToForwardIndex: (index, currentEntry, tabId) => {
    let result: NavigationEntry | null = null;
    set((state) => {
      const id = tabId ?? state.activeTabId;
      const tab = state.tabs[id] ?? emptyTabHistory();

      // index is from the reversed display (0 = most recent forward entry)
      const actualIndex = tab.forwardStack.length - 1 - index;
      if (actualIndex < 0 || actualIndex >= tab.forwardStack.length) return state;

      result = tab.forwardStack[actualIndex];
      // Everything after actualIndex goes to backStack (+ current state)
      const newForwardStack = tab.forwardStack.slice(0, actualIndex);
      const movedEntries = tab.forwardStack.slice(actualIndex + 1);
      const newBackStack = [...tab.backStack, ...movedEntries, currentEntry];

      return {
        tabs: {
          ...state.tabs,
          [id]: { backStack: newBackStack, forwardStack: newForwardStack },
        },
      };
    });
    return result;
  },

  setRestoring: (value) => set({ isRestoring: value }),
}));
