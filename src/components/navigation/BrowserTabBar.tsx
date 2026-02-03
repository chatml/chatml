'use client';

import { memo, type ReactNode } from 'react';
import { startTransition } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Copy } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useTabStore, type BrowserTab } from '@/stores/tabStore';
import { useUIStore } from '@/stores/uiStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildNavigationLabel } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Save current global state into the specified tab, then activate a new tab
 * and restore its state to globals. Shared by BrowserTabStrip and keyboard shortcuts.
 */
export function switchToTab(tabId: string) {
  const tabStore = useTabStore.getState();
  const currentId = tabStore.activeTabId;

  if (tabId === currentId) return;

  // Save current state to the outgoing tab
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId } = useAppStore.getState();
  const { contentView } = useSettingsStore.getState();
  tabStore.updateTab(currentId, {
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    contentView,
  });

  // Activate the new tab
  tabStore.activateTab(tabId);

  // Restore the new tab's state to globals
  const newTab = tabStore.tabs[tabId];
  if (newTab) {
    startTransition(() => {
      const appStore = useAppStore.getState();
      const settingsStore = useSettingsStore.getState();
      appStore.selectWorkspace(newTab.selectedWorkspaceId);
      appStore.selectSession(newTab.selectedSessionId);
      if (newTab.selectedConversationId) {
        appStore.selectConversation(newTab.selectedConversationId);
      }
      settingsStore.setContentView(newTab.contentView);
    });
    useNavigationStore.getState().setActiveTabId(tabId);
  }
}

/**
 * Create a new browser tab and switch to it.
 * The new tab clones the current view state (same workspace, session, conversation).
 */
export function createAndSwitchToNewTab() {
  const tabStore = useTabStore.getState();
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId, sessions, conversations, workspaces } =
    useAppStore.getState();
  const { contentView } = useSettingsStore.getState();

  // Save current global state to the outgoing tab so it's not lost
  tabStore.updateTab(tabStore.activeTabId, {
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    contentView,
    label: buildNavigationLabel(contentView, {
      selectedWorkspaceId,
      selectedSessionId,
      selectedConversationId,
      sessions,
      conversations,
      workspaces,
    }),
  });

  // Clone the current view into the new tab
  const label = buildNavigationLabel(contentView, {
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    sessions,
    conversations,
    workspaces,
  });

  const tabId = tabStore.createTab({
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    contentView,
    label,
  });

  // Activate the new tab (no need for full switchToTab since globals already match)
  tabStore.activateTab(tabId);
  useNavigationStore.getState().setActiveTabId(tabId);
}

/** Individual sortable browser tab — Linear-style full-width expanding tab */
const SortableBrowserTab = memo(function SortableBrowserTab({
  tab,
  isActive,
  richTitle,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
}: {
  tab: BrowserTab;
  isActive: boolean;
  /** Cached rich ReactNode title (icons, colored dots, breadcrumbs) */
  richTitle?: ReactNode;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onDuplicate: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    flex: '1 1 0',
    width: 0,
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          role="tab"
          tabIndex={0}
          aria-selected={isActive}
          onClick={onActivate}
          onMouseDown={handleMouseDown}
          className={cn(
            'group relative flex items-center justify-center px-3 cursor-pointer select-none',
            'text-sm font-medium min-w-0 overflow-hidden h-7 my-auto rounded',
            'transition-colors duration-100',
            isDragging && 'opacity-50 z-50',
            isActive
              ? 'text-foreground bg-surface-2'
              : 'text-muted-foreground bg-surface-1 hover:text-foreground hover:bg-surface-2/50',
          )}
        >
          {richTitle ? (
            <span className="flex-1 min-w-0 overflow-hidden flex items-center justify-center">
              {richTitle}
            </span>
          ) : (
            <span className="truncate flex-1 text-center">
              {tab.label || 'New Tab'}
            </span>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={handleCloseClick}
            className={cn(
              'flex items-center justify-center w-4 h-4 rounded-sm shrink-0 ml-1.5',
              'transition-opacity duration-100',
              isActive
                ? 'opacity-40 hover:opacity-100 hover:bg-muted'
                : 'opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-muted',
            )}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onDuplicate}>
          <Copy className="w-3.5 h-3.5 mr-2" />
          Duplicate Tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onClose}>
          Close
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>
          Close Others
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseToRight}>
          Close to the Right
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * Inline tab strip for embedding inside MainToolbar.
 * Renders tab items + "+" button. No outer container — caller provides layout.
 */
export const BrowserTabStrip = memo(function BrowserTabStrip() {
  const tabOrder = useTabStore((s) => s.tabOrder);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabTitles = useUIStore((s) => s.tabTitles);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Don't render if single tab (MainToolbar shows the normal title instead)
  if (tabOrder.length <= 1) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = tabOrder.indexOf(active.id as string);
    const toIndex = tabOrder.indexOf(over.id as string);
    if (fromIndex !== -1 && toIndex !== -1) {
      useTabStore.getState().reorderTabs(fromIndex, toIndex);
    }
  };

  const handleCloseTab = (tabId: string) => {
    const wasActive = tabId === activeTabId;
    useTabStore.getState().closeTab(tabId);
    useUIStore.getState().removeTabTitle(tabId);
    if (wasActive) {
      // Restore the new active tab's state directly — don't use switchToTab()
      // because it tries to save state to the "outgoing" tab, which was just closed.
      const tabStore = useTabStore.getState();
      const newTab = tabStore.tabs[tabStore.activeTabId];
      if (newTab) {
        startTransition(() => {
          const appStore = useAppStore.getState();
          const settingsStore = useSettingsStore.getState();
          appStore.selectWorkspace(newTab.selectedWorkspaceId);
          appStore.selectSession(newTab.selectedSessionId);
          if (newTab.selectedConversationId) {
            appStore.selectConversation(newTab.selectedConversationId);
          }
          settingsStore.setContentView(newTab.contentView);
        });
        useNavigationStore.getState().setActiveTabId(tabStore.activeTabId);
      }
    }
  };

  return (
    <div className="flex items-center gap-1 h-full overflow-x-auto scrollbar-none min-w-0 flex-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
          {tabOrder.map((tabId) => {
            const tab = tabs[tabId];
            if (!tab) return null;
            return (
              <SortableBrowserTab
                key={tabId}
                tab={tab}
                isActive={tabId === activeTabId}
                richTitle={tabTitles[tabId]}
                onActivate={() => switchToTab(tabId)}
                onClose={() => handleCloseTab(tabId)}
                onCloseOthers={() => {
                  const closedIds = tabOrder.filter((id) => id !== tabId);
                  useTabStore.getState().closeOtherTabs(tabId);
                  closedIds.forEach((id) => useUIStore.getState().removeTabTitle(id));
                }}
                onCloseToRight={() => {
                  const idx = tabOrder.indexOf(tabId);
                  const closedIds = tabOrder.slice(idx + 1);
                  useTabStore.getState().closeTabsToRight(tabId);
                  closedIds.forEach((id) => useUIStore.getState().removeTabTitle(id));
                }}
                onDuplicate={() => {
                  const newId = useTabStore.getState().duplicateTab(tabId);
                  switchToTab(newId);
                }}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
});
