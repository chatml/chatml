'use client';

import type { WorktreeSession, Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  Folder,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';

interface WorkspaceTreeItemProps {
  workspace: Workspace;
  sessions: WorktreeSession[];
  isExpanded: boolean;
  selectedSessionId: string | null;
  onToggle: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function WorkspaceTreeItem({
  workspace,
  sessions,
  isExpanded,
  selectedSessionId,
  onToggle,
  onSelectSession,
}: WorkspaceTreeItemProps) {
  // Get PR status display info
  const getPRStatusInfo = (session: WorktreeSession) => {
    const hasPR = session.prStatus && session.prStatus !== 'none';
    if (!hasPR) return null;

    if (session.hasMergeConflict) {
      return { text: 'Merge conflict', color: 'text-text-warning', icon: AlertTriangle };
    }
    if (session.hasCheckFailures) {
      return { text: 'Checks failing', color: 'text-text-error', icon: XCircle };
    }
    if (session.prStatus === 'merged') {
      return { text: 'Merged', color: 'text-brand', icon: CheckCircle2 };
    }
    if (session.prStatus === 'open') {
      if (session.checkStatus === 'pending') {
        return { text: 'Checks running', color: 'text-amber-500', icon: AlertTriangle };
      }
      return { text: 'Ready to merge', color: 'text-text-success', icon: CheckCircle2 };
    }
    return null;
  };

  return (
    <div className="mb-1">
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        {/* Workspace Header */}
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              'group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer',
              'hover:bg-surface-1 transition-colors'
            )}
          >
            <Folder className="w-4 h-4 text-brand/60 shrink-0" />
            <span className="text-sm font-medium truncate flex-1">
              {workspace.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {sessions.length}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
                !isExpanded && '-rotate-90'
              )}
            />
          </div>
        </CollapsibleTrigger>

        {/* Sessions List */}
        <CollapsibleContent>
          <div className="ml-4 border-l border-sidebar-border">
            {sessions.length === 0 ? (
              <div className="py-2 px-3 text-xs text-muted-foreground/70">
                No active sessions
              </div>
            ) : (
              sessions.map((session) => {
                const isSelected = selectedSessionId === session.id;
                const hasPR = session.prStatus && session.prStatus !== 'none';
                const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);
                const prStatusInfo = getPRStatusInfo(session);

                return (
                  <div
                    key={session.id}
                    className={cn(
                      'flex items-start gap-2 px-3 py-1.5 cursor-pointer',
                      isSelected
                        ? 'bg-surface-2 text-foreground'
                        : 'hover:bg-surface-1 text-foreground/70'
                    )}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="flex-1 min-w-0">
                      {/* Branch name with status icon */}
                      <div className="flex items-center gap-1.5">
                        <TaskStatusIcon status={session.taskStatus} className="w-3 h-3 shrink-0" />
                        <span className="text-xs font-medium truncate">
                          {session.branch || session.name}
                        </span>
                      </div>

                      {/* PR info and stats */}
                      <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground">
                        {hasPR && session.prNumber && (
                          <span>PR #{session.prNumber}</span>
                        )}
                        {prStatusInfo && (
                          <span className={prStatusInfo.color}>
                            {prStatusInfo.text}
                          </span>
                        )}
                        {hasStats && (
                          <span className="font-mono">
                            <span className="text-text-success">+{session.stats!.additions}</span>
                            <span className="text-text-error ml-1">-{session.stats!.deletions}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
