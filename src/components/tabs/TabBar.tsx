'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TabItem } from './TabItem';
import { TabScrollArea } from './TabScrollArea';
import { useTabScroll } from './useTabScroll';
import { useTabAnimation } from './useTabAnimation';
import { RecentlyClosedPopover } from './RecentlyClosedPopover';
import type { TabBarProps, TabItemData } from './tab.types';

/**
 * SortableTabItem wrapper for drag-and-drop
 */
function SortableTabItem({
  tab,
  isActive,
  isClosing,
  onSelect,
  onClose,
  onPin,
  onRename,
  onGenerateSummary,
  onViewSummary,
  summaryStatus,
  statusIndicator,
}: {
  tab: TabItemData;
  isActive: boolean;
  isClosing?: boolean;
  onSelect: () => void;
  onClose: (e?: React.MouseEvent) => void;
  onPin?: (pinned: boolean) => void;
  onRename?: () => void;
  onGenerateSummary?: () => void;
  onViewSummary?: () => void;
  summaryStatus?: 'generating' | 'completed' | 'failed' | null;
  statusIndicator?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TabItem
        tab={tab}
        isActive={isActive}
        isClosing={isClosing}
        onSelect={onSelect}
        onClose={onClose}
        onPin={onPin}
        onRename={onRename}
        onGenerateSummary={onGenerateSummary}
        onViewSummary={onViewSummary}
        summaryStatus={summaryStatus}
        statusIndicator={statusIndicator}
      />
    </div>
  );
}


/**
 * Main TabBar component with VS Code-style behavior
 *
 * Features:
 * - Unified scrollable tab bar with workspace, session, and conversation tabs
 * - Fixed action area on right (Plus button for new session)
 * - Drag-and-drop reordering within groups
 * - Smooth open/close animations
 * - VS Code-style visual design
 */
export function TabBar({
  workspaceTabs = [], // Deprecated: all file tabs are now session-scoped
  sessionTabs,
  conversationTabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onPinTab,
  onReorder,
  onNewSession,
  onRenameConversation,
  onGenerateSummary,
  onViewSummary,
  getSummaryStatus,
  onRestoreConversation,
  sessionId,
}: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    scrollToTab,
  } = useTabScroll(scrollRef);
  const { startClose, isClosing } = useTabAnimation();

  // Combine all tab IDs for drag-and-drop
  const allTabIds = useMemo(
    () => [
      ...workspaceTabs.map((t) => t.id),
      ...sessionTabs.map((t) => t.id),
      ...conversationTabs.map((t) => t.id),
    ],
    [workspaceTabs, sessionTabs, conversationTabs]
  );

  // Set up dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px drag threshold
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id && onReorder) {
        onReorder(active.id as string, over.id as string);
      }
    },
    [onReorder]
  );

  // Handle tab close with animation
  const handleClose = useCallback(
    (id: string, type: 'file' | 'conversation', e?: React.MouseEvent) => {
      e?.stopPropagation();
      startClose(id, () => {
        onCloseTab(id, type, e);
      });
    },
    [onCloseTab, startClose]
  );

  // Auto-scroll active tab into view when it changes
  useEffect(() => {
    if (activeTabId) {
      scrollToTab(activeTabId);
    }
  }, [activeTabId, scrollToTab]);

  // Render a single tab item
  const renderTab = useCallback(
    (tab: TabItemData, statusIndicator?: React.ReactNode) => (
      <SortableTabItem
        key={tab.id}
        tab={tab}
        isActive={tab.id === activeTabId}
        isClosing={isClosing(tab.id)}
        onSelect={() => onSelectTab(tab.id, tab.type)}
        onClose={(e) => handleClose(tab.id, tab.type, e)}
        onPin={tab.type === 'file' && onPinTab ? (pinned) => onPinTab(tab.id, pinned) : undefined}
        onRename={
          tab.type === 'conversation' && onRenameConversation
            ? () => onRenameConversation(tab.id)
            : undefined
        }
        onGenerateSummary={
          tab.type === 'conversation' && onGenerateSummary
            ? () => onGenerateSummary(tab.id)
            : undefined
        }
        onViewSummary={
          tab.type === 'conversation' && onViewSummary
            ? () => onViewSummary(tab.id)
            : undefined
        }
        summaryStatus={
          tab.type === 'conversation' && getSummaryStatus
            ? getSummaryStatus(tab.id)
            : undefined
        }
        statusIndicator={statusIndicator}
      />
    ),
    [
      activeTabId,
      isClosing,
      onSelectTab,
      handleClose,
      onPinTab,
      onRenameConversation,
      onGenerateSummary,
      onViewSummary,
      getSummaryStatus,
    ]
  );


  return (
    <div
      className={cn(
        'flex items-stretch h-[33px] border-b shrink-0',
        'bg-muted/30' // Slight background for tab bar area
      )}
      role="tablist"
      aria-label="Document tabs"
    >
      {/* Scrollable tab area */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={allTabIds} strategy={horizontalListSortingStrategy}>
          <TabScrollArea
            ref={scrollRef}
            canScrollLeft={canScrollLeft}
            canScrollRight={canScrollRight}
            onScrollLeft={scrollLeft}
            onScrollRight={scrollRight}
            className=""
          >
            {/* Workspace file tabs */}
            {workspaceTabs.map((tab) => renderTab(tab))}

            {/* Session file tabs */}
            {sessionTabs.map((tab) => renderTab(tab))}

            {/* Conversation tabs */}
            {conversationTabs.map((tab) => renderTab(tab, tab.icon))}
          </TabScrollArea>
        </SortableContext>
      </DndContext>

      {/* Fixed action area - Recently closed + Plus button */}
      <div className="flex items-center px-1 border-l border-border shrink-0">
        {onRestoreConversation && (
          <RecentlyClosedPopover
            sessionId={sessionId ?? null}
            onRestore={onRestoreConversation}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onNewSession}
          title="New conversation"
          aria-label="New conversation"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
