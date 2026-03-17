'use client';

import { useState, useEffect, useCallback, useMemo, useReducer, startTransition } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/appStore';
import { captureClosedConversation, useRestoreConversation } from '@/hooks/useRecentlyClosed';
import {
  useConversationState,
  useFileTabState,
  useConversationFreshness,
  useReviewComments,
  useReviewCommentActions,
} from '@/stores/selectors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sparkles,
  FileQuestion,
  AlertCircle,
  File,
  Loader2,
  Circle,
  CheckCircle2,
  Terminal,
  FileCode,
  AlertTriangle,
} from 'lucide-react';
import type { FileTab, Conversation } from '@/lib/types';
import { CodeViewer } from '@/components/files/CodeViewer';
import { FileTabIcon } from '@/components/files/FileTabIcon';
import { TabBar, type TabItemData } from '@/components/tabs';
import { CachedConversationPane } from '@/components/conversation/CachedConversationPane';
import { getSessionFileContent, getSessionFileDiff, updateReviewComment, deleteReviewComment as deleteReviewCommentApi, listReviewComments, createConversation, createReviewComment } from '@/lib/api';
import { getDiffFromCache, setDiffInCache } from '@/lib/diffCache';
import { getFileContentFromCache, setFileContentInCache } from '@/lib/fileContentCache';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { BranchSyncBanner } from '@/components/BranchSyncBanner';
import { InterruptedBanner } from '@/components/conversation/InterruptedBanner';
import { useBranchSync } from '@/hooks/useBranchSync';
import { useSettingsStore } from '@/stores/settingsStore';
import { dispatchAppEvent, useAppEventListener } from '@/lib/custom-events';
import { useClaudeAuthStatus, refreshClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { SessionHandoffDialog } from '@/components/conversation/SessionHandoffDialog';
import { useToast } from '@/components/ui/toast';
import { refreshAWSCredentials } from '@/lib/api';
import { KeyRound, Settings2, ShieldAlert } from 'lucide-react';

// Module-level LRU of recently-viewed sessions. Stored outside the component so
// useMemo can read it during render without violating react-hooks/refs or
// react-hooks/set-state-in-effect rules.
type RecentSession = { sessionId: string; activeTabId: string | null; activeConversationId: string | null };
type RecentSessionAction = { selectedSessionId: string | null; selectedFileTabId: string | null; selectedConversationId: string | null };

// Maximum number of recently-viewed sessions whose Pierre Shadow DOMs are
// kept alive (hidden) to avoid expensive Shiki re-tokenization cold starts.
const MAX_CACHED_SESSIONS = 3;

function recentSessionReducer(state: RecentSession[], action: RecentSessionAction): RecentSession[] {
  const { selectedSessionId, selectedFileTabId, selectedConversationId } = action;
  if (!selectedSessionId) return state;
  const next = state.map(e => ({ ...e })); // shallow clone all entries
  const idx = next.findIndex(e => e.sessionId === selectedSessionId);
  if (idx !== -1) {
    const entry = {
      ...next[idx],
      activeTabId: selectedFileTabId ?? next[idx].activeTabId,
      activeConversationId: selectedConversationId ?? next[idx].activeConversationId,
    };
    next.splice(idx, 1);
    next.unshift(entry);
  } else {
    next.unshift({ sessionId: selectedSessionId, activeTabId: selectedFileTabId, activeConversationId: selectedConversationId });
  }
  return next.length > MAX_CACHED_SESSIONS ? next.slice(0, MAX_CACHED_SESSIONS) : next;
}

interface ConversationAreaProps {
  children?: React.ReactNode;
}

export function ConversationArea({ children }: ConversationAreaProps) {
  // Use selector hooks for optimized subscriptions
  const {
    conversations,
    selectedConversationId,
    selectConversation,
    addConversation,
    removeConversation,
    updateConversation,
  } = useConversationState();

  const {
    fileTabs,
    selectedFileTabId,
    selectFileTab,
    closeFileTab,
    pinFileTab,
    reorderFileTabs,
    updateFileTab,
    updateFileTabContent,
    setPendingCloseFileTabId,
  } = useFileTabState();

  const { error: showError } = useToast();

  // Targeted selectors for remaining state
  const sessions = useAppStore((s) => s.sessions);
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);

  // Defer heavy file tab rendering on session switch for instant UI response.
  // Shadow DOM + Shiki tokenization in the code viewer blocks startTransition;
  // rendering a placeholder first lets the session switch paint immediately.
  // We track a deferred session ID that catches up after a double-rAF, and
  // derive readiness by comparing it to the current selected session.
  const [deferredSessionId, setDeferredSessionId] = useState(selectedSessionId);
  const fileTabsReady = deferredSessionId === selectedSessionId;

  useEffect(() => {
    // Double-rAF ensures the placeholder paints before we re-enable heavy
    // rendering. A single rAF fires before the paint, so React may batch
    // both state updates into one render, skipping the placeholder entirely.
    let innerRafId: number;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        setDeferredSessionId(selectedSessionId);
      });
    });
    return () => {
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [selectedSessionId]);
  // Narrow subscription: only the recovery field is needed at this level.
  // Full streaming state (isStreaming, hasPendingPlanApproval) lives in CachedConversationPane.
  const streamingRecovery = useAppStore(
    (s) => selectedConversationId ? s.streamingState[selectedConversationId]?.recovery ?? null : null
  );
  const claudeAuthStatus = useClaudeAuthStatus();
  const claudeAuthConfigured = claudeAuthStatus?.configured ?? null;

  // Review comments for current session
  const reviewComments = useReviewComments(selectedSessionId);
  const { addReviewComment: addReviewCommentToStore, updateReviewComment: updateReviewCommentInStore, deleteReviewComment: deleteReviewCommentFromStore, setReviewComments } = useReviewCommentActions();

  // Fetch review comments when session changes.
  // Always deferred so it doesn't block navigation render or session creation.
  // If cached, show cached data immediately; refetch picks up external changes.
  useEffect(() => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const fetchComments = async () => {
      try {
        const comments = await listReviewComments(selectedWorkspaceId, selectedSessionId);
        setReviewComments(selectedSessionId, comments);
      } catch (error) {
        console.error('Failed to fetch review comments:', error);
      }
    };

    // Always defer — never block the render path
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(() => fetchComments(), { timeout: 8000 });
      return () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(fetchComments, 1000);
      return () => clearTimeout(id);
    }
  }, [selectedWorkspaceId, selectedSessionId, setReviewComments]);

  // Branch sync for updating from origin/main
  const branchSyncBanner = useSettingsStore((s) => s.branchSyncBanner);
  const {
    status: branchSyncStatus,
    dismissed: branchSyncDismissed,
    dismiss: handleBranchDismiss,
  } = useBranchSync(selectedWorkspaceId, selectedSessionId);

  // Dispatch to agent via typed custom events (SessionToolbarContent handles these)
  const [branchSyncing, setBranchSyncing] = useState(false);

  const handleBranchRebase = useCallback(() => {
    if (!branchSyncStatus) return;
    setBranchSyncing(true);
    dispatchAppEvent('branch-sync-rebase', { baseBranch: branchSyncStatus.baseBranch });
  }, [branchSyncStatus]);

  const handleBranchMerge = useCallback(() => {
    if (!branchSyncStatus) return;
    setBranchSyncing(true);
    dispatchAppEvent('branch-sync-merge', { baseBranch: branchSyncStatus.baseBranch });
  }, [branchSyncStatus]);

  // Listen for response events from SessionToolbarContent
  useAppEventListener('branch-sync-accepted', () => {
    setBranchSyncing(false);
    handleBranchDismiss();
  }, [handleBranchDismiss]);

  useAppEventListener('branch-sync-rejected', () => {
    setBranchSyncing(false);
  }, []);

  // Rename dialog state for conversations
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameConvId, setRenameConvId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Session handoff state (triggered by ContextMeter or RunSummaryBlock via store)
  const showHandoff = useAppStore((s) => s.showSessionHandoff);
  const setShowHandoff = useAppStore((s) => s.setShowSessionHandoff);
  const [awsRefreshing, setAwsRefreshing] = useState(false);

