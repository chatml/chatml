/**
 * TabBar - Horizontal tab navigation component
 *
 * Features:
 * - Drag-and-drop reordering
 * - Tab close buttons (except last tab)
 * - New tab button (clones active tab)
 * - Smart truncation for long labels
 */

import { Plus, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { TabView } from '@/types/tabView';

interface TabBarProps {
  tabs: TabView[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTabReorder: (tabIds: string[]) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  onTabReorder,
}: TabBarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px drag threshold to distinguish from clicks
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex(t => t.id === active.id);
      const newIndex = tabs.findIndex(t => t.id === over.id);
      const reordered = arrayMove(tabs, oldIndex, newIndex);
      onTabReorder(reordered.map(t => t.id));
    }
  };

  return (
    <div className="flex items-center gap-1 flex-1 overflow-x-auto min-w-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map(t => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClick={() => onTabClick(tab.id)}
                onClose={() => onTabClose(tab.id)}
                canClose={tabs.length > 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        onClick={onNewTab}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="New tab (clone current)"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

interface SortableTabProps {
  tab: TabView;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  canClose: boolean;
}

function SortableTab({
  tab,
  isActive,
  onClick,
  onClose,
  canClose,
}: SortableTabProps) {
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
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer select-none",
        "min-w-[100px] max-w-[200px] shrink-0",
        "transition-colors",
        isActive
          ? "bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100"
          : "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700",
        isDragging && "opacity-50 cursor-grabbing"
      )}
      onClick={onClick}
    >
      {tab.icon && <span className="shrink-0 text-sm">{tab.icon}</span>}
      <span className="truncate text-sm font-medium">{tab.label}</span>
      {canClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "shrink-0 w-4 h-4 flex items-center justify-center rounded",
            "hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors",
            "opacity-0 group-hover:opacity-100",
            isActive && "opacity-100"
          )}
          title="Close tab"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
