'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  getGlobalActionTemplates,
  getWorkspaceActionTemplates,
  type AttachmentDTO,
} from '@/lib/api';
import { ACTION_TEMPLATES, ACTION_TEMPLATE_NAMES, fetchMergedActionTemplates } from '@/lib/action-templates';
import type { ActionTemplateKey } from '@/lib/action-templates';
import { dispatchAppEvent, useAppEventListener } from '@/lib/custom-events';
import { formatCIFailureMessage } from '@/lib/check-utils';
import { useToast } from '@/components/ui/toast';
import { copyToClipboard, openInApp } from '@/lib/tauri';
import { cn, toBase64 } from '@/lib/utils';
import { ArchiveSessionDialog } from '@/components/dialogs/ArchiveSessionDialog';
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
  RefreshCw,
  Zap,
  Search,
  Shield,
  Gauge,
  Boxes,
  ExternalLink,
} from 'lucide-react';
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
import { getAppById, getAppName, CATEGORY_LABELS } from '@/lib/openApps';
import type { AppCategory } from '@/lib/openApps';
import { getAppIcon } from '@/components/icons/AppIcons';

// ---------------------------------------------------------------------------
// Review type options for the split button popover
// ---------------------------------------------------------------------------

const REVIEW_TYPES = [
  { icon: Zap, title: 'Quick Scan', key: 'quick', description: 'Fast pass over changes — catch obvious issues and typos', color: 'amber', shortcut: '1' },
  { icon: Search, title: 'Deep Review', key: 'deep', description: 'Thorough line-by-line analysis with detailed feedback', color: 'blue', shortcut: '2' },
  { icon: Shield, title: 'Security Audit', key: 'security', description: 'Focus on vulnerabilities, auth gaps, and injection risks', color: 'red', shortcut: '3' },
  { icon: Gauge, title: 'Performance', key: 'performance', description: 'Check for regressions, memory leaks, and slow paths', color: 'green', shortcut: '4' },
  { icon: Boxes, title: 'Architecture', key: 'architecture', description: 'Evaluate design patterns, coupling, and separation of concerns', color: 'purple', shortcut: '5' },
  { icon: GitMerge, title: 'Pre-merge Check', key: 'premerge', description: 'Final review before merge — verify tests, conflicts, and coverage', color: 'teal', shortcut: '6' },
] as const;

