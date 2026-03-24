'use client';

import { useState } from 'react';
import {
  FolderGit2,
  GitBranch,
  GitPullRequest,
  MessageCircleQuestion,
  ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { SessionHoverCardBody } from '@/components/shared/SessionHoverCard';
import { useSessionActivityState, useIsSessionUnread } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { useBaseSessionGitStatus } from '@/hooks/useBaseSessionGitStatus';
import { dispatchAppEvent } from '@/lib/custom-events';
import type { WorktreeSession } from '@/lib/types';
import type { ContentView } from '@/stores/settingsStore';

interface BaseSessionCardProps {
  session: WorktreeSession;
  contentView: ContentView;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string, event?: React.MouseEvent) => void;
  onOpenBranches?: (event?: React.MouseEvent) => void;
  onOpenPRs?: (event?: React.MouseEvent) => void;
  formatTimeAgo: (date: string) => string;
}

export function BaseSessionCard({
  session,
  contentView,
  selectedSessionId,
  onSelectSession,
  onOpenBranches,
  onOpenPRs,
  formatTimeAgo,
}: BaseSessionCardProps) {
  const isSessionSelected = contentView.type === 'conversation' && selectedSessionId === session.id;
  const sessionId = session.id;
  const activityState = useSessionActivityState(sessionId);
  const isSessionUnread = useIsSessionUnread(sessionId);
  const lastAgentCompletedAt = useAppStore((s) => s.lastTurnCompletedAt[sessionId]);
  const [hoverOpen, setHoverOpen] = useState(false);

  const { gitStatus, loading } = useBaseSessionGitStatus(
    session.workspaceId,
    sessionId,
    true,
  );

  // Build status chips
  const statusChips: { text: string; color: string }[] = [];
  if (gitStatus) {
    if (gitStatus.workingDirectory.hasChanges) {
      const count = gitStatus.workingDirectory.totalUncommitted;
      statusChips.push({
        text: `${count} uncommitted`,
        color: 'text-amber-500',
      });
    } else {
      statusChips.push({ text: 'Clean', color: 'text-text-success' });
    }

    if (gitStatus.sync.aheadBy > 0) {
      statusChips.push({
        text: `${gitStatus.sync.aheadBy}\u2191`,
        color: 'text-muted-foreground',
      });
    }
    if (gitStatus.sync.behindBy > 0) {
      statusChips.push({
        text: `${gitStatus.sync.behindBy}\u2193`,
        color: 'text-muted-foreground',
      });
    }
  }

  // Activity icon overlay
  const activityIcon =
    activityState === 'working' ? (
      <div className="session-active-indicator">
        <div className="bar" />
        <div className="bar" />
        <div className="bar" />
      </div>
    ) : activityState === 'awaiting_input' ? (
      <MessageCircleQuestion className="w-3.5 h-3.5 text-purple-500" />
    ) : activityState === 'awaiting_approval' ? (
      <ClipboardCheck className="w-3.5 h-3.5 text-blue-500" />
    ) : (
      <FolderGit2 className="w-4 h-4 text-blue-500" />
    );

  return (
    <ContextMenu onOpenChange={(open) => { if (open) setHoverOpen(false); }}>
      <ContextMenuTrigger asChild>
        <HoverCard openDelay={500} closeDelay={100} open={hoverOpen} onOpenChange={setHoverOpen}>
          <HoverCardTrigger asChild>
            <div
              className={cn(
                'group relative flex flex-col gap-1 rounded-lg border px-2.5 py-2 my-0.5 cursor-pointer transition-colors',
                isSessionSelected
                  ? 'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15'
                  : 'bg-blue-500/[0.04] border-blue-500/10 hover:bg-blue-500/[0.07]',
              )}
              onClick={(e) => onSelectSession(session.id, e)}
            >
              {/* Unread indicator */}
              {isSessionUnread && !isSessionSelected && (
                <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand" />
              )}

              {/* Row 1: Icon + branch name + Base badge */}
              <div className="flex items-center gap-1.5">
                <div className="w-4 shrink-0 flex items-center justify-center">
                  {activityIcon}
                </div>
                <span className={cn(
                  'text-base truncate flex-1 min-w-0',
                  isSessionSelected ? 'text-foreground font-medium' : 'text-foreground/80 font-medium',
                )}>
                  {session.branch || session.name}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium shrink-0">
                  Base
                </span>
              </div>

              {/* Row 2: Git status chips */}
              <div className="flex items-center gap-1 pl-[22px] text-xs text-muted-foreground">
                {loading ? (
                  <div className="w-24 h-3 rounded bg-muted animate-pulse" />
                ) : (
                  <>
                    {statusChips.map((chip, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-muted-foreground/40">&middot;</span>}
                        <span className={chip.color}>{chip.text}</span>
                      </span>
                    ))}
                    {statusChips.length > 0 && (
                      <span className="text-muted-foreground/40">&middot;</span>
                    )}
                    <span className="shrink-0">
                      {formatTimeAgo(
                        lastAgentCompletedAt !== undefined && lastAgentCompletedAt > new Date(session.updatedAt).getTime()
                          ? new Date(lastAgentCompletedAt).toISOString()
                          : session.updatedAt
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>
          </HoverCardTrigger>
          <HoverCardContent side="right" align="start" sideOffset={8} className="w-72 p-0">
            <SessionHoverCardBody
              session={session}
              formatTimeAgo={formatTimeAgo}
              lastAgentCompletedAt={lastAgentCompletedAt}
              onCreatePR={() => {
                setHoverOpen(false);
                onSelectSession(session.id);
                requestAnimationFrame(() => dispatchAppEvent('git-create-pr'));
              }}
            />
          </HoverCardContent>
        </HoverCard>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onOpenBranches && (
          <ContextMenuItem onClick={() => onOpenBranches()}>
            <GitBranch className="h-4 w-4" />
            Branches
          </ContextMenuItem>
        )}
        {onOpenPRs && (
          <ContextMenuItem onClick={() => onOpenPRs()}>
            <GitPullRequest className="h-4 w-4" />
            Pull Requests
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
