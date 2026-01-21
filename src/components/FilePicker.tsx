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
import { listSessionFiles, type FileNodeDTO } from '@/lib/api';
import { FileIcon } from '@/components/FileTree';
import { Skeleton } from '@/components/ui/skeleton';
import type { FileTab } from '@/lib/types';

interface FlatFile {
  path: string;      // Full relative path (e.g., "src/components/Button.tsx")
  name: string;      // Filename only (e.g., "Button.tsx")
  directory: string; // Parent directory for display (e.g., "src/components")
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
  const cachedSessionIdRef = useRef<string | null>(null);
  const hasCacheRef = useRef(false);

  const { openFileTab } = useAppStore();

  // Listen for Cmd+P keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'p' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    >
      <CommandInput placeholder="Search files..." />
      <CommandList className="max-h-[400px]">
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
                  value={`${file.name} ${file.path}`}
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
