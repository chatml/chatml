'use client';

import { useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds, useSessionConversations } from '@/stores/selectors';
import { updateSession as apiUpdateSession } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import type { SessionPriority, SessionTaskStatus } from '@/lib/types';
import { PrioritySelector } from '@/components/shared/PrioritySelector';
import { TaskStatusSelector } from '@/components/shared/TaskStatusSelector';
import { TargetBranchSelector } from '@/components/shared/TargetBranchSelector';
import {
  formatRelativeTime,
  SectionHeader,
  InfoRow,
  StatusDot,
  PrStatusBadge,
} from '@/components/shared/SessionInfoParts';
import {
  Info,
  GitBranch,
  FolderOpen,
  HardDrive,
  GitPullRequest,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  MessageSquare,
  ListChecks,
  Plus,
  Minus,
  GitCompare,
} from 'lucide-react';

export function SessionInfoPanel() {
  const { selectedWorkspaceId, selectedSessionId } = useSelectedIds();
  const session = useAppStore((s) =>
    selectedSessionId ? s.sessions.find((sess) => sess.id === selectedSessionId) ?? null : null,
  );
  const workspace = useAppStore((s) =>
    selectedWorkspaceId ? s.workspaces.find((w) => w.id === selectedWorkspaceId) ?? null : null,
  );
  const branchSync = useAppStore((s) =>
    selectedSessionId ? s.branchSyncStatus[selectedSessionId] ?? null : null,
  );
  const conversations = useSessionConversations(selectedSessionId);
  const storeUpdateSession = useAppStore((s) => s.updateSession);
  const { error: showError } = useToast();

  const handlePriorityChange = useCallback((value: SessionPriority) => {
    if (!session || !selectedWorkspaceId) return;
    const prev = session.priority;
    storeUpdateSession(session.id, { priority: value });
    apiUpdateSession(selectedWorkspaceId, session.id, { priority: value }).catch(() => {
      storeUpdateSession(session.id, { priority: prev });
      showError('Failed to update priority');
    });
  }, [session, selectedWorkspaceId, storeUpdateSession, showError]);

  const handleTaskStatusChange = useCallback((value: SessionTaskStatus) => {
    if (!session || !selectedWorkspaceId) return;
    const prev = session.taskStatus;
    storeUpdateSession(session.id, { taskStatus: value });
    apiUpdateSession(selectedWorkspaceId, session.id, { taskStatus: value }).catch(() => {
      storeUpdateSession(session.id, { taskStatus: prev });
      showError('Failed to update task status');
    });
  }, [session, selectedWorkspaceId, storeUpdateSession, showError]);

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Info}
          title="No session selected"
          description="Select a session to view its details"
        />
      </div>
    );
  }

  // Conversation counts by type
  const counts = { task: 0, review: 0, chat: 0 };
  for (const c of conversations) {
    if (c.type in counts) counts[c.type as keyof typeof counts]++;
  }
  const convParts: string[] = [];
  if (counts.task > 0) convParts.push(`${counts.task} task`);
  if (counts.review > 0) convParts.push(`${counts.review} review`);
  if (counts.chat > 0) convParts.push(`${counts.chat} chat`);
  const convSummary = convParts.length > 0 ? convParts.join(', ') : 'None';

  // Worktree display — show last 2-3 path segments
  const worktreeDisplay = session.worktreePath
    ? session.worktreePath.split('/').slice(-3).join('/')
    : '\u2014';

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
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
          {workspace && (
            <TargetBranchSelector
              sessionId={session.id}
              workspaceId={workspace.id}
              currentTargetBranch={session.targetBranch}
              workspaceDefaultBranch={workspace.defaultBranch || 'main'}
              workspaceRemote={workspace.remote || 'origin'}
              variant="panel"
            />
          )}
          {workspace && (
            <InfoRow icon={FolderOpen} label="Workspace" value={workspace.name} />
          )}
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
          <InfoRow
            label="Task Status"
            value={
              <TaskStatusSelector
                value={session.taskStatus}
                onChange={handleTaskStatusChange}
                size="sm"
                showLabel
              />
            }
          />
          <InfoRow
            label="Priority"
            value={
              <PrioritySelector
                value={session.priority}
                onChange={handlePriorityChange}
                size="sm"
                showLabel
              />
            }
          />
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
        {(session.stats || branchSync) && (
          <div className="space-y-1.5">
            <SectionHeader label="Git" />
            {session.stats && (
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
            )}
            {branchSync && (
              <InfoRow
                icon={GitCompare}
                label="Sync"
                value={
                  branchSync.behindBy > 0 ? (
                    <span className="text-text-warning">
                      {branchSync.behindBy} behind {branchSync.baseBranch.replace('origin/', '')}
                    </span>
                  ) : (
                    <span className="text-text-success">Up to date</span>
                  )
                }
              />
            )}
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
          <InfoRow
            icon={MessageSquare}
            label="Conversations"
            value={convSummary}
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
      </div>
    </ScrollArea>
  );
}
