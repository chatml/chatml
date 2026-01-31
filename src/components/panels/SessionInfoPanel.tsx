'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds, useSessionConversations } from '@/stores/selectors';
import { copyToClipboard } from '@/lib/tauri';
import { updateSession as apiUpdateSession } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import type { SessionPriority, SessionTaskStatus } from '@/lib/types';
import { PrioritySelector } from '@/components/shared/PrioritySelector';
import { TaskStatusSelector } from '@/components/shared/TaskStatusSelector';
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
  Copy,
  Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoDate: string): string {
  const ms = new Date(isoDate).getTime();
  if (isNaN(ms)) return '—';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-medium text-foreground/60 uppercase tracking-wider pt-1">
      {label}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [text],
  );
  return (
    <button
      onClick={handleCopy}
      className="ml-1 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3 h-3 text-text-success" />
      ) : (
        <Copy className="w-3 h-3 text-muted-foreground" />
      )}
    </button>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  copyValue,
  mono,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  copyValue?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="group/row flex items-center justify-between text-xs gap-2 min-h-[20px]">
      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
        {Icon && <Icon className="w-3 h-3 shrink-0" />}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'flex items-center text-right truncate min-w-0',
          mono && 'font-mono text-[11px]',
          className,
        )}
      >
        <span className="truncate">{value}</span>
        {copyValue && <CopyButton text={copyValue} />}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active: 'bg-text-success',
    idle: 'bg-muted-foreground',
    done: 'bg-blue-500',
    error: 'bg-text-error',
  };
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          colorMap[status] || 'bg-muted-foreground',
        )}
      />
      <span className="capitalize">{status}</span>
    </span>
  );
}

function PrStatusBadge({
  status,
  prNumber,
  prUrl,
}: {
  status: string;
  prNumber?: number;
  prUrl?: string;
}) {
  const colorMap: Record<string, string> = {
    open: 'text-text-success',
    merged: 'text-purple-400',
    closed: 'text-text-error',
    none: 'text-muted-foreground',
  };

  if (status === 'none') {
    return <span className="text-muted-foreground">None</span>;
  }

  const label = prNumber ? `#${prNumber}` : status;

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('hover:underline capitalize', colorMap[status])}
      >
        {label} &middot; {status}
      </a>
    );
  }

  return (
    <span className={cn('capitalize', colorMap[status])}>
      {label} &middot; {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
    : '—';

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
