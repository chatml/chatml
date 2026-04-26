/**
 * Centralized navigation helpers for browser-style back/forward history.
 *
 * All navigation call sites should use navigate() instead of directly calling
 * selectWorkspace/selectSession/selectConversation/setContentView.
 * This ensures every navigation action is recorded in the history stack.
 */

import { startTransition } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore, type ContentView } from '@/stores/settingsStore';
import { useNavigationStore, type NavigationEntry } from '@/stores/navigationStore';
import { useTabStore } from '@/stores/tabStore';
import { ENABLE_BROWSER_TABS, SHOW_UNRELEASED } from '@/lib/constants';
import { expandGroupsForSession } from '@/hooks/useSidebarSessions';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';

/**
 * Check if a session's target conversation has messages cached in the store.
 * When true, session switching can be synchronous (no startTransition needed).
 */
function hasSessionMessagesCached(sessionId: string): boolean {
  const state = useAppStore.getState();
  const conversations = state.conversations.filter(c => c.sessionId === sessionId);
  const lastActiveId = state.lastActiveConversationPerSession?.[sessionId];
  const targetConv = (lastActiveId && conversations.find(c => c.id === lastActiveId)) || conversations[0];
  if (!targetConv) return false;
  return (state.messagesByConversation?.[targetConv.id]?.length ?? 0) > 0;
}

/**
 * Run `fn` synchronously if the target session's messages are already cached
 * (instant switch), otherwise wrap in startTransition to avoid UI freeze
 * while the new component tree mounts.
 */
function runMaybeTransition(sessionId: string | undefined | null, fn: () => void): void {
  if (sessionId && hasSessionMessagesCached(sessionId)) {
    fn();
  } else {
    startTransition(fn);
  }
}

export interface NavigateParams {
  workspaceId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  contentView?: ContentView;
  /** Override auto-generated label */
  label?: string;
  /** Tab to record history for (defaults to activeTabId) */
  tabId?: string;
}

/**
 * Build a human-readable label describing a navigation state.
 * Exported so the history popover can reuse it for the "current" label.
 */
export function buildNavigationLabel(
  contentView: ContentView,
  opts: {
    selectedWorkspaceId?: string | null;
    selectedSessionId?: string | null;
    selectedConversationId?: string | null;
    sessions?: { id: string; name: string; branch: string; workspaceId: string }[];
    conversations?: { id: string; name: string }[];
    workspaces?: { id: string; name: string }[];
  } = {},
): string {
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId, sessions = [], conversations = [], workspaces = [] } = opts;

  /** Find the workspace name for a given workspace ID */
  const wsName = (id?: string | null) => workspaces.find((w) => w.id === id)?.name;

  switch (contentView.type) {
    case 'conversation': {
      const session = sessions.find((s) => s.id === selectedSessionId);
      const sessionLabel = session ? (session.name || session.branch) : null;
      const ws = wsName(session?.workspaceId ?? selectedWorkspaceId);

      const conv = conversations.find((c) => c.id === selectedConversationId);
      if (conv) {
        return ws ? `${ws} › ${conv.name}` : conv.name;
      }
      if (sessionLabel) {
        return ws ? `${ws} › ${sessionLabel}` : sessionLabel;
      }
      return 'Conversation';
    }
    case 'pr-dashboard': {
      const ws = wsName(contentView.workspaceId);
      return ws ? `${ws} › Pull Requests` : 'Pull Requests';
    }
    case 'branches': {
      const ws = wsName(contentView.workspaceId);
      return ws ? `${ws} › Branches` : 'Branches';
    }
    case 'dashboard':
      return 'Dashboard';
    case 'repositories':
      return 'Repositories';
    case 'history':
      return 'History';
    case 'skills-store':
      return 'Skills';
    case 'scheduled-tasks':
      return 'Scheduled Tasks';
    case 'scheduled-task-detail': {
      const task = useScheduledTaskStore.getState().tasks.find((t) => t.id === contentView.taskId);
      return task ? task.name : 'Scheduled Task';
    }
    default:
      return 'Unknown';
  }
}

/** Build a label from current app/settings store state */
function buildLabel(): string {
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId, sessions, conversations, workspaces } =
    useAppStore.getState();
  const { contentView } = useSettingsStore.getState();

  return buildNavigationLabel(contentView, {
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    sessions,
    conversations,
    workspaces,
  });
}

