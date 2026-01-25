'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSelectedIds, useFileTabState } from '@/stores/selectors';
import { EmptyState } from '@/components/ui/empty-state';
import { GitCommitHorizontal, FileQuestion, Loader2 } from 'lucide-react';
import {
  getFileCommitHistory,
  getFileAtCommit,
  getSessionFileContent,
  type FileCommitDTO,
} from '@/lib/api';

const ITEM_HEIGHT = 56; // Estimated height per commit row in pixels
const OVERSCAN = 5; // Extra items to render above/below viewport

/**
 * Format a relative time string from an ISO timestamp.
 */
function formatRelativeTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) {
      return 'unknown';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  } catch {
    return 'unknown';
  }
}

export function FileHistoryPanel() {
  const { selectedWorkspaceId, selectedSessionId } = useSelectedIds();
  const { fileTabs, selectedFileTabId, openFileTab, updateFileTab } = useFileTabState();

  const [commits, setCommits] = useState<FileCommitDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Virtual scroll state
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Track if component is mounted
  const isMountedRef = useRef(false);

  // Get current file from selected tab
  const currentFileTab = useMemo(() => {
    if (!selectedFileTabId || !selectedSessionId) return null;
    return fileTabs.find((t) => t.id === selectedFileTabId && t.sessionId === selectedSessionId);
  }, [fileTabs, selectedFileTabId, selectedSessionId]);

  const currentFilePath = currentFileTab?.path;

  // Fetch function that handles all state updates
  const fetchHistory = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId || !currentFilePath) {
      setCommits([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getFileCommitHistory(selectedWorkspaceId, selectedSessionId, currentFilePath);
      if (isMountedRef.current) {
        setCommits(data.commits);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
        setCommits([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [selectedWorkspaceId, selectedSessionId, currentFilePath]);

  // Fetch file history when file changes
  useEffect(() => {
    isMountedRef.current = true;
    fetchHistory();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchHistory]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Calculate virtual window
  const { startIndex, endIndex, paddingTop, paddingBottom } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(commits.length, start + visibleCount);

    return {
      startIndex: start,
      endIndex: end,
      paddingTop: start * ITEM_HEIGHT,
      paddingBottom: Math.max(0, (commits.length - end) * ITEM_HEIGHT),
    };
  }, [scrollTop, containerHeight, commits.length]);

  const visibleCommits = useMemo(
    () => commits.slice(startIndex, endIndex),
    [commits, startIndex, endIndex]
  );

  // Handle commit click - show diff
  const handleCommitClick = useCallback(
    async (commit: FileCommitDTO) => {
      if (!selectedWorkspaceId || !selectedSessionId || !currentFilePath || !currentFileTab) return;

      const tabId = `history-diff-${currentFilePath}-${commit.sha}`;
      const filename = currentFilePath.split('/').pop() || currentFilePath;

      // Open tab with loading state
      openFileTab({
        id: tabId,
        workspaceId: selectedWorkspaceId,
        sessionId: selectedSessionId,
        path: currentFilePath,
        name: `${filename} @ ${commit.shortSha}`,
        isLoading: true,
        viewMode: 'diff',
      });

      try {
        // Fetch old content (at commit) and current content in parallel
        const [oldContentResult, currentContentResult] = await Promise.all([
          getFileAtCommit(selectedWorkspaceId, selectedSessionId, currentFilePath, commit.sha),
          getSessionFileContent(selectedWorkspaceId, selectedSessionId, currentFilePath),
        ]);

        updateFileTab(tabId, {
          diff: {
            oldContent: oldContentResult.content,
            newContent: currentContentResult.content,
          },
          isLoading: false,
        });
      } catch (err) {
        updateFileTab(tabId, {
          isLoading: false,
          content: `// Error loading diff: ${err instanceof Error ? err.message : 'Unknown error'}`,
          viewMode: 'file',
        });
      }
    },
    [selectedWorkspaceId, selectedSessionId, currentFilePath, currentFileTab, openFileTab, updateFileTab]
  );

  // Empty states
  if (!currentFilePath) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={FileQuestion}
          title="No file selected"
          description="Select a file to view its commit history"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState icon={GitCommitHorizontal} title="Error loading history" description={error} />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={GitCommitHorizontal}
          title="No commit history"
          description="This file has no git history yet"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto" onScroll={handleScroll}>
      <div style={{ height: commits.length * ITEM_HEIGHT }}>
        <div style={{ paddingTop, paddingBottom }}>
          {visibleCommits.map((commit) => (
            <CommitRow key={commit.sha} commit={commit} onClick={() => handleCommitClick(commit)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommitRow({ commit, onClick }: { commit: FileCommitDTO; onClick: () => void }) {
  const timeAgo = useMemo(() => formatRelativeTime(commit.timestamp), [commit.timestamp]);

  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 hover:bg-surface-2 cursor-pointer group"
      style={{ height: ITEM_HEIGHT }}
      onClick={onClick}
    >
      <GitCommitHorizontal className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" title={commit.message}>
          {commit.message}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{commit.shortSha}</span>
          <span className="truncate">{commit.author}</span>
          <span>{timeAgo}</span>
        </div>
        {/* Always render stats line to maintain consistent ITEM_HEIGHT for virtual scroll */}
        <div className="text-[11px] tabular-nums h-[14px]">
          {commit.additions > 0 && <span className="text-text-success">+{commit.additions}</span>}
          {commit.deletions > 0 && (
            <span className="text-text-error ml-1">-{commit.deletions}</span>
          )}
        </div>
      </div>
    </div>
  );
}
