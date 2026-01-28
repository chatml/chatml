'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useAppStore } from '@/stores/appStore';
import { useShortcut } from '@/hooks/useShortcut';
import { listSessionFiles, type FileNodeDTO } from '@/lib/api';
import { FileIcon } from '@/components/files/FileTree';
import { Skeleton } from '@/components/ui/skeleton';
import type { FileTab } from '@/lib/types';
import type { Command as CommandPrimitive } from 'cmdk';

interface FlatFile {
  path: string;      // Full relative path (e.g., "src/components/Button.tsx")
  name: string;      // Filename only (e.g., "Button.tsx")
  directory: string; // Parent directory for display (e.g., "src/components")
}

/**
 * Check if search matches via initials/camelCase
 * "CP" matches "ChangesPanel", "ci" matches "ChatInput"
 */
function matchesInitials(text: string, search: string): boolean {
  if (!search) return false;

  // Extract initials from camelCase, PascalCase, snake_case, kebab-case
  const initials: string[] = [];
  let prevWasLower = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isUpper = char >= 'A' && char <= 'Z';
    const isLower = char >= 'a' && char <= 'z';
    const isSeparator = char === '_' || char === '-' || char === '.';

    // Capture: start of string, after separator, or uppercase after lowercase (camelCase)
    if (i === 0 && (isUpper || isLower)) {
      initials.push(char.toLowerCase());
    } else if (isSeparator && i + 1 < text.length) {
      const next = text[i + 1];
      if ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z')) {
        initials.push(next.toLowerCase());
      }
    } else if (isUpper && prevWasLower) {
      initials.push(char.toLowerCase());
    }

    prevWasLower = isLower;
  }

  // Check if search matches the initials sequence
  const searchLower = search.toLowerCase();
  const initialsStr = initials.join('');

  return initialsStr.startsWith(searchLower) || initialsStr.includes(searchLower);
}

/**
 * Check if a single term matches a value (substring or initials)
 */
function termMatches(value: string, term: string): { matches: boolean; score: number } {
  const valueLower = value.toLowerCase();
  const termLower = term.toLowerCase();

  // Exact match
  if (valueLower === termLower) {
    return { matches: true, score: 1000 };
  }

  // Substring match
  if (valueLower.includes(termLower)) {
    let score = 100;
    // Bonus for match at start
    if (valueLower.startsWith(termLower)) {
      score += 200;
    }
    // Bonus for match after separator
    if (valueLower.includes('/' + termLower) ||
        valueLower.includes('_' + termLower) ||
        valueLower.includes('-' + termLower) ||
        valueLower.includes('.' + termLower)) {
      score += 150;
    }
    return { matches: true, score };
  }

  // Initials match (only for short search terms, likely intentional)
  if (term.length >= 2 && term.length <= 5 && matchesInitials(value, term)) {
    return { matches: true, score: 80 };
  }

  return { matches: false, score: 0 };
}

/**
 * Smart file filter with:
 * 1. Path segment matching - "comp/but" matches segments separately
 * 2. Initials/camelCase matching - "CP" matches "ChangesPanel"
 * 3. Multiple search terms - "panel tsx" requires both to match
 */
function fileFilter(value: string, search: string, keywords?: string[]): number {
  if (!search) return 1;

  const filename = keywords?.[0] || value.split('/').pop() || value;

  // Split search into terms (space-separated) and path segments (slash-separated)
  const searchTerms = search.trim().split(/\s+/).filter(Boolean);

  let totalScore = 0;

  // Each term must match somewhere
  for (const term of searchTerms) {
    let termScore = 0;
    let termMatched = false;

    // Check if term contains path separator - match segments
    if (term.includes('/')) {
      const searchSegments = term.split('/').filter(Boolean);
      const pathSegments = value.split('/');

      let segmentMatchCount = 0;
      let segmentScore = 0;

      for (const searchSeg of searchSegments) {
        // Find a path segment that matches this search segment
        for (const pathSeg of pathSegments) {
          const result = termMatches(pathSeg, searchSeg);
          if (result.matches) {
            segmentMatchCount++;
            segmentScore += result.score;
            break;
          }
        }
      }

      // All search segments must match
      if (segmentMatchCount === searchSegments.length) {
        termMatched = true;
        termScore = segmentScore + 50; // Bonus for path pattern match
      }
    } else {
      // Single term - check filename first (higher priority), then full path
      const filenameResult = termMatches(filename, term);
      const pathResult = termMatches(value, term);

      if (filenameResult.matches) {
        termMatched = true;
        termScore = filenameResult.score + 100; // Bonus for filename match
      } else if (pathResult.matches) {
        termMatched = true;
        termScore = pathResult.score;
      }
    }

    // If any term doesn't match, reject the item
    if (!termMatched) {
      return 0;
    }

    totalScore += termScore;
  }

  // Bonus for fewer path segments (more specific/shorter paths)
  const segmentCount = value.split('/').length;
  totalScore -= segmentCount * 5;

  // Bonus for shorter filenames
  totalScore -= filename.length * 0.5;

  return Math.max(1, totalScore);
}

