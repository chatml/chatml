'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatSearchBarProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentMatchIndex: number;
  totalMatches: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  partialResults?: boolean; // True when not all messages are loaded
  isSearchPending?: boolean; // True while debounced query is catching up
}

export function ChatSearchBar({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  currentMatchIndex,
  totalMatches,
  onNextMatch,
  onPrevMatch,
  partialResults,
  isSearchPending,
}: ChatSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => clearTimeout(debounceTimerRef.current);
  }, []);

  const debouncedOnChange = useCallback((q: string) => {
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => onSearchChange(q), 200);
  }, [onSearchChange]);

  // Sync local state when parent resets searchQuery (e.g., on close)
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onPrevMatch();
        } else {
          onNextMatch();
        }
      }
    },
    [onClose, onNextMatch, onPrevMatch]
  );

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 z-20 p-2">
      <div className="flex items-center gap-1 bg-popover border border-border rounded-lg shadow-lg p-1">
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search..."
          value={localQuery}
          onChange={(e) => {
            setLocalQuery(e.target.value);
            debouncedOnChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          className="h-7 w-48 text-sm border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        />

        <div className={cn(
          "text-xs text-muted-foreground min-w-[4rem] text-center",
          totalMatches === 0 && searchQuery && !isSearchPending && "text-destructive"
        )}>
          {searchQuery ? (
            isSearchPending ? (
              <span className="opacity-50">...</span>
            ) : totalMatches > 0 ? (
              <>
                {`${currentMatchIndex + 1} of ${totalMatches}`}
                {partialResults && <span title="Not all messages are loaded">*</span>}
              </>
            ) : (
              partialResults ? "No results*" : "No results"
            )
          ) : null}
        </div>

        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onPrevMatch}
            disabled={totalMatches === 0}
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onNextMatch}
            disabled={totalMatches === 0}
            title="Next match (Enter)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          title="Close (Escape)"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Highlight search matches in text content.
 * Returns an array of React nodes with matches wrapped in <mark> tags.
 */
export function highlightSearchMatches(
  text: string,
  searchQuery: string,
  currentMatchIndex: number,
  globalMatchOffset: number
): React.ReactNode[] {
  if (!searchQuery || !text) {
    return [text];
  }

  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  let lastIndex = 0;
  let matchCount = 0;

  let index = lowerText.indexOf(lowerQuery);
  while (index !== -1) {
    // Add text before match
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }

    // Add highlighted match
    const isCurrentMatch = globalMatchOffset + matchCount === currentMatchIndex;
    parts.push(
      <mark
        key={`match-${index}`}
        className={cn(
          "rounded-sm px-0.5",
          isCurrentMatch
            ? "bg-yellow-400 dark:bg-yellow-500 text-black"
            : "bg-yellow-200 dark:bg-yellow-700/50 text-foreground"
        )}
        data-match-index={globalMatchOffset + matchCount}
      >
        {text.slice(index, index + searchQuery.length)}
      </mark>
    );

    matchCount++;
    lastIndex = index + searchQuery.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/**
 * Count search matches in text content.
 */
export function countSearchMatches(text: string, searchQuery: string): number {
  if (!searchQuery || !text) return 0;

  const lowerText = text.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  let count = 0;
  let index = lowerText.indexOf(lowerQuery);

  while (index !== -1) {
    count++;
    index = lowerText.indexOf(lowerQuery, index + 1);
  }

  return count;
}
