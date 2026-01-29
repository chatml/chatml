'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useActiveTabSelection, useFileTabState } from '@/stores/selectors';
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
const FOOTER_HEIGHT = 48; // Height for end of history message

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
  const { selectedWorkspaceId, selectedSessionId } = useActiveTabSelection();
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
  const { startIndex, endIndex, offsetTop, totalHeight, showFooter } = useMemo(() => {
    const itemsHeight = commits.length * ITEM_HEIGHT;
    const total = commits.length > 0 ? itemsHeight + FOOTER_HEIGHT : 0;
    // If container height isn't measured yet, render enough items to fill a reasonable viewport
    const effectiveHeight = containerHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(effectiveHeight / ITEM_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(commits.length, start + visibleCount);

    // Show footer when scrolled near the bottom
    const footerVisible = scrollTop + effectiveHeight >= itemsHeight;

    return {
      startIndex: start,
      endIndex: end,
      offsetTop: start * ITEM_HEIGHT,
      totalHeight: total,
      showFooter: footerVisible && commits.length > 0,
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
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleCommits.map((commit, index) => {
          const actualIndex = startIndex + index;
          const isLast = actualIndex === commits.length - 1;
          return (
            <div
              key={commit.sha}
              style={{
                position: 'absolute',
                top: offsetTop + index * ITEM_HEIGHT,
                left: 0,
                right: 0,
                height: ITEM_HEIGHT,
              }}
            >
              <CommitRow commit={commit} onClick={() => handleCommitClick(commit)} isLast={isLast} />
            </div>
          );
        })}
        {/* End of history message */}
        {showFooter && (
          <div
            style={{
              position: 'absolute',
              top: commits.length * ITEM_HEIGHT,
              left: 0,
              right: 0,
              height: FOOTER_HEIGHT,
            }}
            className="flex items-center justify-center text-xs text-muted-foreground/60"
          >
            — Beginning of file history —
          </div>
        )}
      </div>
    </div>
  );
}

function CommitRow({ commit, onClick, isLast }: { commit: FileCommitDTO; onClick: () => void; isLast: boolean }) {
  const timeAgo = useMemo(() => formatRelativeTime(commit.timestamp), [commit.timestamp]);

  return (
    <div className="flex items-start gap-1 px-2 py-1 h-full">
      {/* Timeline node with connecting line */}
      <div className="relative shrink-0 flex flex-col items-center pt-1">
        <GitCommitHorizontal className="w-4 h-4 text-blue-500 relative z-10" />
        {/* Vertical line connecting to next commit */}
        {!isLast && (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 w-0.5 bg-blue-500/40 h-[calc(56px-20px)]" />
        )}
      </div>
      {/* Card content */}
      <div
        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer group"
        onClick={onClick}
      >
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
