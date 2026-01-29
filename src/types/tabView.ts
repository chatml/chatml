/**
 * TabView - Represents an independent view/tab with its own navigation and state
 *
 * Each TabView maintains:
 * - Content type (conversation, dashboard, etc.)
 * - Navigation state (selected workspace, session, conversation)
 * - Panel visibility and active tabs
 * - Scroll position for restoration
 */

import type { ContentView, TopPanelTab, AllBottomPanelTab } from '@/stores/settingsStore';

export interface TabView {
  id: string;  // uuid
  label: string;  // Display name for the tab
  icon?: string;  // Optional icon (emoji or icon name)

  // Core navigation state (formerly global in AppStore/SettingsStore)
  contentView: ContentView;
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  selectedConversationId: string | null;
  selectedFileTabId: string | null;

  // Panel state (per-tab)
  rightSidebarVisible: boolean;
  activeRightTab: TopPanelTab;
  bottomTerminalVisible: boolean;
  activeBottomTab: AllBottomPanelTab;

  // Scroll restoration
  scrollPosition?: number;

  // Metadata
  createdAt: number;
  lastAccessedAt: number;
}

export interface TabViewState {
  tabs: TabView[];
  activeTabId: string;
}