/** Build a label for a specific set of navigation params */
function buildLabelForParams(params: {
  contentView?: ContentView;
  workspaceId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
}): string {
  const { selectedWorkspaceId, sessions, conversations, workspaces } = useAppStore.getState();
  const contentView = params.contentView ?? useSettingsStore.getState().contentView;

  return buildNavigationLabel(contentView, {
    selectedWorkspaceId: params.workspaceId ?? selectedWorkspaceId,
    selectedSessionId: params.sessionId,
    selectedConversationId: params.conversationId,
    sessions,
    conversations,
    workspaces,
  });
}

/** Snapshot the current navigation state as a NavigationEntry */
function snapshotCurrent(labelOverride?: string): NavigationEntry {
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId } =
    useAppStore.getState();
  const { contentView } = useSettingsStore.getState();

  return {
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    conversationId: selectedConversationId,
    contentView,
    timestamp: Date.now(),
    label: labelOverride ?? buildLabel(),
  };
}

/** Validate that a navigation entry still points to existing data */
function isEntryValid(entry: NavigationEntry): boolean {
  const { sessions, workspaces, conversations } = useAppStore.getState();

  const cv = entry.contentView;
  switch (cv.type) {
    case 'branches':
      return workspaces.some((w) => w.id === cv.workspaceId);
    case 'pr-dashboard':
      // pr-dashboard may or may not have a workspaceId
      if (cv.workspaceId) {
        return workspaces.some((w) => w.id === cv.workspaceId);
      }
      return true;
    case 'dashboard':
    case 'scheduled-tasks':
      return SHOW_UNRELEASED;
    case 'repositories':
    case 'history':
    case 'skills-store':
      return true;
    case 'scheduled-task-detail':
      if (!SHOW_UNRELEASED) return false;
      return useScheduledTaskStore.getState().tasks.some((t) => t.id === cv.taskId);
    case 'conversation':
    default:
      break;
  }

  // For conversation views, check referenced entities still exist
  if (entry.sessionId && !sessions.some((s) => s.id === entry.sessionId)) {
    return false;
  }
  if (entry.workspaceId && !workspaces.some((w) => w.id === entry.workspaceId)) {
    return false;
  }
  if (entry.conversationId && !conversations.some((c) => c.id === entry.conversationId)) {
    return false;
  }
  return true;
}

/** Apply a navigation entry to the app and tab state */
function applyEntry(entry: NavigationEntry): void {
  const mutations = () => {
    const appStore = useAppStore.getState();
    const settingsStore = useSettingsStore.getState();

    if (entry.workspaceId !== undefined) {
      appStore.selectWorkspace(entry.workspaceId);
    }
    // Use selectSession for session changes (it auto-selects first conversation)
    // But if we have a specific conversationId, override after
    if (entry.sessionId !== undefined) {
      appStore.selectSession(entry.sessionId);
      // Auto-expand collapsed sidebar groups so the selected session is visible
      const session = appStore.sessions.find(s => s.id === entry.sessionId && !s.archived);
      if (session) expandGroupsForSession(session);
    }
    if (entry.conversationId !== undefined) {
      appStore.selectConversation(entry.conversationId);
    }
    if (entry.contentView !== undefined) {
      settingsStore.setContentView(entry.contentView);
    }

    // Sync to active browser tab
    if (ENABLE_BROWSER_TABS) {
      useTabStore.getState().updateActiveTab({
        selectedWorkspaceId: entry.workspaceId,
        selectedSessionId: entry.sessionId,
        selectedConversationId: entry.conversationId,
        contentView: entry.contentView,
        label: entry.label,
      });
    }
  };

  runMaybeTransition(entry.sessionId, mutations);
}

// Debounce rapid session switches: when the user clicks multiple sessions
// within NAVIGATE_DEBOUNCE_MS, only the last click is processed. The first
// click in a sequence runs immediately (no perceived delay for single clicks).
const NAVIGATE_DEBOUNCE_MS = 80;
let pendingNavigateTimer: ReturnType<typeof setTimeout> | null = null;
let lastNavigateTime = 0;

/**
 * Navigate to a new state, recording the current state in history.
 * This is the single entry point all navigation call sites should use.
 */
