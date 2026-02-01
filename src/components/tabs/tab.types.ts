import type { ReactNode, MouseEvent } from 'react';
import type { FileTab, Conversation } from '@/lib/types';

/**
 * Common tab item interface used by TabBar
 */
export interface TabItemData {
  id: string;
  type: 'file' | 'conversation';
  label: string;
  icon?: ReactNode;
  isDirty?: boolean;
  isPinned?: boolean;
  isActive: boolean;
  group: 'session' | 'conversation'; // All file tabs are now session-scoped
  // Original data reference for type-specific operations
  fileTab?: FileTab;
  conversation?: Conversation;
}

/**
 * Props for the main TabBar component
 */
export interface TabBarProps {
  /**
   * @deprecated Workspace-scoped tabs have been removed. All tabs are now session-scoped.
   * This prop is kept for backward compatibility during migration. Always pass [].
   */
  workspaceTabs?: TabItemData[];
  sessionTabs: TabItemData[];
  conversationTabs: TabItemData[];
  activeTabId: string | null;
  onSelectTab: (id: string, type: 'file' | 'conversation') => void;
  onCloseTab: (id: string, type: 'file' | 'conversation', e?: MouseEvent) => void;
  onPinTab?: (id: string, pinned: boolean) => void;
  onCloseOthers?: (id: string, type: 'file' | 'conversation') => void;
  onCloseToRight?: (id: string, type: 'file' | 'conversation') => void;
  onReorder?: (activeId: string, overId: string) => void;
  onNewSession: () => void;
  onRenameConversation?: (id: string) => void;
  onGenerateSummary?: (conversationId: string) => void;
  onViewSummary?: (conversationId: string) => void;
  getSummaryStatus?: (conversationId: string) => 'generating' | 'completed' | 'failed' | null;
}

/**
 * Props for individual TabItem component
 */
export interface TabItemProps {
  tab: TabItemData;
  isActive: boolean;
  isClosing?: boolean;
  onSelect: () => void;
  onClose: (e?: MouseEvent) => void;
  onPin?: (pinned: boolean) => void;
  onCloseOthers?: () => void;
  onCloseToRight?: () => void;
  onRename?: () => void;
  onGenerateSummary?: () => void;
  onViewSummary?: () => void;
  summaryStatus?: 'generating' | 'completed' | 'failed' | null;
  // Status indicator for conversations
  statusIndicator?: ReactNode;
}

/**
 * Props for TabScrollArea component
 */
export interface TabScrollAreaProps {
  children: ReactNode;
  className?: string;
  onScrollStateChange?: (canScrollLeft: boolean, canScrollRight: boolean) => void;
}

/**
 * Props for TabGroup separator
 */
export interface TabGroupProps {
  children: ReactNode;
  showSeparator?: boolean;
}

/**
 * Animation state for tab transitions
 */
export interface TabAnimationState {
  closingTabs: Set<string>;
  openingTabs: Set<string>;
}

/**
 * Tab scroll state from useTabScroll hook
 */
export interface TabScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollLeft: () => void;
  scrollRight: () => void;
  scrollToTab: (tabId: string) => void;
}

/**
 * Constants for tab sizing
 */
export const TAB_MIN_WIDTH = 120;
export const TAB_MAX_WIDTH = 200;
export const SCROLL_AMOUNT = 200;
export const ANIMATION_DURATION = 150;
