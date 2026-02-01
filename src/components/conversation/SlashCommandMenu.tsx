'use client';

import { useRef, useEffect, useMemo } from 'react';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { SlashCommand, SlashCommandCategory } from '@/lib/slashCommands';

// ============================================================================
// Types
// ============================================================================

interface SlashCommandMenuProps {
  isOpen: boolean;
  commands: SlashCommand[];
  selectedIndex: number;
  query: string;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
}

// Category display order
const CATEGORY_ORDER: SlashCommandCategory[] = ['Agent', 'Git', 'Review', 'Mode'];

// ============================================================================
// Helpers
// ============================================================================

interface IndexedCommand {
  command: SlashCommand;
  globalIndex: number;
}

interface CategoryGroup {
  category: SlashCommandCategory;
  items: IndexedCommand[];
}

function buildCategoryGroups(commands: SlashCommand[]): CategoryGroup[] {
  const byCategory = new Map<SlashCommandCategory, SlashCommand[]>();
  for (const cmd of commands) {
    const list = byCategory.get(cmd.category) || [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }

  const groups: CategoryGroup[] = [];
  let idx = 0;
  for (const category of CATEGORY_ORDER) {
    const cmds = byCategory.get(category);
    if (!cmds || cmds.length === 0) continue;
    groups.push({
      category,
      items: cmds.map((cmd) => ({ command: cmd, globalIndex: idx++ })),
    });
  }
  return groups;
}

// ============================================================================
// Component
// ============================================================================

export function SlashCommandMenu({
  isOpen,
  commands,
  selectedIndex,
  query,
  onSelect,
  onHover,
  onDismiss,
}: SlashCommandMenuProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Pre-compute flat indexed list to avoid mutable counter during render
  const groups = useMemo(() => buildCategoryGroups(commands), [commands]);

  if (!isOpen || commands.length === 0) return null;

  return (
    <Popover open={isOpen} modal={false}>
      <PopoverAnchor asChild>
        <div className="absolute top-0 left-3 w-0 h-0" />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-80 p-1 max-h-[280px] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={() => onDismiss()}
        onEscapeKeyDown={(e) => {
          e.preventDefault(); // Let the hook handle Escape
        }}
      >
        {/* Header */}
        <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
          Commands
        </div>

        {groups.map(({ category, items }) => (
          <div key={category}>
            {/* Category heading */}
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground/60">
              {category}
            </div>

            {/* Command items */}
            {items.map(({ command: cmd, globalIndex: idx }) => {
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;

              return (
                <div
                  key={cmd.id}
                  ref={isSelected ? selectedRef : undefined}
                  className={cn(
                    'flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-default select-none',
                    isSelected && 'bg-accent text-accent-foreground',
                    !isSelected && 'hover:bg-muted'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent textarea blur
                    onSelect(cmd);
                  }}
                  onMouseEnter={() => onHover(idx)}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground'
                    )}
                  />
                  <div className="flex flex-col min-w-0 gap-0">
                    <span className="text-sm truncate">
                      <span className={cn(
                        isSelected ? 'text-accent-foreground/50' : 'text-muted-foreground/60'
                      )}>
                        /
                      </span>
                      <HighlightMatch text={cmd.trigger} query={query} isSelected={isSelected} />
                    </span>
                    <span className={cn(
                      'text-xs truncate',
                      isSelected ? 'text-accent-foreground/60' : 'text-muted-foreground/70'
                    )}>
                      {cmd.description}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Highlight Match
// ============================================================================

function HighlightMatch({
  text,
  query,
  isSelected,
}: {
  text: string;
  query: string;
  isSelected: boolean;
}) {
  if (!query) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) return <>{text}</>;

  const before = text.slice(0, matchIndex);
  const match = text.slice(matchIndex, matchIndex + query.length);
  const after = text.slice(matchIndex + query.length);

  return (
    <>
      {before}
      <span className={cn(
        'font-semibold',
        isSelected ? 'text-accent-foreground' : 'text-foreground'
      )}>
        {match}
      </span>
      {after}
    </>
  );
}
