'use client';

import { useState, useCallback, useMemo } from 'react';
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
import { GitBranch, FolderGit2, GitPullRequest } from 'lucide-react';

interface SearchableItem {
  sessionId: string;
  workspaceId: string;
  sessionName: string;
  branch: string;
  workspaceName: string;
  prNumber?: number;
}

/**
 * Custom filter for workspace search.
 * Matches against branch name, workspace/repo name, PR number, and session name.
 * The `value` is the session ID, and `keywords` contains the searchable fields.
 */
function workspaceFilter(_value: string, search: string, keywords?: string[]): number {
  if (!search) return 1;
  if (!keywords || keywords.length === 0) return 0;

  const searchLower = search.toLowerCase().replace(/^#+/, '');
  const terms = searchLower.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;

  let totalScore = 0;

  for (const term of terms) {
    let bestScore = 0;

    for (const keyword of keywords) {
      const kwLower = keyword.toLowerCase();

      if (kwLower === term) {
        bestScore = Math.max(bestScore, 1000);
      } else if (kwLower.startsWith(term)) {
        bestScore = Math.max(bestScore, 500);
      } else if (kwLower.includes(term)) {
        bestScore = Math.max(bestScore, 200);
      }
    }

    if (bestScore === 0) return 0; // Every term must match something
    totalScore += bestScore;
  }

  return totalScore;
}

export function WorkspaceSearch() {
  const [open, setOpen] = useState(false);

  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const selectSession = useAppStore((s) => s.selectSession);

  useShortcut('workspaceSearch', useCallback(() => {
    setOpen((prev) => !prev);
  }, []));

  const items: SearchableItem[] = useMemo(() => {
    const workspaceMap = new Map(workspaces.map((w) => [w.id, w]));

    return sessions
      .filter((s) => !s.archived)
      .map((session) => {
        const workspace = workspaceMap.get(session.workspaceId);
        return {
          sessionId: session.id,
          workspaceId: session.workspaceId,
          sessionName: session.name,
          branch: session.branch,
          workspaceName: workspace?.name ?? '',
          prNumber: session.prNumber,
        };
      });
  }, [workspaces, sessions]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      const item = items.find((i) => i.sessionId === sessionId);
      if (!item) return;

      selectWorkspace(item.workspaceId);
      selectSession(item.sessionId);
      setOpen(false);
    },
    [items, selectWorkspace, selectSession]
  );

  return (
    <CommandDialog
      variant="spotlight"
      open={open}
      onOpenChange={setOpen}
      title="Search Workspaces"
      description="Search by branch name, repository, or PR number..."
      showCloseButton={false}
      filter={workspaceFilter}
    >
      <CommandInput placeholder="Search workspaces..." />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>No workspaces found.</CommandEmpty>
        <CommandGroup heading="Workspaces">
          {items.map((item) => (
            <CommandItem
              key={item.sessionId}
              value={item.sessionId}
              keywords={[
                item.branch,
                item.workspaceName,
                item.sessionName,
                ...(item.prNumber ? [String(item.prNumber), `#${item.prNumber}`] : []),
              ]}
              onSelect={handleSelect}
            >
              <GitBranch className="shrink-0 text-muted-foreground" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate text-sm">{item.sessionName}</span>
                <span className="truncate text-xs text-muted-foreground">{item.branch}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                {item.prNumber != null && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <GitPullRequest className="size-3" />
                    #{item.prNumber}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground max-w-[150px] truncate">
                  <FolderGit2 className="size-3 shrink-0" />
                  {item.workspaceName}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
