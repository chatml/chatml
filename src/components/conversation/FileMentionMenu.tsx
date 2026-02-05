'use client';

import { useRef, useEffect } from 'react';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/files/FileTree';
import { Loader2 } from 'lucide-react';
import type { FlatFile } from '@/hooks/useFileMentions';

interface FileMentionMenuProps {
  isOpen: boolean;
  files: FlatFile[];
  selectedIndex: number;
  query: string;
  isLoading: boolean;
  onSelect: (file: FlatFile) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
}

export function FileMentionMenu({
  isOpen,
  files,
  selectedIndex,
  query,
  isLoading,
  onSelect,
  onHover,
  onDismiss,
}: FileMentionMenuProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

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
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
          Files
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query ? 'No files match your search' : 'No files found'}
          </div>
        ) : (
          files.map((file, idx) => {
            const isSelected = idx === selectedIndex;

            return (
              <div
                key={file.path}
                ref={isSelected ? selectedRef : undefined}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-default select-none',
                  isSelected && 'bg-accent text-accent-foreground',
                  !isSelected && 'hover:bg-muted'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(file);
                }}
                onMouseEnter={() => onHover(idx)}
              >
                <FileIcon filename={file.name} className="shrink-0" />
                <div className="flex flex-col min-w-0 gap-0">
                  <span className="text-sm truncate">
                    <HighlightMatch text={file.name} query={query} isSelected={isSelected} />
                  </span>
                  <span
                    className={cn(
                      'text-xs truncate',
                      isSelected ? 'text-accent-foreground/60' : 'text-muted-foreground/70'
                    )}
                  >
                    {file.directory}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

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
      <span
        className={cn(
          'font-semibold',
          isSelected ? 'text-accent-foreground' : 'text-foreground'
        )}
      >
        {match}
      </span>
      {after}
    </>
  );
}
