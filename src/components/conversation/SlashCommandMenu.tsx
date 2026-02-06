'use client';

import { useRef, useEffect } from 'react';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { UnifiedSlashCommand } from '@/stores/slashCommandStore';

// ============================================================================
// Types
// ============================================================================

interface SlashCommandMenuProps {
  isOpen: boolean;
  commands: UnifiedSlashCommand[];
  selectedIndex: number;
  query: string;
  onSelect: (command: UnifiedSlashCommand) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
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
        className="w-[340px] p-1 max-h-[320px] overflow-y-auto rounded-md bg-popover shadow-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={() => onDismiss()}
        onEscapeKeyDown={(e) => {
          e.preventDefault(); // Let the hook handle Escape
        }}
      >
        {commands.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          const Icon = cmd.icon;

          return (
            <div
              key={cmd.id}
              ref={isSelected ? selectedRef : undefined}
              className={cn(
                'relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer transition-colors select-none',
                isSelected && 'bg-accent text-accent-foreground',
                !isSelected && 'text-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent textarea blur
                onSelect(cmd);
              }}
              onMouseEnter={() => onHover(idx)}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <span className="shrink-0">
                  <span className="text-muted-foreground">/</span>
                  <HighlightMatch text={cmd.trigger} query={query} isSelected={isSelected} />
                </span>
                <span className="text-muted-foreground text-xs truncate">
                  {cmd.description}
                </span>
              </div>
              {cmd.source !== 'builtin' && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0 capitalize">
                  {cmd.source}
                </span>
              )}
            </div>
          );
        })}
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