export function navigate(params: NavigateParams): void {
  const executeNavigation = () => {
    if (params.sessionId) lastNavigateTime = Date.now();

    const navStore = useNavigationStore.getState();

    // Push history entry — inside executeNavigation so debounced-away
    // navigations don't corrupt the back stack with duplicate entries.
    if (!navStore.isRestoring) {
      const currentEntry = snapshotCurrent();
      navStore.pushEntry(currentEntry, params.tabId);
    }

    // Auto-clear unread when navigating into a workspace or session
    if (params.sessionId) {
      const session = useAppStore.getState().sessions.find(s => s.id === params.sessionId && !s.archived);
      if (session) {
        useSettingsStore.getState().markWorkspaceRead(session.workspaceId);
        // Auto-expand collapsed sidebar groups so the selected session is visible
        expandGroupsForSession(session);
      }
      useSettingsStore.getState().markSessionRead(params.sessionId);
    } else if (params.workspaceId) {
      useSettingsStore.getState().markWorkspaceRead(params.workspaceId);
    }

    const applyMutations = () => {
      const appStore = useAppStore.getState();
      const settingsStore = useSettingsStore.getState();

      if (params.workspaceId !== undefined) {
        appStore.selectWorkspace(params.workspaceId);
      }
      if (params.sessionId !== undefined) {
        appStore.selectSession(params.sessionId);
      }
      if (params.conversationId !== undefined) {
        appStore.selectConversation(params.conversationId);
      }
      if (params.contentView !== undefined) {
        settingsStore.setContentView(params.contentView);
      }

      // Sync to active browser tab
      if (ENABLE_BROWSER_TABS) {
        useTabStore.getState().updateActiveTab({
          ...(params.workspaceId !== undefined && { selectedWorkspaceId: params.workspaceId }),
          ...(params.sessionId !== undefined && { selectedSessionId: params.sessionId }),
          ...(params.conversationId !== undefined && { selectedConversationId: params.conversationId }),
          ...(params.contentView !== undefined && { contentView: params.contentView }),
          label: params.label ?? buildLabelForParams(params),
        });
      }
    };

    runMaybeTransition(params.sessionId, applyMutations);
  };

  // Debounce session switches: if another session navigate happened very recently,
  // defer the expensive mutations so only the final click in a rapid sequence
  // is processed. Non-session navigations (content views, etc.) run immediately.
  if (params.sessionId && Date.now() - lastNavigateTime < NAVIGATE_DEBOUNCE_MS) {
    if (pendingNavigateTimer) clearTimeout(pendingNavigateTimer);
    pendingNavigateTimer = setTimeout(() => {
      pendingNavigateTimer = null;
      executeNavigation();
    }, NAVIGATE_DEBOUNCE_MS);
  } else {
    if (pendingNavigateTimer) {
      clearTimeout(pendingNavigateTimer);
      pendingNavigateTimer = null;
    }
    executeNavigation();
  }
}

/**
 * Navigate within active tab, or open in a new tab if Cmd+Click or middle-click.
 * Use this as the click handler for sidebar navigation items.
 */
export function navigateOrOpenTab(params: NavigateParams, event?: React.MouseEvent): void {
  if (ENABLE_BROWSER_TABS && event && (event.metaKey || event.button === 1)) {
    // Cmd+Click or middle-click: open in new tab
    event.preventDefault();
    const tabStore = useTabStore.getState();
    const label = params.label ?? buildLabelForParams(params);

    const tabId = tabStore.createTab({
      selectedWorkspaceId: params.workspaceId ?? null,
      selectedSessionId: params.sessionId ?? null,
      selectedConversationId: params.conversationId ?? null,
      contentView: params.contentView ?? { type: 'conversation' },
      label,
    });
    tabStore.activateTab(tabId);
    useNavigationStore.getState().setActiveTabId(tabId);
  } else {
    // Normal click: navigate within active tab
    navigate(params);
  }
}