interface FilePickerProps {
  workspaceId: string | null;
  sessionId: string | null;
}

// Flatten file tree into searchable list (exclude directories)
function flattenFileTree(nodes: FileNodeDTO[], parentPath: string = ''): FlatFile[] {
  const result: FlatFile[] = [];

  for (const node of nodes) {
    if (node.isDir) {
      // Recursively flatten children
      if (node.children) {
        result.push(...flattenFileTree(node.children, node.path));
      }
    } else {
      // Add file to list
      const directory = parentPath || node.path.split('/').slice(0, -1).join('/');
      result.push({
        path: node.path,
        name: node.name,
        directory,
      });
    }
  }

  return result;
}

export function FilePicker({ workspaceId, sessionId }: FilePickerProps) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FlatFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const cachedSessionIdRef = useRef<string | null>(null);
  const hasCacheRef = useRef(false);
  const listRef = useRef<React.ElementRef<typeof CommandPrimitive.List>>(null);

  const { openFileTab } = useAppStore();

  // Register Cmd+P shortcut
  useShortcut('filePicker', useCallback(() => {
    setOpen((prev) => !prev);
  }, []));

  // Reset search value when dialog closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchValue('');
    }
  }, [open]);

  // Scroll to top when search value changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [searchValue]);

  // Listen for custom event (from menu or other triggers)
  useEffect(() => {
    const handleOpenEvent = () => setOpen(true);
    window.addEventListener('open-file-picker', handleOpenEvent);
    return () => window.removeEventListener('open-file-picker', handleOpenEvent);
  }, []);

  // Fetch files when dialog opens (with caching per session)
  useEffect(() => {
    if (!open || !workspaceId || !sessionId) return;

    // Use cache if same session and cache is valid
    if (cachedSessionIdRef.current === sessionId && hasCacheRef.current) {
      return;
    }

    let cancelled = false;
    // Defer state update to avoid synchronous setState in effect
    queueMicrotask(() => {
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
    });

    listSessionFiles(workspaceId, sessionId, 'all')
      .then((data) => {
        if (!cancelled) {
          const flatFiles = flattenFileTree(data);
          setFiles(flatFiles);
          cachedSessionIdRef.current = sessionId;
          hasCacheRef.current = true;
        }
      })
      .catch((err) => {
        console.error('Failed to load files:', err);
        if (!cancelled) {
          setFiles([]);
          setError('Failed to load files. Please try again.');
          hasCacheRef.current = false;
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, sessionId]);

  // Clear cache when session changes
  useEffect(() => {
    if (sessionId !== cachedSessionIdRef.current) {
      // Defer state update to avoid synchronous setState in effect
      queueMicrotask(() => {
        setFiles([]);
        setError(null);
      });
      cachedSessionIdRef.current = null;
      hasCacheRef.current = false;
    }
  }, [sessionId]);

  // Handle file selection - creates session-scoped tab
  const handleFileSelect = useCallback(
    (file: FlatFile) => {
      if (!workspaceId || !sessionId) return;

      // Tab ID format matches ChangesPanel pattern
      const tabId = `${workspaceId}-${sessionId}-${file.path}`;

      const newTab: FileTab = {
        id: tabId,
        workspaceId,
        sessionId, // Session-scoped!
        path: file.path,
        name: file.name,
        viewMode: 'file',
      };

      openFileTab(newTab);
      setOpen(false);

      // Content is loaded lazily by ConversationArea useEffect when tab becomes active
    },
    [workspaceId, sessionId, openFileTab]
  );

  return (
    <CommandDialog
      variant="spotlight"
      open={open}
      onOpenChange={setOpen}
      title="Open File"
      description="Search for a file to open..."
      showCloseButton={false}
      filter={fileFilter}
    >
      <CommandInput
        placeholder="Search files..."
        value={searchValue}
        onValueChange={setSearchValue}
      />
      <CommandList ref={listRef} className="max-h-[400px]">
        {isLoading ? (
          <div className="p-2 space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded">
                <Skeleton variant="default" className="w-4 h-4" />
                <Skeleton variant="text" className="h-4 flex-1" />
                <Skeleton variant="text" className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <CommandEmpty>No files found.</CommandEmpty>
            <CommandGroup heading="Files">
              {files.map((file) => (
                <CommandItem
                  key={file.path}
                  value={file.path}
                  keywords={[file.name]}
                  onSelect={() => handleFileSelect(file)}
                >
                  <FileIcon filename={file.name} className="mr-2" />
                  <span className="flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {file.directory}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