const REVIEW_COLOR_CLASSES: Record<string, { icon: string; bg: string; hoverBg: string }> = {
  amber:  { icon: 'text-amber-500',  bg: 'bg-amber-500/10',  hoverBg: 'group-hover:bg-amber-500/20' },
  blue:   { icon: 'text-blue-500',   bg: 'bg-blue-500/10',   hoverBg: 'group-hover:bg-blue-500/20' },
  red:    { icon: 'text-red-500',    bg: 'bg-red-500/10',    hoverBg: 'group-hover:bg-red-500/20' },
  green:  { icon: 'text-green-500',  bg: 'bg-green-500/10',  hoverBg: 'group-hover:bg-green-500/20' },
  purple: { icon: 'text-purple-500', bg: 'bg-purple-500/10', hoverBg: 'group-hover:bg-purple-500/20' },
  teal:   { icon: 'text-teal-500',   bg: 'bg-teal-500/10',   hoverBg: 'group-hover:bg-teal-500/20' },
};

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
  const addMessage = useAppStore((s) => s.addMessage);
  const setStreaming = useAppStore((s) => s.setStreaming);
  const updateConversation = useAppStore((s) => s.updateConversation);
  const { success: showSuccess, error: showError, warning: showWarning } = useToast();
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
    if (isAgentWorking) return;
    if (!selectedConversationId) {
      showWarning('No active conversation');
      return;
    }
    sendConversationMessage(selectedConversationId, content).catch((error) => {
      console.error('Failed to send git action message:', error);
      showError('Failed to send message to agent');
    });
  }, [selectedConversationId, showWarning, showError, isAgentWorking]);

  // Wrapper that adds a user bubble before sending — used by PrimaryActionButton
  const handleActionWithBubble = useCallback((content: string) => {
    if (isAgentWorking) return;
    if (!selectedConversationId) {
      showWarning('No active conversation');
      return;
    }
    addMessage({
      id: crypto.randomUUID(),
      conversationId: selectedConversationId,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    });
    window.dispatchEvent(new CustomEvent('chat-message-submitted'));
    updateConversation(selectedConversationId, { status: 'active' });
    setStreaming(selectedConversationId, true);
    sendConversationMessage(selectedConversationId, content).catch((error) => {
      console.error('Failed to send action message:', error);
      setStreaming(selectedConversationId, false);
      updateConversation(selectedConversationId, { status: 'idle' });
      showError('Failed to send message to agent');
    });
  }, [selectedConversationId, showWarning, showError, updateConversation, setStreaming, isAgentWorking]);

  // Wrapper that adds a user bubble + sends template content as attachment
  const handleActionWithBubbleAndTemplate = useCallback((content: string, templateContent: string, templateKey?: ActionTemplateKey) => {
    if (isAgentWorking) return;
    if (!selectedConversationId) {
      showWarning('No active conversation');
      return;
    }

    // Create template attachment (before addMessage so it appears in the bubble)
    const attachmentName = templateKey ? ACTION_TEMPLATE_NAMES[templateKey] : 'Action Instructions';
    const templateAttachment: AttachmentDTO = {
      id: crypto.randomUUID(),
      type: 'file',
      name: attachmentName,
      mimeType: 'text/markdown',
      size: new Blob([templateContent]).size,
      lineCount: templateContent.split('\n').length,
      base64Data: toBase64(templateContent),
      preview: templateContent.slice(0, 200),
      isInstruction: true,
    };

    // User bubble shows the short instruction + instruction attachment card
    addMessage({
      id: crypto.randomUUID(),
      conversationId: selectedConversationId,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      attachments: [templateAttachment],
    });
    window.dispatchEvent(new CustomEvent('chat-message-submitted'));
    updateConversation(selectedConversationId, { status: 'active' });
    setStreaming(selectedConversationId, true);

    sendConversationMessage(selectedConversationId, content, [templateAttachment]).catch((error) => {
      console.error('Failed to send action message:', error);
      setStreaming(selectedConversationId, false);
      updateConversation(selectedConversationId, { status: 'idle' });
      showError('Failed to send message to agent');
    });
  }, [selectedConversationId, showWarning, showError, addMessage, updateConversation, setStreaming, isAgentWorking]);

  // Listen for git-create-pr events from menu handler and command palette
  useEffect(() => {
    const handleCreatePR = () => handleActionWithBubble('Create a pull request');
    window.addEventListener('git-create-pr', handleCreatePR);
    return () => window.removeEventListener('git-create-pr', handleCreatePR);
  }, [handleActionWithBubble]);

  // Listen for git-commit events from menu handler and command palette
  useEffect(() => {
    const handleCommit = () => handleActionWithBubble('Commit the current changes');
    window.addEventListener('git-commit', handleCommit);
    return () => window.removeEventListener('git-commit', handleCommit);
  }, [handleActionWithBubble]);

  // Listen for git-sync events from menu handler and command palette
  useEffect(() => {
    const handleSync = () => handleActionWithBubble('Sync this branch with main');
    window.addEventListener('git-sync', handleSync);
    return () => window.removeEventListener('git-sync', handleSync);
  }, [handleActionWithBubble]);

  // Shared handler for branch-sync events (rebase & merge)
  const handleBranchSyncEvent = useCallback((baseBranch: string, message: string) => {
    if (isAgentWorking || !selectedConversationId || !selectedWorkspaceId) {
      if (isAgentWorking) {
        showWarning('Wait for the agent to finish before syncing');
      } else if (!selectedConversationId || !selectedWorkspaceId) {
        showWarning('No active session to sync');
      }
      dispatchAppEvent('branch-sync-rejected');
      return;
    }
    fetchMergedActionTemplates(selectedWorkspaceId, getGlobalActionTemplates, getWorkspaceActionTemplates)
      .then((templates) => {
        handleActionWithBubbleAndTemplate(message, templates['sync-branch'], 'sync-branch');
        dispatchAppEvent('branch-sync-accepted');
      })
      .catch(() => {
        handleActionWithBubbleAndTemplate(message, ACTION_TEMPLATES['sync-branch'], 'sync-branch');
        dispatchAppEvent('branch-sync-accepted');
      });
  }, [selectedWorkspaceId, selectedConversationId, isAgentWorking, handleActionWithBubbleAndTemplate]);

  // Listen for branch-sync-rebase events from BranchSyncBanner
  useAppEventListener('branch-sync-rebase', (detail) => {
    handleBranchSyncEvent(detail?.baseBranch || 'origin/main', `Rebase my branch on ${detail?.baseBranch || 'origin/main'}`);
  }, [handleBranchSyncEvent]);

  // Listen for branch-sync-merge events from BranchSyncBanner
  useAppEventListener('branch-sync-merge', (detail) => {
    handleBranchSyncEvent(detail?.baseBranch || 'origin/main', `Merge ${detail?.baseBranch || 'origin/main'} into my branch`);
  }, [handleBranchSyncEvent]);

  const [, setFixIssuesLoading] = useState(false);

  const handleFixIssues = useCallback(async () => {
    if (isAgentWorking) return;
    if (!selectedConversationId || !selectedWorkspaceId || !selectedSessionId) {
      showWarning('No active conversation');
      return;
    }

    // Fetch the fix-issues template so it's attached as instructions
    let templateContent: string = ACTION_TEMPLATES['fix-issues'];
    try {
      const merged = await fetchMergedActionTemplates(selectedWorkspaceId, getGlobalActionTemplates, getWorkspaceActionTemplates);
      templateContent = merged['fix-issues'] ?? templateContent;
    } catch { /* use built-in default */ }

    const templateAttachment: AttachmentDTO = {
      id: crypto.randomUUID(),
      type: 'file',
      name: ACTION_TEMPLATE_NAMES['fix-issues'],
      mimeType: 'text/markdown',
      size: new Blob([templateContent]).size,
      lineCount: templateContent.split('\n').length,
      base64Data: toBase64(templateContent),
      preview: templateContent.slice(0, 200),
      isInstruction: true,
    };

    // Show short user bubble immediately (full CI context is sent to the agent separately)
    addMessage({
      id: crypto.randomUUID(),
      conversationId: selectedConversationId,
      role: 'user',
      content: 'Fix the failing CI checks',
      timestamp: new Date().toISOString(),
      attachments: [templateAttachment],
    });
    window.dispatchEvent(new CustomEvent('chat-message-submitted'));
    updateConversation(selectedConversationId, { status: 'active' });
    setStreaming(selectedConversationId, true);

    setFixIssuesLoading(true);
    try {
      const context = await getCIFailureContext(selectedWorkspaceId, selectedSessionId);

      if (context.failedRuns.length === 0) {
        setStreaming(selectedConversationId, false);
        updateConversation(selectedConversationId, { status: 'idle' });
        addMessage({
          id: crypto.randomUUID(),
          conversationId: selectedConversationId,
          role: 'assistant',
          content: 'No CI failures found. All checks may have passed.',
          timestamp: new Date().toISOString(),
        });
        showWarning('No CI failures found. Checks may have passed.');
        return;
      }

      const message = formatCIFailureMessage(context);
      await sendConversationMessage(selectedConversationId, message, [templateAttachment]);
    } catch (error) {
      console.error('Failed to fetch CI failure context:', error);
      // Fallback to generic message
      try {
        await sendConversationMessage(selectedConversationId, 'Fix the failing CI checks', [templateAttachment]);
        showWarning('Could not fetch CI details. Sent generic request.');
      } catch {
        setStreaming(selectedConversationId, false);
        updateConversation(selectedConversationId, { status: 'idle' });
        showWarning('Failed to send message to agent.');
      }
    } finally {
      setFixIssuesLoading(false);
    }
  }, [selectedConversationId, selectedWorkspaceId, selectedSessionId, showWarning, addMessage, updateConversation, setStreaming, isAgentWorking]);

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
                onSendMessage={handleActionWithBubble}
                onSendMessageWithTemplate={handleActionWithBubbleAndTemplate}
                onFixIssues={handleFixIssues}
                onArchiveSession={requestArchive}
              />
            )}

            <div className="w-1.5" />

            <div className="inline-flex rounded-sm shadow-sm">
              <Button
                variant="secondary"
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
                    variant="secondary"
                    size="sm"
                    className="h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l border-l-secondary-foreground/10"
                  >
                    <ChevronDown className="size-2.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 p-1.5"
                  onKeyDown={(e) => {
                    const idx = parseInt(e.key, 10);
                    if (idx >= 1 && idx <= 6) {
                      e.preventDefault();
                      dispatchReview(REVIEW_TYPES[idx - 1].key);
                      setReviewPopoverOpen(false);
                    }
                  }}
                >
                  <div className="stagger-children">
                    {REVIEW_TYPES.map((type) => {
                      const colors = REVIEW_COLOR_CLASSES[type.color];
                      return (
                        <button
                          key={type.key}
                          className="group w-full text-left rounded-md px-2.5 py-2 hover:bg-accent transition-colors"
                          onClick={() => {
                            dispatchReview(type.key);
                            setReviewPopoverOpen(false);
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={cn(
                              'flex items-center justify-center h-7 w-7 rounded-lg shrink-0 transition-colors',
                              colors.bg, colors.hoverBg,
                            )}>
                              <type.icon className={cn('h-3.5 w-3.5', colors.icon)} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium leading-tight">{type.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{type.description}</div>
                            </div>
                            <kbd className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium bg-muted/50 border border-border/40 rounded text-muted-foreground/60 shrink-0">
                              {type.shortcut}
                            </kbd>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

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
                  openInApp(defaultApp.id, selectedSession.worktreePath, getAppName(defaultApp));
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
                              openInApp(app.id, selectedSession.worktreePath, getAppName(app));
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleCopyBranch}>
                  <Copy /> Copy Branch Name
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleActionWithBubble('Create a pull request')}>
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
  }, [selectedWorkspace, selectedSession, selectedWorkspaceId, selectedSessionId, handleGitActionMessage, handleActionWithBubble, handleActionWithBubbleAndTemplate, handleFixIssues, handleNewConversation, handleCopyBranch, handleArchive, requestArchive, handleTaskStatusChange, reviewPopoverOpen, openAppPopoverOpen, defaultOpenApp, installedApps, workspaceColors, showSuccess, showWarning, isAgentWorking]);

  useMainToolbarContent(toolbarConfig);

  return (
    <>
      {archiveDialogProps && <ArchiveSessionDialog {...archiveDialogProps} />}
    </>
  );
}
