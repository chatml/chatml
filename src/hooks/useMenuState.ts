import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useTabStore } from '@/stores/tabStore';
import { isTauri, safeInvoke } from '@/lib/tauri';
import { computeMenuState } from '@/lib/menuContext';
import { ENABLE_BROWSER_TABS } from '@/lib/constants';

/**
 * Hook that keeps macOS menu item enabled/disabled state in sync
 * with the current application state. Sends only changed items
 * to the Rust backend via IPC.
 */
export function useMenuState() {
  const previousStateRef = useRef<Record<string, boolean>>({});

  // Subscribe to minimal state slices
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);
  const selectedConversationId = useAppStore((s) => s.selectedConversationId);
  const contentView = useSettingsStore((s) => s.contentView);

  // Derived: any file tab dirty?
  const hasDirtyFileTabs = useAppStore((s) => s.fileTabs.some((t) => t.isDirty));

  // Derived: pending plan approval for current conversation?
  const hasPendingPlanApproval = useAppStore((s) => {
    if (!s.selectedConversationId) return false;
    const streaming = s.streamingState[s.selectedConversationId];
    return streaming?.pendingPlanApproval != null;
  });

  // Navigation: can go back/forward?
  const canGoBack = useNavigationStore((s) => {
    const tab = s.tabs[s.activeTabId];
    return tab ? tab.backStack.length > 0 : false;
  });
  const canGoForward = useNavigationStore((s) => {
    const tab = s.tabs[s.activeTabId];
    return tab ? tab.forwardStack.length > 0 : false;
  });

  // Browser tabs: more than one tab open?
  const hasBrowserTabs = useTabStore((s) => ENABLE_BROWSER_TABS && s.tabOrder.length > 1);

  useEffect(() => {
    if (!isTauri()) return;

    const state = computeMenuState({
      contentView,
      selectedWorkspaceId,
      selectedSessionId,
      selectedConversationId,
      hasDirtyFileTabs,
      hasPendingPlanApproval,
      canGoBack,
      canGoForward,
      hasBrowserTabs,
    });

    // Compute diff - only send items that changed
    const diff: [string, boolean][] = [];
    for (const [id, enabled] of Object.entries(state) as [string, boolean][]) {
      if (previousStateRef.current[id] !== enabled) {
        diff.push([id, enabled]);
      }
    }

    if (diff.length === 0) return;
    previousStateRef.current = state;

    safeInvoke('update_menu_state', { items: diff });
  }, [
    contentView,
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    hasDirtyFileTabs,
    hasPendingPlanApproval,
    canGoBack,
    canGoForward,
    hasBrowserTabs,
  ]);
}
