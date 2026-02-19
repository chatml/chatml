'use client';

import { useCallback, useMemo, useState } from 'react';
import Image from 'next/image';
import { useWorkspaceSelection, useSessionActivityState } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { PrimaryActionButton } from '@/components/shared/PrimaryActionButton';
import {
  sendConversationMessage,
  createConversation,
  toStoreConversation,
  getCIFailureContext,
  refreshPRStatus,
} from '@/lib/api';
import { formatCIFailureMessage } from '@/lib/check-utils';
import { useToast } from '@/components/ui/toast';
import { copyToClipboard, openInApp } from '@/lib/tauri';
import { ArchiveSessionDialog } from '@/components/dialogs/ArchiveSessionDialog';
import { CreatePRDialog } from '@/components/dialogs/CreatePRDialog';
import { openUrlInBrowser } from '@/lib/tauri';
import { useArchiveSession } from '@/hooks/useArchiveSession';
import { PRHoverCard } from '@/components/shared/PRHoverCard';
import {
  ChevronRight,
  ChevronDown,
  Eye,
  GitBranch,
  MoreVertical,
  Archive,
  Copy,
  GitMerge,
  MessageSquare,
  FileText,
  RefreshCw,
  Zap,
  Search,
  Shield,
  Gauge,
  Boxes,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { updateSession as apiUpdateSession } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import type { SessionTaskStatus } from '@/lib/types';
import { TaskStatusSelector } from '@/components/shared/TaskStatusSelector';
import { TargetBranchSelector } from '@/components/shared/TargetBranchSelector';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import type { InstalledApp } from '@/hooks/useInstalledApps';
import { useSettingsStore } from '@/stores/settingsStore';
import { getAppById, CATEGORY_LABELS } from '@/lib/openApps';
import type { AppCategory } from '@/lib/openApps';
import { getAppIcon } from '@/components/icons/AppIcons';

// ---------------------------------------------------------------------------
// Review type options for the split button popover
// ---------------------------------------------------------------------------

const REVIEW_TYPES = [
  { icon: Zap, title: 'Quick Scan', key: 'quick', description: 'Fast pass over changes — catch obvious issues and typos' },
  { icon: Search, title: 'Deep Review', key: 'deep', description: 'Thorough line-by-line analysis with detailed feedback' },
  { icon: Shield, title: 'Security Audit', key: 'security', description: 'Focus on vulnerabilities, auth gaps, and injection risks' },
  { icon: Gauge, title: 'Performance', key: 'performance', description: 'Check for regressions, memory leaks, and slow paths' },
  { icon: Boxes, title: 'Architecture', key: 'architecture', description: 'Evaluate design patterns, coupling, and separation of concerns' },
  { icon: GitMerge, title: 'Pre-merge Check', key: 'premerge', description: 'Final review before merge — verify tests, conflicts, and coverage' },
] as const;

function dispatchReview(type: string) {
  window.dispatchEvent(new CustomEvent('start-review', { detail: { type } }));
}

// ---------------------------------------------------------------------------
// SessionToolbarContent — sets MainToolbar content for the session view
// ---------------------------------------------------------------------------

/**
 * Headless component that sets the MainToolbar content for the session view.
 * Renders the workspace dot + name + chevron + branch icon + session name.
 */
export function SessionToolbarContent() {
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();
  const selectedConversationId = useAppStore((s) => s.selectedConversationId);
  const addConversation = useAppStore((s) => s.addConversation);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const { success: showSuccess, error: showError, warning: showWarning } = useToast();
  const [showCreatePRDialog, setShowCreatePRDialog] = useState(false);
  const [reviewPopoverOpen, setReviewPopoverOpen] = useState(false);
  const [openAppPopoverOpen, setOpenAppPopoverOpen] = useState(false);
  const { installedApps } = useInstalledApps();
  const defaultOpenApp = useSettingsStore((s) => s.defaultOpenApp);
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);
  const { requestArchive, dialogProps: archiveDialogProps } = useArchiveSession({
    onSuccess: () => showSuccess('Session archived'),
    onError: () => showError('Failed to archive session'),
  });

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const sessionActivityState = useSessionActivityState(selectedSessionId ?? '');
  const isAgentWorking = sessionActivityState === 'working';

  const handleGitActionMessage = useCallback((content: string) => {
    if (!selectedConversationId) {
      showWarning('No active conversation');
      return;
    }
    sendConversationMessage(selectedConversationId, content).catch(console.error);
  }, [selectedConversationId, showWarning]);

  const [, setFixIssuesLoading] = useState(false);

  const handleFixIssues = useCallback(async () => {
    if (!selectedConversationId || !selectedWorkspaceId || !selectedSessionId) {
      showWarning('No active conversation');
      return;
    }

    setFixIssuesLoading(true);
    try {
      const context = await getCIFailureContext(selectedWorkspaceId, selectedSessionId);

      if (context.failedRuns.length === 0) {
        showWarning('No CI failures found. Checks may have passed.');
        return;
      }

      const message = formatCIFailureMessage(context);
      await sendConversationMessage(selectedConversationId, message);
    } catch (error) {
      console.error('Failed to fetch CI failure context:', error);
      // Fallback to generic message
      try {
        await sendConversationMessage(selectedConversationId, 'Fix the failing CI checks');
        showWarning('Could not fetch CI details. Sent generic request.');
      } catch {
        showWarning('Failed to send message to agent.');
      }
    } finally {
      setFixIssuesLoading(false);
    }
  }, [selectedConversationId, selectedWorkspaceId, selectedSessionId, showWarning]);

  const handleNewConversation = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      const newConv = await createConversation(selectedWorkspaceId, selectedSessionId, { type: 'task' });
      addConversation(toStoreConversation(newConv));
      selectConversation(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      showError('Failed to create conversation');
    }
  }, [selectedWorkspaceId, selectedSessionId, addConversation, selectConversation, showError]);

  const handleCopyBranch = useCallback(async () => {
    if (!selectedSession?.branch) return;
    const ok = await copyToClipboard(selectedSession.branch);
    if (ok) showSuccess('Branch name copied');
  }, [selectedSession, showSuccess]);

  const handleArchive = useCallback(() => {
    if (!selectedSession) return;
    requestArchive(selectedSession.id);
  }, [selectedSession, requestArchive]);

  const storeUpdateSession = useAppStore((s) => s.updateSession);

  const handleTaskStatusChange = useCallback((value: SessionTaskStatus) => {
    if (!selectedSession || !selectedWorkspaceId) return;
    const prev = selectedSession.taskStatus;
    storeUpdateSession(selectedSession.id, { taskStatus: value });
    apiUpdateSession(selectedWorkspaceId, selectedSession.id, { taskStatus: value }).catch(() => {
      storeUpdateSession(selectedSession.id, { taskStatus: prev });
      showError('Failed to update task status');
    });
  }, [selectedSession, selectedWorkspaceId, storeUpdateSession, showError]);

  const toolbarConfig = useMemo(() => {
    if (!selectedWorkspace || !selectedSession) return {};

    return {
      titlePosition: 'center' as const,
      title: (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0 shrink overflow-hidden">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: resolveWorkspaceColor(selectedWorkspace.id, workspaceColors) }}
            />
            <span className="text-base font-semibold truncate">{selectedWorkspace.name}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <GitBranch className="h-4 w-4 text-purple-400" />
            <span className="text-base font-semibold truncate">{selectedSession.branch || selectedSession.name}</span>
          </span>
        </span>
      ),
      bottom: {
        titlePosition: 'left' as const,
        title: (
          <div className="flex items-center gap-1.5">
            <TaskStatusSelector
              value={selectedSession.taskStatus}
              onChange={handleTaskStatusChange}
              size="sm"
            />
            {selectedSession.prStatus && selectedSession.prStatus !== 'none' && selectedSession.prNumber && selectedWorkspaceId && (
              <PRHoverCard
                workspaceId={selectedWorkspaceId}
                sessionId={selectedSession.id}
                prNumber={selectedSession.prNumber}
                prStatus={selectedSession.prStatus as 'open' | 'merged' | 'closed'}
                checkStatus={selectedSession.checkStatus}
                hasMergeConflict={selectedSession.hasMergeConflict}
                prUrl={selectedSession.prUrl}
                size="sm"
              />
            )}
            <GitBranch className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-sm font-medium">
              {selectedSession.branch || selectedSession.name}
            </span>
            <TargetBranchSelector
              sessionId={selectedSession.id}
              workspaceId={selectedWorkspace!.id}
              currentTargetBranch={selectedSession.targetBranch}
              workspaceDefaultBranch={selectedWorkspace!.defaultBranch || 'main'}
              workspaceRemote={selectedWorkspace!.remote || 'origin'}
              variant="toolbar"
            />
          </div>
        ),
        actions: (
          <div className="flex items-center gap-0.5">
            {isAgentWorking ? (
              <div className="flex items-center gap-1.5 h-6 px-2">
                <div className="flex items-end gap-[1.5px] h-3" aria-hidden="true">
                  <div className="w-[2.5px] bg-ai-active rounded-full animate-agent-bar-1" />
                  <div className="w-[2.5px] bg-ai-active rounded-full animate-agent-bar-2" />
                  <div className="w-[2.5px] bg-ai-active rounded-full animate-agent-bar-3" />
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">Agent is working</span>
              </div>
            ) : (
              <PrimaryActionButton
                workspaceId={selectedWorkspaceId}
                session={selectedSession}
                onSendMessage={handleGitActionMessage}
                onFixIssues={handleFixIssues}
                onArchiveSession={requestArchive}
                onCreatePR={() => setShowCreatePRDialog(true)}
              />
            )}

            <div className="w-1.5" />

            {selectedSession.prStatus !== 'merged' && (() => {
              const reviewVariant =
                (selectedSession.hasMergeConflict || selectedSession.hasCheckFailures)
                  ? 'destructive' as const
                  : 'secondary' as const;

              const separatorColor = {
                destructive: 'border-l-red-400/40',
                secondary: 'border-l-secondary-foreground/10',
              }[reviewVariant];

              return (
            <div className="inline-flex rounded-sm shadow-sm">
              <Button
                variant={reviewVariant}
                size="sm"
                className="h-6 px-2 gap-1.5 text-xs rounded-r-none rounded-l-sm border-r-0 transition-none"
                onClick={() => dispatchReview('quick')}
              >
                <Eye className="h-3.5 w-3.5" />
                Review
              </Button>
              <Popover open={reviewPopoverOpen} onOpenChange={setReviewPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={reviewVariant}
                    size="sm"
                    className={cn(
                      'h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l',
                      separatorColor,
                    )}
                  >
                    <ChevronDown className="size-2.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-1.5">
                  {REVIEW_TYPES.map((type) => (
                    <button
                      key={type.title}
                      className="w-full text-left rounded-md px-3 py-2.5 hover:bg-accent transition-colors"
                      onClick={() => {
                        dispatchReview(type.key);
                        setReviewPopoverOpen(false);
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <type.icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{type.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{type.description}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
              );
            })()}

            <div className="w-1.5" />

            {(() => {
              const defaultApp = getAppById(defaultOpenApp);
              const defaultInstalled = installedApps.find((a) => a.id === defaultOpenApp);
              const DefaultIcon = defaultApp ? getAppIcon(defaultApp.id, defaultApp.category) : ExternalLink;
              const hasWorktree = !!selectedSession?.worktreePath;

              // Group installed apps by category
              const grouped = installedApps.reduce<Record<AppCategory, InstalledApp[]>>((acc, app) => {
                (acc[app.category] ??= []).push(app);
                return acc;
              }, {} as Record<AppCategory, InstalledApp[]>);
              const categories = (['editor', 'terminal', 'file-manager'] as AppCategory[]).filter(
                (cat) => grouped[cat]?.length > 0
              );

              return (
            <div className="inline-flex rounded-sm shadow-sm">
              <Button
                variant="secondary"
                size="sm"
                className="h-6 px-2 gap-1.5 text-xs rounded-r-none rounded-l-sm border-r-0 transition-none"
                disabled={!hasWorktree}
                onClick={() => {
                  if (!selectedSession?.worktreePath || !defaultApp) return;
                  openInApp(defaultApp.id, selectedSession.worktreePath, defaultApp.platforms.darwin?.appName);
                }}
              >
                {defaultInstalled?.iconBase64 ? (
                  <Image src={`data:image/png;base64,${defaultInstalled.iconBase64}`} className="h-4.5 w-4.5 shrink-0" alt="" aria-hidden="true" width={18} height={18} unoptimized />
                ) : (
                  <DefaultIcon className="h-3.5 w-3.5" />
                )}
                Open
              </Button>
              <Popover
                open={openAppPopoverOpen}
                onOpenChange={setOpenAppPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l border-l-secondary-foreground/10"
                    disabled={!hasWorktree}
                  >
                    <ChevronDown className="size-2.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1.5">
                  {categories.map((cat, catIdx) => (
                    <div key={cat}>
                      {catIdx > 0 && <div className="h-px bg-border my-1" />}
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {CATEGORY_LABELS[cat]}
                      </div>
                      {grouped[cat].map((app) => {
                        const FallbackIcon = getAppIcon(app.id, app.category);
                        return (
                          <button
                            key={app.id}
                            className="w-full text-left rounded-md px-2 py-1.5 hover:bg-accent transition-colors flex items-center gap-2"
                            onClick={() => {
                              if (!selectedSession?.worktreePath) return;
                              openInApp(app.id, selectedSession.worktreePath, app.platforms.darwin?.appName);
                              setOpenAppPopoverOpen(false);
                            }}
                          >
                            {app.iconBase64 ? (
                              <Image src={`data:image/png;base64,${app.iconBase64}`} className="h-5 w-5 shrink-0" alt="" aria-hidden="true" width={20} height={20} unoptimized />
                            ) : (
                              <FallbackIcon className="h-4 w-4 shrink-0" />
                            )}
                            <span className="text-sm">{app.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                      No apps detected
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
              );
            })()}

            <div className="w-1.5" />

            <div className="w-px h-4 bg-border mx-1" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={handleNewConversation}>
                  <MessageSquare /> New Conversation
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleGitActionMessage('Provide a summary of all work done in this session, including files changed, key decisions, and current status.')}>
                  <FileText /> View Summary
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleCopyBranch}>
                  <Copy /> Copy Branch Name
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShowCreatePRDialog(true)}>
                  <GitMerge /> Create Pull Request
                </DropdownMenuItem>
                {!selectedSession?.prNumber && selectedWorkspaceId && selectedSessionId && (
                  <DropdownMenuItem onSelect={async () => {
                    try {
                      await refreshPRStatus(selectedWorkspaceId, selectedSessionId);
                      showSuccess('Checking for pull request...');
                    } catch {
                      showWarning('Failed to check for pull request');
                    }
                  }}>
                    <Search /> Check for Pull Request
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => handleGitActionMessage('Rebase this branch on origin/main, resolving any conflicts.')}>
                  <RefreshCw /> Sync with Main
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={handleArchive}>
                  <Archive /> Archive Session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    };
  }, [selectedWorkspace, selectedSession, selectedWorkspaceId, selectedSessionId, handleGitActionMessage, handleFixIssues, handleNewConversation, handleCopyBranch, handleArchive, requestArchive, handleTaskStatusChange, reviewPopoverOpen, openAppPopoverOpen, defaultOpenApp, installedApps, workspaceColors, showSuccess, showWarning, isAgentWorking]);

  useMainToolbarContent(toolbarConfig);

  return (
    <>
      {archiveDialogProps && <ArchiveSessionDialog {...archiveDialogProps} />}
      {selectedWorkspaceId && selectedSessionId && (
        <CreatePRDialog
          open={showCreatePRDialog}
          onOpenChange={setShowCreatePRDialog}
          workspaceId={selectedWorkspaceId}
          sessionId={selectedSessionId}
          onSuccess={(prNumber, prUrl) => {
            // Optimistically update the session store so the UI reflects the PR
            // immediately, without waiting for the WebSocket event from the backend.
            if (selectedSessionId) {
              storeUpdateSession(selectedSessionId, {
                prStatus: 'open' as const,
                prNumber,
                prUrl,
              });
            }
            showSuccess('Pull request created');
            openUrlInBrowser(prUrl);
          }}
        />
      )}
    </>
  );
}
