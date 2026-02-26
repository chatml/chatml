'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  formatRelativeTime,
  SectionHeader,
  InfoRow,
  StatusDot,
  PrStatusBadge,
} from '@/components/shared/SessionInfoParts';
import type { WorktreeSession, Workspace } from '@/lib/types';
import {
  Archive,
  GitBranch,
  FolderOpen,
  HardDrive,
  GitPullRequest,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  ListChecks,
  Plus,
  Minus,
  Loader2,
} from 'lucide-react';
import { DialogMarkdown } from '@/components/shared/DialogMarkdown';

interface ArchivedSessionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorktreeSession;
  workspace: Workspace;
  onRestore: () => void;
}

export function ArchivedSessionPreviewDialog({
  open,
  onOpenChange,
  session,
  workspace,
  onRestore,
}: ArchivedSessionPreviewDialogProps) {
  const worktreeDisplay = session.worktreePath
    ? session.worktreePath.split('/').slice(-3).join('/')
    : '\u2014';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 overflow-hidden">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Archive className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono truncate">{session.branch}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] px-4">
          <div className="space-y-3 pb-4">
            {/* Session Identity */}
            <div className="space-y-1.5">
              <SectionHeader label="Session" />
              <InfoRow label="Name" value={session.name} />
              <InfoRow
                icon={GitBranch}
                label="Branch"
                value={session.branch}
                copyValue={session.branch}
                mono
              />
              <InfoRow icon={FolderOpen} label="Workspace" value={workspace.name} />
              {session.worktreePath && (
                <InfoRow
                  icon={HardDrive}
                  label="Worktree"
                  value={worktreeDisplay}
                  copyValue={session.worktreePath}
                  mono
                />
              )}
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <SectionHeader label="Status" />
              <InfoRow label="Agent" value={<StatusDot status={session.status} />} />
              {session.prStatus && session.prStatus !== 'none' && (
                <InfoRow
                  icon={GitPullRequest}
                  label="PR"
                  value={
                    <PrStatusBadge
                      status={session.prStatus}
                      prNumber={session.prNumber}
                      prUrl={session.prUrl}
                      checkStatus={session.checkStatus}
                    />
                  }
                />
              )}
              {session.hasMergeConflict && (
                <InfoRow
                  icon={AlertTriangle}
                  label="Conflict"
                  value={<span className="text-text-warning">Merge conflict</span>}
                />
              )}
              {session.hasCheckFailures && (
                <InfoRow
                  icon={XCircle}
                  label="Checks"
                  value={<span className="text-text-error">Failing</span>}
                />
              )}
            </div>

            {/* Git Stats */}
            {session.stats && (
              <div className="space-y-1.5">
                <SectionHeader label="Git" />
                <InfoRow
                  label="Changes"
                  value={
                    <span className="flex items-center gap-2">
                      <span className="flex items-center gap-0.5 text-text-success">
                        <Plus className="w-3 h-3" />
                        {session.stats.additions}
                      </span>
                      <span className="flex items-center gap-0.5 text-text-error">
                        <Minus className="w-3 h-3" />
                        {session.stats.deletions}
                      </span>
                    </span>
                  }
                />
              </div>
            )}

            {/* Activity */}
            <div className="space-y-1.5">
              <SectionHeader label="Activity" />
              <InfoRow
                icon={Clock}
                label="Created"
                value={formatRelativeTime(session.createdAt)}
              />
              <InfoRow
                icon={RefreshCw}
                label="Updated"
                value={formatRelativeTime(session.updatedAt)}
              />
            </div>

            {/* Task */}
            {session.task && (
              <div className="space-y-1.5">
                <SectionHeader label="Task" />
                <div className="flex items-start gap-1.5 text-xs">
                  <ListChecks className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                  <p className="text-foreground/80 leading-relaxed break-words min-w-0">
                    {session.task}
                  </p>
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="space-y-1.5">
              <SectionHeader label="Summary" />
              {session.archiveSummaryStatus === 'generating' ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Generating summary...</span>
                </div>
              ) : session.archiveSummaryStatus === 'completed' && session.archiveSummary ? (
                <DialogMarkdown
                  cacheKey={`archive-summary:${session.id}`}
                  content={session.archiveSummary}
                />
              ) : session.archiveSummaryStatus === 'failed' ? (
                <div className="flex items-center gap-2 text-xs text-text-error/80 py-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>Summary generation failed</span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-1">
                  No summary available
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-4 py-3 border-t">
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onRestore();
            }}
          >
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