// Filter tabs for current session only (strict session isolation)
  // All tabs are now session-scoped - no more workspace-level tabs
  const { visibleTabs, sessionTabs } = useMemo(() => {
    const session: FileTab[] = [];

    for (const tab of fileTabs) {
      if (tab.sessionId === selectedSessionId) {
        session.push(tab);
      }
      // Skip tabs from other sessions (complete isolation)
    }

    return { visibleTabs: session, sessionTabs: session };
  }, [fileTabs, selectedSessionId]);

  // LRU cache of recent sessions — keeps Pierre Shadow DOMs alive across
  // session switches to avoid expensive Shiki re-tokenization cold starts.
  // useReducer computes new state purely from previous state + action.
  // Dispatch during render (React-endorsed "adjust state during rendering" pattern)
  // to avoid lint issues with refs-in-render, setState-in-effect, and immutability.
  const [recentSessions, dispatchRecentSession] = useReducer(recentSessionReducer, []);
  const [prevSessionKey, setPrevSessionKey] = useState('');
  const sessionKey = `${selectedSessionId ?? ''}:${selectedFileTabId ?? ''}:${selectedConversationId ?? ''}`;
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey);
    dispatchRecentSession({ selectedSessionId, selectedFileTabId, selectedConversationId });
  }

  // Only the last-active tab from each recently-viewed session is kept mounted
  // (hidden) so its Pierre Shadow DOM survives session switches. This caps
  // cached viewers at MAX_CACHED_SESSIONS - 1 instead of potentially all tabs.
  const cachedSessionTabs = useMemo(() => {
    if (recentSessions.length <= 1) return [];
    const result: FileTab[] = [];
    for (let i = 1; i < recentSessions.length; i++) {
      const { sessionId, activeTabId } = recentSessions[i];
      if (activeTabId) {
        const tab = fileTabs.find(t => t.id === activeTabId && t.sessionId === sessionId);
        if (tab) result.push(tab);
      }
    }
    return result;
  }, [fileTabs, recentSessions]);

  const sessionConversations = useMemo(
    () => conversations.filter((c) => c.sessionId === selectedSessionId),
    [conversations, selectedSessionId]
  );

  // Auto-select first conversation when it arrives for a session that has none selected
  useEffect(() => {
    if (!selectedSessionId) return;
    if (selectedConversationId) return;
    if (sessionConversations.length === 0) return;
    selectConversation(sessionConversations[0].id);
  }, [selectedSessionId, selectedConversationId, sessionConversations, selectConversation]);

  // Session-scoped streaming states for conversation tab indicators.
  // Only subscribes to isStreaming/error for this session's conversations,
  // preventing cross-session re-renders. Flattened to primitives so
  // useShallow comparison prevents unnecessary re-renders.
  const sessionConvIds = useMemo(
    () => sessionConversations.map((c) => c.id),
    [sessionConversations]
  );

  // Reactive freshness map — only subscribes to this session's conversations
  const conversationFreshness = useConversationFreshness(sessionConvIds);

  // Check if a conversation is fresh (no user messages yet)
  const isFreshConversation = useCallback(
    (convId: string) => !conversationFreshness[convId],
    [conversationFreshness]
  );
  const sessionStreamingFlat = useAppStore(
    useShallow(
      (s) => {
        const result: Record<string, boolean | string | null> = {};
        for (const id of sessionConvIds) {
          const ss = s.streamingState[id];
          result[`${id}:s`] = ss?.isStreaming ?? false;
          result[`${id}:e`] = ss?.error ?? null;
        }
        return result;
      }
    )
  );

  // Get status indicator for conversation tabs
  const getStatusIndicator = useCallback(
    (conv: Conversation) => {
      const isConvStreaming = sessionStreamingFlat[`${conv.id}:s`];
      const convError = sessionStreamingFlat[`${conv.id}:e`];
      if (isConvStreaming) {
        return (
          <div className="flex items-end gap-[1.5px] h-2.5 w-2.5">
            <div className="w-[2px] bg-brand rounded-full animate-agent-bar-1" />
            <div className="w-[2px] bg-brand rounded-full animate-agent-bar-2" />
            <div className="w-[2px] bg-brand rounded-full animate-agent-bar-3" />
          </div>
        );
      }
      if (convError) {
        return <Circle className="w-2.5 h-2.5 text-destructive fill-destructive" />;
      }
      if (conv.status === 'idle' && isFreshConversation(conv.id)) {
        return <Sparkles className="w-2.5 h-2.5 text-orange-500" />;
      }
      switch (conv.status) {
        case 'active':
          // Process alive but not streaming — show idle, not spinner.
          // The spinner is driven by isStreaming (checked above).
          return <Circle className="w-2.5 h-2.5 text-muted-foreground/50" />;
        case 'completed':
          return <CheckCircle2 className="w-2.5 h-2.5 text-text-success" />;
        case 'idle':
        default:
          return <Circle className="w-2.5 h-2.5 text-muted-foreground/50" />;
      }
    },
    [sessionStreamingFlat, isFreshConversation]
  );

  // Convert FileTab to TabItemData
  const fileTabToTabItem = useCallback(
    (tab: FileTab, group: 'session'): TabItemData => ({
      id: tab.id,
      type: 'file',
      label: tab.name,
      icon: <FileTabIcon filename={tab.name} className="w-3 h-3" />,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isActive: selectedFileTabId === tab.id,
      group,
      fileTab: tab,
    }),
    [selectedFileTabId]
  );

  // Convert Conversation to TabItemData
  const conversationToTabItem = useCallback(
    (conv: Conversation): TabItemData => ({
      id: conv.id,
      type: 'conversation',
      label: conv.name,
      isDirty: false,
      isPinned: false,
      isActive: selectedFileTabId === null && selectedConversationId === conv.id,
      group: 'conversation',
      conversation: conv,
    }),
    [selectedFileTabId, selectedConversationId]
  );

  // Convert session tabs to TabItemData (all tabs are now session-scoped)
  const sessionTabItems = useMemo(
    () => sessionTabs.map((tab) => fileTabToTabItem(tab, 'session')),
    [sessionTabs, fileTabToTabItem]
  );

  const conversationTabItems = useMemo(
    () => sessionConversations.map(conversationToTabItem),
    [sessionConversations, conversationToTabItem]
  );

  // Get current active tab ID for TabBar
  const activeTabId = useMemo(() => {
    if (selectedFileTabId !== null) return selectedFileTabId;
    if (selectedConversationId !== null) return selectedConversationId;
    return null;
  }, [selectedFileTabId, selectedConversationId]);


  // Get current file tab from visible tabs
  const currentFileTab = visibleTabs.find((t) => t.id === selectedFileTabId);

  // Memoize filtered comments per file tab to prevent new array references
  const currentFilePath = currentFileTab?.path;
  const fileComments = useMemo(
    () => currentFilePath ? reviewComments.filter((c) => c.filePath === currentFilePath) : [],
    [reviewComments, currentFilePath],
  );

  // Determine what's currently active (conversation or file)
  // File is active only if selected tab is visible
  const isFileActive = selectedFileTabId !== null && currentFileTab !== undefined;

  // Pre-computed lookup maps for the cached-pane render loop
  const sessionMap = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const conversationsBySession = useMemo(() => {
    const map = new Set<string>();
    for (const c of conversations) map.add(c.sessionId);
    return map;
  }, [conversations]);

  // Load content for selected file tab on mount/restore (e.g., after refresh)
  useEffect(() => {
    if (!currentFileTab || currentFileTab.isLoading) return;

    // For regular file view without content, load it from session's worktree
    // Use content === undefined to differentiate "not loaded" from "loaded but empty"
    if (currentFileTab.viewMode !== 'diff' && currentFileTab.content === undefined && !currentFileTab.isBinary && !currentFileTab.isTooLarge && !currentFileTab.isEmpty && !currentFileTab.loadError && currentFileTab.sessionId) {
      // Check file content cache first — avoids HTTP round-trip on re-open
      const cached = getFileContentFromCache(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
      if (cached) {
        const isEmpty = cached.content === '' || cached.content === undefined;
        updateFileTab(currentFileTab.id, {
          content: cached.content ?? '',
          originalContent: cached.content ?? '',
          isEmpty,
          isLoading: false,
        });
        return;
      }

      const loadContent = async () => {
        updateFileTab(currentFileTab.id, { isLoading: true });
        try {
          const fileData = await getSessionFileContent(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
          setFileContentInCache(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path, fileData);
          const isEmpty = fileData.content === '' || fileData.content === undefined;
          updateFileTab(currentFileTab.id, {
            content: fileData.content ?? '',
            originalContent: fileData.content ?? '',
            isEmpty,
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load file:', error);
          updateFileTab(currentFileTab.id, {
            loadError: error instanceof Error ? error.message : 'Unknown error',
            isLoading: false,
          });
        }
      };
      loadContent();
    }

    // For diff view without diff content, load it
    if (currentFileTab.viewMode === 'diff' && !currentFileTab.diff && !currentFileTab.isBinary && !currentFileTab.isTooLarge && !currentFileTab.loadError && currentFileTab.sessionId) {
      const loadDiff = async () => {
        // Check frontend diff cache first
        const cachedDiff = getDiffFromCache(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
        if (cachedDiff) {
          if (cachedDiff.truncated) {
            updateFileTab(currentFileTab.id, { isLoading: false, isTooLarge: true, unifiedDiff: cachedDiff.unifiedDiff });
          } else {
            updateFileTab(currentFileTab.id, {
              diff: {
                oldContent: cachedDiff.oldContent ?? '',
                newContent: cachedDiff.newContent ?? '',
              },
              isLoading: false,
            });
          }
          return;
        }
        updateFileTab(currentFileTab.id, { isLoading: true });
        try {
          const diffData = await getSessionFileDiff(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
          setDiffInCache(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path, diffData);
          if (diffData.truncated) {
            updateFileTab(currentFileTab.id, { isLoading: false, isTooLarge: true, unifiedDiff: diffData.unifiedDiff });
          } else {
            updateFileTab(currentFileTab.id, {
              diff: {
                oldContent: diffData.oldContent ?? '',
                newContent: diffData.newContent ?? '',
              },
              isLoading: false,
            });
          }
        } catch (error) {
          console.error('Failed to load diff:', error);
          updateFileTab(currentFileTab.id, {
            loadError: error instanceof Error ? error.message : 'Unknown error',
            isLoading: false,
          });
        }
      };
      loadDiff();
    }
  }, [currentFileTab, updateFileTab]);

  const handleNewConversation = useCallback(async (type: 'task' | 'review' | 'chat' = 'task') => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    try {
      // Call backend API to create conversation with proper setupInfo
      const newConv = await createConversation(selectedWorkspaceId, selectedSessionId, { type });

      // Add to store with messages from backend (includes setupInfo)
      // addConversation automatically adds conversation.messages to the messages array
      addConversation({
        id: newConv.id,
        sessionId: newConv.sessionId,
        type: newConv.type,
        name: newConv.name,
        status: newConv.status,
        messages: newConv.messages.map((m) => ({
          id: m.id,
          conversationId: newConv.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          setupInfo: m.setupInfo,
          runSummary: m.runSummary,
          timestamp: m.timestamp,
        })),
        toolSummary: newConv.toolSummary.map((t) => ({
          id: t.id,
          tool: t.tool,
          target: t.target,
          success: t.success,
        })),
        createdAt: newConv.createdAt,
        updatedAt: newConv.updatedAt,
      });

      selectConversation(newConv.id);
      selectFileTab(null); // Deselect file tab
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  }, [selectedWorkspaceId, selectedSessionId, addConversation, selectConversation, selectFileTab]);

  const handleSelectConversation = useCallback((id: string) => {
    selectConversation(id);
    selectFileTab(null); // Deselect file tab when selecting conversation
  }, [selectConversation, selectFileTab]);

  const handleSelectFileTab = useCallback(async (id: string) => {
    selectFileTab(id);

    // Find the tab and check if it needs content loaded
    const tab = fileTabs.find((t) => t.id === id);
    if (!tab || tab.isLoading) return;

    // For regular file view without content, load it from session's worktree
    // Use content === undefined to differentiate "not loaded" from "loaded but empty"
    if (tab.viewMode !== 'diff' && tab.content === undefined && !tab.isBinary && !tab.isTooLarge && !tab.isEmpty && !tab.loadError && tab.sessionId) {
      updateFileTab(id, { isLoading: true });
      try {
        const fileData = await getSessionFileContent(tab.workspaceId, tab.sessionId, tab.path);
        const isEmpty = fileData.content === '' || fileData.content === undefined;
        updateFileTab(id, {
          content: fileData.content ?? '',
          originalContent: fileData.content ?? '',
          isEmpty,
          isLoading: false,
        });
      } catch (error) {
        console.error('Failed to load file:', error);
        updateFileTab(id, {
          loadError: error instanceof Error ? error.message : 'Unknown error',
          isLoading: false,
        });
      }
    }

    // For diff view without diff content, load it
    if (tab.viewMode === 'diff' && !tab.diff && !tab.isBinary && !tab.isTooLarge && !tab.loadError && tab.sessionId) {
      // Check frontend diff cache first
      const cachedDiff = getDiffFromCache(tab.workspaceId, tab.sessionId, tab.path);
      if (cachedDiff) {
        updateFileTab(id, {
          diff: {
            oldContent: cachedDiff.oldContent ?? '',
            newContent: cachedDiff.newContent ?? '',
          },
          isLoading: false,
        });
      } else {
        updateFileTab(id, { isLoading: true });
        try {
          const diffData = await getSessionFileDiff(tab.workspaceId, tab.sessionId, tab.path);
          setDiffInCache(tab.workspaceId, tab.sessionId, tab.path, diffData);
          updateFileTab(id, {
            diff: {
              oldContent: diffData.oldContent ?? '',
              newContent: diffData.newContent ?? '',
            },
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load diff:', error);
          updateFileTab(id, {
            loadError: error instanceof Error ? error.message : 'Unknown error',
            isLoading: false,
          });
        }
      }
    }
  }, [fileTabs, selectFileTab, updateFileTab]);

  // Handle resolving/unresolving a review comment
  const handleResolveComment = useCallback(async (commentId: string, resolved: boolean, resolutionType?: 'fixed' | 'ignored') => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      const updatedComment = await updateReviewComment(
        selectedWorkspaceId,
        selectedSessionId,
        commentId,
        { resolved, resolvedBy: resolved ? 'You' : undefined, resolutionType }
      );
      updateReviewCommentInStore(selectedSessionId, commentId, updatedComment);
    } catch (error) {
      console.error('Failed to update comment:', error);
    }
  }, [selectedWorkspaceId, selectedSessionId, updateReviewCommentInStore]);

  // Handle deleting a review comment
  const handleDeleteComment = useCallback(async (commentId: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      await deleteReviewCommentApi(selectedWorkspaceId, selectedSessionId, commentId);
      deleteReviewCommentFromStore(selectedSessionId, commentId);
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  }, [selectedWorkspaceId, selectedSessionId, deleteReviewCommentFromStore]);

  // Handle creating a new review comment on a diff line
  const handleCreateComment = useCallback(async (lineNumber: number, content: string) => {
    if (!selectedWorkspaceId || !selectedSessionId || !currentFileTab?.path) return;
    try {
      const newComment = await createReviewComment(selectedWorkspaceId, selectedSessionId, {
        filePath: currentFileTab.path,
        lineNumber,
        content,
        source: 'user',
        author: 'You',
      });
      addReviewCommentToStore(selectedSessionId, newComment);
    } catch (error) {
      console.error('Failed to create comment:', error);
    }
  }, [selectedWorkspaceId, selectedSessionId, currentFileTab, addReviewCommentToStore]);

  // Unified tab select handler for TabBar
  const handleTabSelect = useCallback(
    (id: string, type: 'file' | 'conversation') => {
      if (type === 'file') {
        handleSelectFileTab(id);
      } else {
        handleSelectConversation(id);
      }
    },
    [handleSelectFileTab, handleSelectConversation]
  );

  // Unified tab close handler for TabBar
  const handleTabClose = useCallback(
    (id: string, type: 'file' | 'conversation') => {
      if (type === 'file') {
        const tab = fileTabs.find((t) => t.id === id);
        if (tab?.isDirty) {
          setPendingCloseFileTabId(id);
          return;
        }
        // startTransition defers Pierre's heavy Shadow DOM cleanup so the tab disappears instantly
        startTransition(() => closeFileTab(id));
      } else {
        // Capture metadata for recently-closed before removing from store
        const conv = conversations.find((c) => c.id === id);
        if (conv && selectedWorkspaceId) {
          captureClosedConversation(conv, selectedWorkspaceId);
        }
        startTransition(() => removeConversation(id));
      }
    },
    [fileTabs, closeFileTab, removeConversation, setPendingCloseFileTabId, conversations, selectedWorkspaceId]
  );

  // Restore a recently closed conversation
  const handleRestoreConversation = useRestoreConversation(showError);

  // Rename conversation handler for TabBar
  const handleRenameConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        setRenameConvId(id);
        setRenameValue(conv.name);
        setRenameDialogOpen(true);
      }
    },
    [conversations]
  );

  // Submit rename handler
  const handleRenameSubmit = useCallback(() => {
    if (renameConvId && renameValue.trim()) {
      updateConversation(renameConvId, { name: renameValue.trim() });
    }
    setRenameDialogOpen(false);
    setRenameConvId(null);
    setRenameValue('');
  }, [renameConvId, renameValue, updateConversation]);

  if (!selectedSessionId) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-chat-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 rounded-lg bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Terminal className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-medium mb-2">No session selected</h3>
            <p className="text-sm text-muted-foreground">
              Select a session from the sidebar to begin.
            </p>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-chat-background">
      {/* Branch sync banner - shows when origin/main has updates */}
      {branchSyncBanner && branchSyncStatus && branchSyncStatus.behindBy > 0 && !branchSyncDismissed && (
        <BranchSyncBanner
          status={branchSyncStatus}
          loading={branchSyncing}
          onRebase={handleBranchRebase}
          onMerge={handleBranchMerge}
          onDismiss={handleBranchDismiss}
        />
      )}

      {/* Claude auth banner - shows when no API key / credentials configured */}
      {claudeAuthConfigured === false && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-xs text-amber-200/90">
              No credentials configured. Agents cannot run without an API key or Claude subscription.
            </span>
            <button
              className="ml-auto flex items-center gap-1 text-xs text-amber-300 hover:text-amber-100 transition-colors shrink-0"
              onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: { category: 'ai-models' } }))}
            >
              <Settings2 className="h-3 w-3" />
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* AWS SSO token expiry warning */}
      {claudeAuthStatus?.hasBedrock && claudeAuthStatus.ssoTokenValid === false && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-xs text-amber-200/90">
              AWS SSO token has expired. Refresh credentials to use Bedrock.
            </span>
            <button
              className="ml-auto flex items-center gap-1 text-xs text-amber-300 hover:text-amber-100 transition-colors shrink-0 disabled:opacity-50"
              disabled={awsRefreshing}
              onClick={async () => {
                setAwsRefreshing(true);
                try {
                  await refreshAWSCredentials();
                  refreshClaudeAuthStatus();
                } catch {
                  // Error shown via ErrorDisplay when the agent request itself fails.
                } finally {
                  setAwsRefreshing(false);
                }
              }}
            >
              {awsRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
              {awsRefreshing ? 'Refreshing...' : 'Refresh AWS Credentials'}
            </button>
          </div>
        </div>
      )}

      {/* Agent crash recovery banner */}
      {streamingRecovery && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span className="text-xs text-amber-200/90">
              Agent reconnecting... (attempt {streamingRecovery.attempt}/{streamingRecovery.maxAttempts})
            </span>
          </div>
        </div>
      )}

      {/* Interrupted conversation banner - shows when conversation was interrupted by app shutdown */}
      {selectedConversationId && (
        <InterruptedBanner conversationId={selectedConversationId} />
      )}

      {/* VS Code-style unified TabBar */}
      <TabBar
        workspaceTabs={[]}
        sessionTabs={sessionTabItems}
        conversationTabs={conversationTabItems.map((tab) => ({
          ...tab,
          // Add status indicator for conversation tabs
          icon: tab.conversation ? getStatusIndicator(tab.conversation) : undefined,
        }))}
        activeTabId={activeTabId}
        onSelectTab={handleTabSelect}
        onCloseTab={handleTabClose}
        onPinTab={(id, pinned) => pinFileTab(id, pinned)}
        onReorder={reorderFileTabs}
        onNewSession={() => handleNewConversation('task')}
        onRenameConversation={handleRenameConversation}
        onRestoreConversation={handleRestoreConversation}
        sessionId={selectedSessionId}
      />

      {/* Content Area - File viewer and messages are BOTH rendered but only one is visible.
           This keeps Pierre's Shadow DOM alive even when viewing a conversation,
           avoiding expensive Shiki re-tokenization when switching back. */}

      {/* File viewer — always rendered when tabs exist, hidden when conversation is active.
           Cached session tabs from recently-viewed sessions are also rendered (hidden) to
           keep their Pierre Shadow DOMs alive and avoid Shiki re-tokenization on switch back. */}
      {(visibleTabs.length > 0 || cachedSessionTabs.length > 0) && (
        <div className={isFileActive ? 'flex-1 min-h-0 relative' : 'hidden'}>
          {/* Cached tabs from recently-visited sessions — hidden but mounted */}
          {cachedSessionTabs.map((tab) => (
            <div key={tab.id} className="hidden">
              {tab.viewMode === 'diff' && tab.diff ? (
                <CodeViewer
                  content={tab.diff.newContent}
                  oldContent={tab.diff.oldContent}
                  filename={tab.name}
                />
              ) : !tab.loadError && !tab.isBinary && !tab.isTooLarge && !tab.isEmpty && tab.content ? (
                <CodeViewer
                  content={tab.content}
                  filename={tab.name}
                />
              ) : null}
            </div>
          ))}
          {visibleTabs.map((tab) => {
            const isActive = tab.id === selectedFileTabId;
            const tabComments = tab.path === currentFilePath ? fileComments : [];

            return (
              <div
                key={tab.id}
                className={isActive ? 'h-full' : 'hidden'}
              >
                {!fileTabsReady ? (
                  isActive ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading file...</span>
                      </div>
                    </div>
                  ) : null
                ) : tab.loadError ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center max-w-md">
                      <AlertCircle className="w-12 h-12 mx-auto mb-3 text-destructive/50" />
                      <p className="text-sm font-medium text-foreground mb-1">{tab.name}</p>
                      <p className="text-xs text-muted-foreground mb-2">Failed to load file</p>
                      <p className="text-xs text-destructive/70 mb-3">{tab.loadError}</p>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                        onClick={() => updateFileTab(tab.id, {
                          loadError: undefined,
                          content: undefined,
                          diff: undefined,
                        })}
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : tab.isBinary ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <FileQuestion className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground mb-1">{tab.name}</p>
                      <p className="text-xs text-muted-foreground">Binary file cannot be displayed</p>
                    </div>
                  </div>
                ) : tab.isTooLarge ? (
                  tab.unifiedDiff ? (
                    <div className="h-full flex flex-col">
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-amber-500 border-b border-border/50">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>File too large for inline diff — showing unified diff</span>
                      </div>
                      <pre className="flex-1 overflow-auto text-xs bg-muted/30 p-3 whitespace-pre font-mono">
                        {tab.unifiedDiff}
                      </pre>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <FileQuestion className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                        <p className="text-sm font-medium text-foreground mb-1">{tab.name}</p>
                        <p className="text-xs text-muted-foreground">File is too large to display</p>
                      </div>
                    </div>
                  )
                ) : tab.isEmpty ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <File className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground mb-1">{tab.name}</p>
                      <p className="text-xs text-muted-foreground">This file is empty</p>
                    </div>
                  </div>
                ) : tab.viewMode === 'diff' && tab.diff ? (
                  <ErrorBoundary
                    resetKeys={[tab.id]}
                    section="CodeViewer"
                    fallback={
                      <BlockErrorFallback
                        icon={FileCode}
                        title="Unable to load diff"
                        description="There was an error rendering the file diff"
                      />
                    }
                  >
                    <CodeViewer
                      content={tab.diff.newContent}
                      oldContent={tab.diff.oldContent}
                      filename={tab.name}
                      isLoading={tab.isLoading}
                      comments={tabComments}
                      onResolveComment={handleResolveComment}
                      onDeleteComment={handleDeleteComment}
                      onCreateComment={handleCreateComment}
                      scrollToLine={tab.cursorPosition?.line}
                      onChange={(newContent) => updateFileTabContent(tab.id, newContent)}
                    />
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary
                    resetKeys={[tab.id]}
                    section="CodeViewer"
                    fallback={
                      <BlockErrorFallback
                        icon={FileCode}
                        title="Unable to load file"
                        description="There was an error rendering the file content"
                      />
                    }
                  >
                    <CodeViewer
                      content={tab.content || ''}
                      filename={tab.name}
                      isLoading={tab.isLoading}
                      onChange={(newContent) => updateFileTabContent(tab.id, newContent)}
                    />
                  </ErrorBoundary>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Conversation panes — LRU cached across session switches.
           Each recent session keeps its VirtualizedMessageList mounted (hidden)
           so switching back is instant (no Virtuoso remount/measure cycle). */}
      {recentSessions.map((cached) => {
        const isCachedActive = cached.sessionId === selectedSessionId && !isFileActive;
        const cachedSession = sessionMap.get(cached.sessionId);
        const hasConvs = conversationsBySession.has(cached.sessionId);
        return (
          <CachedConversationPane
            key={cached.sessionId}
            conversationId={
              cached.sessionId === selectedSessionId
                ? selectedConversationId
                : cached.activeConversationId
            }
            isActive={isCachedActive}
            worktreePath={cachedSession?.worktreePath}
            sessionName={cachedSession?.name}
            sessionBranch={cachedSession?.branch}
            hasConversations={hasConvs}
          >
            {isCachedActive ? children : null}
          </CachedConversationPane>
        );
      })}

      {/* Rename Conversation Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[300px]">
          <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRenameSubmit();
              }
            }}
            placeholder="Enter new name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session Handoff Dialog — triggered by ContextMeter or RunSummaryBlock */}
      {selectedConversationId && selectedWorkspaceId && selectedSessionId && (
        <SessionHandoffDialog
          open={showHandoff}
          onOpenChange={setShowHandoff}
          conversationId={selectedConversationId}
          workspaceId={selectedWorkspaceId}
          sessionId={selectedSessionId}
        />
      )}
    </div>
  );
}