/** Go back in history for the given tab (defaults to active tab) */
export function goBack(tabId?: string): void {
  const navStore = useNavigationStore.getState();
  const id = tabId ?? navStore.activeTabId;
  const tab = navStore.tabs[id];

  if (!tab || tab.backStack.length === 0) return;

  // Find the first valid entry, discarding invalid ones (deleted sessions/workspaces
  // won't come back, so there's no point preserving them in either stack).
  // Done in a single setState to avoid N re-renders when skipping invalid entries.
  let entry: NavigationEntry | null = null;
  const currentEntry = snapshotCurrent();

  useNavigationStore.setState((s) => {
    const tabState = s.tabs[id];
    if (!tabState) return s;

    const newBackStack = [...tabState.backStack];

    // Pop from back until we find a valid entry; discard invalid ones
    while (newBackStack.length > 0) {
      const candidate = newBackStack.pop()!;
      if (isEntryValid(candidate)) {
        entry = candidate;
        break;
      }
      // Invalid entry — discard it
    }

    if (!entry) {
      // All entries were invalid; just clean the back stack
      return {
        tabs: { ...s.tabs, [id]: { ...tabState, backStack: newBackStack } },
      };
    }

    return {
      tabs: {
        ...s.tabs,
        [id]: {
          backStack: newBackStack,
          forwardStack: [...tabState.forwardStack, currentEntry],
        },
      },
    };
  });

  if (!entry) return;

  navStore.setRestoring(true);
  try {
    applyEntry(entry);
  } finally {
    navStore.setRestoring(false);
  }
}

/** Go forward in history for the given tab (defaults to active tab) */
export function goForward(tabId?: string): void {
  const navStore = useNavigationStore.getState();
  const id = tabId ?? navStore.activeTabId;
  const tab = navStore.tabs[id];

  if (!tab || tab.forwardStack.length === 0) return;

  // Find the first valid entry, discarding invalid ones (deleted sessions/workspaces
  // won't come back, so there's no point preserving them in either stack).
  // Done in a single setState to avoid N re-renders when skipping invalid entries.
  let entry: NavigationEntry | null = null;
  const currentEntry = snapshotCurrent();

  useNavigationStore.setState((s) => {
    const tabState = s.tabs[id];
    if (!tabState) return s;

    const newForwardStack = [...tabState.forwardStack];

    // Pop from forward until we find a valid entry; discard invalid ones
    while (newForwardStack.length > 0) {
      const candidate = newForwardStack.pop()!;
      if (isEntryValid(candidate)) {
        entry = candidate;
        break;
      }
      // Invalid entry — discard it
    }

    if (!entry) {
      // All entries were invalid; just clean the forward stack
      return {
        tabs: { ...s.tabs, [id]: { ...tabState, forwardStack: newForwardStack } },
      };
    }

    return {
      tabs: {
        ...s.tabs,
        [id]: {
          backStack: [...tabState.backStack, currentEntry],
          forwardStack: newForwardStack,
        },
      },
    };
  });

  if (!entry) return;

  navStore.setRestoring(true);
  try {
    applyEntry(entry);
  } finally {
    navStore.setRestoring(false);
  }
}

/** Jump to a specific entry in the back stack (index 0 = most recent) */
export function goToBackEntry(index: number, tabId?: string): void {
  const navStore = useNavigationStore.getState();
  const id = tabId ?? navStore.activeTabId;
  const tab = navStore.tabs[id];
  if (!tab) return;

  // Peek the target entry without mutating stacks. If it's invalid, bail out
  // before any state changes — otherwise the click would shuffle history yet
  // not navigate, leaving the popover in a confusing state.
  const actualIndex = tab.backStack.length - 1 - index;
  const candidate = tab.backStack[actualIndex];
  if (!candidate || !isEntryValid(candidate)) return;

  const currentEntry = snapshotCurrent();
  const entry = navStore.goToBackIndex(index, currentEntry, tabId);
  if (!entry) return;

  navStore.setRestoring(true);
  try {
    applyEntry(entry);
  } finally {
    navStore.setRestoring(false);
  }
}

/** Jump to a specific entry in the forward stack (index 0 = most recent) */
export function goToForwardEntry(index: number, tabId?: string): void {
  const navStore = useNavigationStore.getState();
  const id = tabId ?? navStore.activeTabId;
  const tab = navStore.tabs[id];
  if (!tab) return;

  // Peek before mutating — see goToBackEntry for rationale.
  const actualIndex = tab.forwardStack.length - 1 - index;
  const candidate = tab.forwardStack[actualIndex];
  if (!candidate || !isEntryValid(candidate)) return;

  const currentEntry = snapshotCurrent();
  const entry = navStore.goToForwardIndex(index, currentEntry, tabId);
  if (!entry) return;

  navStore.setRestoring(true);
  try {
    applyEntry(entry);
  } finally {
    navStore.setRestoring(false);
  }
}
