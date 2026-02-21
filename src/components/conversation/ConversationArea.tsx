'use client';

import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/appStore';
import {
  useConversationState,
  useFileTabState,
  useMessages,
  useMessagePagination,
  useConversationsWithUserMessages,
  useReviewComments,
  useReviewCommentActions,
  useStreamingState,
} from '@/stores/selectors';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Sparkles,
  GitBranch,
  FileQuestion,
  AlertCircle,
  File,
  ChevronDown,
  Loader2,
  Circle,
  CheckCircle2,
  Terminal,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileTab, Conversation } from '@/lib/types';
import { CodeViewer } from '@/components/files/CodeViewer';
import { FileTabIcon } from '@/components/files/FileTabIcon';
import { TabBar, type TabItemData } from '@/components/tabs';
import { StreamingMessage } from '@/components/conversation/StreamingMessage';
import { QueuedMessageBubble } from '@/components/conversation/QueuedMessageBubble';
import { VirtualizedMessageList, type VirtualizedMessageListHandle } from '@/components/conversation/VirtualizedMessageList';
import { ChatSearchBar, countSearchMatches } from '@/components/conversation/ChatSearchBar';
import { useShortcut } from '@/hooks/useShortcut';
import { getSessionFileContent, getSessionFileDiff, updateReviewComment, deleteReviewComment as deleteReviewCommentApi, listReviewComments, createConversation, createReviewComment, getConversationMessages, toStoreMessage, generateSummary, getConversationSummary } from '@/lib/api';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback, InlineErrorFallback } from '@/components/shared/ErrorFallbacks';
import { BranchSyncBanner } from '@/components/BranchSyncBanner';
import { BranchSyncConflictDialog } from '@/components/BranchSyncConflictDialog';
import { useBranchSync } from '@/hooks/useBranchSync';
import { useClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { KeyRound, Settings2 } from 'lucide-react';

// Module-level scroll position cache (singleton — ConversationArea is only rendered once).
// Stored outside the component to avoid ref-in-render lint issues since we read it during
// render to compute initialTopMostItemIndex for Virtuoso.
const scrollPositions = new Map<string, { dataIndex: number; wasAtBottom: boolean }>();

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
    setPendingCloseFileTabId,
  } = useFileTabState();

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
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        setDeferredSessionId(selectedSessionId);
      });
    });
    let innerRafId: number;
    return () => {
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [selectedSessionId]);
  // Session-scoped streaming state for the selected conversation only
  const selectedStreaming = useStreamingState(selectedConversationId);
  const queuedMessage = useAppStore(
    (s) => selectedConversationId ? s.queuedMessage[selectedConversationId] : null
  );
  const addMessage = useAppStore((s) => s.addMessage);

  const claudeAuthConfigured = useClaudeAuthStatus();

  // Use messages selector scoped to the selected conversation
  const allConversationMessages = useMessages(selectedConversationId);
  const pagination = useMessagePagination(selectedConversationId);
  const setMessagePage = useAppStore((s) => s.setMessagePage);
  const prependMessages = useAppStore((s) => s.prependMessages);
  const setLoadingMoreMessages = useAppStore((s) => s.setLoadingMoreMessages);
  // Get Set of conversation IDs that have user messages (avoids subscribing to all messages)
  const conversationsWithUserMessages = useConversationsWithUserMessages();

  // Hide the setupInfo system card once the user has sent their first message
  const conversationMessages = useMemo(() => {
    if (!selectedConversationId) return allConversationMessages;
    if (!conversationsWithUserMessages.includes(selectedConversationId)) return allConversationMessages;
    return allConversationMessages.filter(m => !(m.role === 'system' && m.setupInfo));
  }, [allConversationMessages, selectedConversationId, conversationsWithUserMessages]);

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

  // Load messages on-demand when conversation is selected (paginated)
  useEffect(() => {
    if (!selectedConversationId) return;

    // One-shot read via getState() — intentionally not subscribing to pagination changes
    // so this effect only fires when the conversation selection changes, not on every
    // pagination state update. If messages were already loaded (e.g., eagerly at boot),
    // skip the fetch.
    const state = useAppStore.getState();
    const existingPagination = state.messagePagination[selectedConversationId];
    if (existingPagination) return;

    // Also skip if messages were already added inline (e.g., via addConversation with messages)
    const hasInlineMessages = state.messages.some((m) => m.conversationId === selectedConversationId);
    if (hasInlineMessages) return;

    let cancelled = false;
    async function loadMessages() {
      try {
        const page = await getConversationMessages(selectedConversationId!, { limit: 50 });
        if (cancelled) return;
        const messages = page.messages.map((m) => toStoreMessage(m, selectedConversationId!));
        setMessagePage(selectedConversationId!, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
      } catch (error) {
        console.error('Failed to load conversation messages:', error);
      }
    }
    loadMessages();
    return () => { cancelled = true; };
  }, [selectedConversationId, setMessagePage]);

  // Branch sync for updating from origin/main
  const {
    status: branchSyncStatus,
    // loading: branchSyncLoading, // Available if needed for loading indicator
    syncing: branchSyncing,
    aborting: branchAborting,
    dismissed: branchSyncDismissed,
    conflictFiles: branchConflictFiles,
    lastOperation: branchLastOperation,
    rebase: doBranchRebase,
    merge: doBranchMerge,
    abort: handleBranchAbort,
    dismiss: handleBranchDismiss,
    clearConflicts: clearBranchConflicts,
  } = useBranchSync(selectedWorkspaceId, selectedSessionId);

  // Show conflict dialog when there are conflicts
  const showConflictDialog = branchConflictFiles.length > 0;

  // Wrapped handlers that add a success message to the chat
  const handleBranchRebase = useCallback(async () => {
    const result = await doBranchRebase();
    if (result?.success && selectedConversationId) {
      addMessage({
        id: `sync-${Date.now()}`,
        conversationId: selectedConversationId,
        role: 'system',
        content: 'Branch rebased successfully. Your branch is now up-to-date with origin.',
        timestamp: new Date().toISOString(),
      });
    }
  }, [doBranchRebase, selectedConversationId, addMessage]);

  const handleBranchMerge = useCallback(async () => {
    const result = await doBranchMerge();
    if (result?.success && selectedConversationId) {
      addMessage({
        id: `sync-${Date.now()}`,
        conversationId: selectedConversationId,
        role: 'system',
        content: 'Branch merged successfully. Your branch is now up-to-date with origin.',
        timestamp: new Date().toISOString(),
      });
    }
  }, [doBranchMerge, selectedConversationId, addMessage]);

  // Rename dialog state for conversations
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameConvId, setRenameConvId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Summary state
  const summaries = useAppStore((s) => s.summaries);
  const setSummary = useAppStore((s) => s.setSummary);
  const [summaryViewerOpen, setSummaryViewerOpen] = useState(false);
  const [summaryViewerConvId, setSummaryViewerConvId] = useState<string | null>(null);

  const handleGenerateSummary = useCallback(async (conversationId: string) => {
    try {
      const summary = await generateSummary(conversationId);
      setSummary(conversationId, summary);
    } catch (error) {
      console.error('Failed to generate summary:', error);
    }
  }, [setSummary]);

  const handleViewSummary = useCallback((conversationId: string) => {
    // Fetch latest if not in store
    if (!summaries[conversationId]) {
      getConversationSummary(conversationId).then((s) => {
        if (s) setSummary(conversationId, s);
      });
    }
    setSummaryViewerConvId(conversationId);
    setSummaryViewerOpen(true);
  }, [summaries, setSummary]);

  const getSummaryStatus = useCallback((conversationId: string) => {
    return summaries[conversationId]?.status ?? null;
  }, [summaries]);

  // Chat search state - keyed by conversation to auto-reset
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchState, setSearchState] = useState<{ convId: string | null; query: string; matchIndex: number }>({
    convId: null,
    query: '',
    matchIndex: 0,
  });

  // Derive search values, resetting if conversation changed
  const searchQuery = searchState.convId === selectedConversationId ? searchState.query : '';
  const currentMatchIndex = searchState.convId === selectedConversationId ? searchState.matchIndex : 0;

  const setSearchQuery = useCallback((query: string) => {
    setSearchState({ convId: selectedConversationId, query, matchIndex: 0 });
  }, [selectedConversationId]);

  const setCurrentMatchIndex = useCallback((indexOrFn: number | ((prev: number) => number)) => {
    setSearchState((prev) => ({
      ...prev,
      convId: selectedConversationId,
      matchIndex: typeof indexOrFn === 'function' ? indexOrFn(prev.matchIndex) : indexOrFn,
    }));
  }, [selectedConversationId]);

  // Compute search matches across all messages
  const searchMatches = useMemo(() => {
    if (!searchQuery) return { total: 0, messageOffsets: [] as number[] };

    let total = 0;
    const messageOffsets: number[] = [];

    for (const message of conversationMessages) {
      messageOffsets.push(total);
      total += countSearchMatches(message.content, searchQuery);
    }

    return { total, messageOffsets };
  }, [conversationMessages, searchQuery]);

  // Precompute which messages have search matches (avoids re-rendering non-matching messages)
  const messageHasMatches = useMemo(() => {
    if (!searchQuery) return [];
    return conversationMessages.map((m) => countSearchMatches(m.content, searchQuery) > 0);
  }, [conversationMessages, searchQuery]);

  // Clamp currentMatchIndex to valid range (derived, not effect-based)
  const clampedMatchIndex = searchMatches.total > 0
    ? Math.min(currentMatchIndex, searchMatches.total - 1)
    : 0;

  // Pagination: compute firstItemIndex for Virtuoso scroll stability when prepending
  const VIRTUAL_BASE_INDEX = 100_000;
  const firstItemIndex = pagination
    ? VIRTUAL_BASE_INDEX - (pagination.totalCount - conversationMessages.length)
    : VIRTUAL_BASE_INDEX;

  // Load older messages when user scrolls to top
  const handleStartReached = useCallback(async () => {
    if (!selectedConversationId || !pagination?.hasMore || pagination?.isLoadingMore) return;

    setLoadingMoreMessages(selectedConversationId, true);
    try {
      const page = await getConversationMessages(selectedConversationId, {
        before: pagination.oldestPosition ?? undefined,
        limit: 50,
      });
      const messages = page.messages.map((m) => toStoreMessage(m, selectedConversationId));
      prependMessages(selectedConversationId, messages, page.hasMore, page.oldestPosition ?? 0);
    } catch (error) {
      console.error('Failed to load older messages:', error);
      setLoadingMoreMessages(selectedConversationId, false);
    }
  }, [selectedConversationId, pagination, setLoadingMoreMessages, prependMessages]);

  // Search navigation handlers
  const goToNextMatch = useCallback(() => {
    if (searchMatches.total > 0) {
      setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.total);
    }
  }, [searchMatches.total, setCurrentMatchIndex]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.total > 0) {
      setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.total) % searchMatches.total);
    }
  }, [searchMatches.total, setCurrentMatchIndex]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  // Scroll to the message containing the current search match
  useEffect(() => {
    if (!searchQuery || searchMatches.total === 0) return;
    // Find the message index that contains the current match
    const offsets = searchMatches.messageOffsets;
    let targetIndex = 0;
    for (let i = 0; i < offsets.length; i++) {
      const nextOffset = offsets[i + 1] ?? searchMatches.total;
      if (clampedMatchIndex >= offsets[i] && clampedMatchIndex < nextOffset) {
        targetIndex = i;
        break;
      }
    }
    messageListRef.current?.scrollToIndex(targetIndex, { align: 'center', behavior: 'smooth' });
  }, [clampedMatchIndex, searchQuery, searchMatches]);

  // Register keyboard shortcuts for search
  useShortcut('searchChat', useCallback(() => {
    setSearchOpen(true);
  }, []));

  useShortcut('searchNextMatch', useCallback(() => {
    if (searchOpen) {
      goToNextMatch();
    }
  }, [searchOpen, goToNextMatch]));

  useShortcut('searchPrevMatch', useCallback(() => {
    if (searchOpen) {
      goToPrevMatch();
    }
  }, [searchOpen, goToPrevMatch]));

  // Scroll to current match when it changes
  useEffect(() => {
    if (!searchQuery || searchMatches.total === 0) return;

    // Find the mark element with the current match index
    const matchElement = document.querySelector(`mark[data-match-index="${clampedMatchIndex}"]`);
    if (matchElement) {
      matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [clampedMatchIndex, searchQuery, searchMatches.total]);

  // Scroll to the plan content when plan approval activates.
  // Uses Virtuoso's own scroll container (via getScrollerElement) instead of native
  // scrollIntoView to avoid desyncing Virtuoso's internal scroll tracking, which
  // causes blank rendering areas. Also suppresses followOutput via pendingPlanApproval
  // prop to prevent auto-scroll-to-bottom from fighting the plan scroll.
  const hasScrolledForPlanApprovalRef = useRef(false);

  useEffect(() => {
    let outerRaf: number | undefined;
    let innerRaf: number | undefined;

    if (selectedStreaming?.pendingPlanApproval) {
      if (hasScrolledForPlanApprovalRef.current) return;
      hasScrolledForPlanApprovalRef.current = true;

      // Double rAF: first lets React commit the DOM, second lets Virtuoso
      // measure and lay out the footer content.
      outerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(() => {
          const scrollerEl = messageListRef.current?.getScrollerElement();
          if (!scrollerEl) return;

          const planEl = scrollerEl.querySelector('[data-plan-id="pending-plan"]');
          if (!planEl) return;

          const OFFSET_PX = 16;
          const planRect = planEl.getBoundingClientRect();
          const scrollerRect = scrollerEl.getBoundingClientRect();
          const planTopInScroller = planRect.top - scrollerRect.top + scrollerEl.scrollTop;

          scrollerEl.scrollTo({
            top: planTopInScroller - OFFSET_PX,
            behavior: 'smooth',
          });
        });
      });
    } else {
      hasScrolledForPlanApprovalRef.current = false;
    }

    return () => {
      if (outerRaf !== undefined) cancelAnimationFrame(outerRaf);
      if (innerRaf !== undefined) cancelAnimationFrame(innerRaf);
    };
  }, [selectedStreaming?.pendingPlanApproval]);

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

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId),
    [sessions, selectedSessionId]
  );
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

  // Check if a conversation is fresh (no user messages yet)
  const isFreshConversation = useCallback(
    (convId: string) => !conversationsWithUserMessages.includes(convId),
    [conversationsWithUserMessages]
  );

  // Session-scoped streaming states for conversation tab indicators.
  // Only subscribes to isStreaming/error for this session's conversations,
  // preventing cross-session re-renders. Flattened to primitives so
  // useShallow comparison prevents unnecessary re-renders.
  const sessionConvIds = useMemo(
    () => sessionConversations.map((c) => c.id),
    [sessionConversations]
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
            <div className="w-[2px] bg-primary rounded-full animate-agent-bar-1" />
            <div className="w-[2px] bg-primary rounded-full animate-agent-bar-2" />
            <div className="w-[2px] bg-primary rounded-full animate-agent-bar-3" />
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

  // Auto-scroll management via Virtuoso
  const messageListRef = useRef<VirtualizedMessageListHandle>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Scroll position memory across tab switches.
  // We track the first visible data index per conversation via Virtuoso's rangeChanged.
  // On remount (key change), Virtuoso uses initialTopMostItemIndex — no animation, no flash.
  const isAtBottomRef = useRef(true);

  // Continuously track the visible range — called by Virtuoso on every scroll
  const handleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (!selectedConversationId) return;
    scrollPositions.set(selectedConversationId, {
      dataIndex: range.startIndex,
      wasAtBottom: isAtBottomRef.current,
    });
  }, [selectedConversationId]);

  // Compute initialTopMostItemIndex for the current conversation.
  // Read from the module-level map — this is computed fresh each render when
  // selectedConversationId changes (which triggers Virtuoso remount via key).
  const initialTopMostItemIndex = useMemo(() => {
    if (!selectedConversationId) return { index: 'LAST' as const, align: 'end' as const };
    const saved = scrollPositions.get(selectedConversationId);
    if (saved && !saved.wasAtBottom) {
      return { index: saved.dataIndex, align: 'start' as const };
    }
    // First visit or was at bottom — start at bottom
    return { index: 'LAST' as const, align: 'end' as const };
  }, [selectedConversationId]);

  // Track at-bottom state from Virtuoso
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setShowScrollButton(!atBottom);
    isAtBottomRef.current = atBottom;
  }, []);

  // Force scroll to bottom (for manual button click or message submit)
  const forceScrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    messageListRef.current?.scrollToBottom('smooth');
  }, []);

  // Stable footer for VirtualizedMessageList (avoids remounting on every render)
  const messageListFooter = useMemo(() => {
    if (!selectedConversationId) return undefined;
    return (
      <div className="pl-5 pr-12 pb-16">
        <ErrorBoundary
          section="StreamingMessage"
          fallback={<InlineErrorFallback message="Error displaying streaming message" />}
        >
          <StreamingMessage conversationId={selectedConversationId} worktreePath={currentSession?.worktreePath} />
        </ErrorBoundary>
        {queuedMessage && (
          <QueuedMessageBubble message={queuedMessage} />
        )}
      </div>
    );
  }, [selectedConversationId, queuedMessage, currentSession?.worktreePath]);

  // Listen for message submit events to force scroll to bottom
  useEffect(() => {
    const handleMessageSubmit = () => {
      forceScrollToBottom();
    };

    window.addEventListener('chat-message-submitted', handleMessageSubmit);
    return () => {
      window.removeEventListener('chat-message-submitted', handleMessageSubmit);
    };
  }, [forceScrollToBottom]);

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

  // Load content for selected file tab on mount/restore (e.g., after refresh)
  useEffect(() => {
    if (!currentFileTab || currentFileTab.isLoading) return;

    // For regular file view without content, load it from session's worktree
    // Use content === undefined to differentiate "not loaded" from "loaded but empty"
    if (currentFileTab.viewMode !== 'diff' && currentFileTab.content === undefined && !currentFileTab.isBinary && !currentFileTab.isTooLarge && !currentFileTab.isEmpty && !currentFileTab.loadError && currentFileTab.sessionId) {
      const loadContent = async () => {
        updateFileTab(currentFileTab.id, { isLoading: true });
        try {
          const fileData = await getSessionFileContent(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
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
        updateFileTab(currentFileTab.id, { isLoading: true });
        try {
          const diffData = await getSessionFileDiff(currentFileTab.workspaceId, currentFileTab.sessionId, currentFileTab.path);
          updateFileTab(currentFileTab.id, {
            diff: {
              oldContent: diffData.oldContent ?? '',
              newContent: diffData.newContent ?? '',
            },
            isLoading: false,
          });
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
      updateFileTab(id, { isLoading: true });
      try {
        const diffData = await getSessionFileDiff(tab.workspaceId, tab.sessionId, tab.path);
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
  }, [fileTabs, selectFileTab, updateFileTab]);

  // Handle resolving/unresolving a review comment
  const handleResolveComment = useCallback(async (commentId: string, resolved: boolean) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    try {
      const updatedComment = await updateReviewComment(
        selectedWorkspaceId,
        selectedSessionId,
        commentId,
        { resolved, resolvedBy: resolved ? 'You' : undefined }
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
        startTransition(() => removeConversation(id));
      }
    },
    [fileTabs, closeFileTab, removeConversation, setPendingCloseFileTabId]
  );

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
      {branchSyncStatus && branchSyncStatus.behindBy > 0 && !branchSyncDismissed && currentSession?.prStatus !== 'merged' && (
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
              No Anthropic API key configured. Agents cannot run without credentials.
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

      {/* Branch sync conflict dialog */}
      <BranchSyncConflictDialog
        open={showConflictDialog}
        onOpenChange={(open) => {
          if (!open) clearBranchConflicts();
        }}
        operation={branchLastOperation || 'rebase'}
        conflictFiles={branchConflictFiles}
        onAbort={handleBranchAbort}
        aborting={branchAborting}
      />

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
        onGenerateSummary={handleGenerateSummary}
        onViewSummary={handleViewSummary}
        getSummaryStatus={getSummaryStatus}
      />

      {/* Content Area - File viewer and messages are BOTH rendered but only one is visible.
           This keeps Pierre's Shadow DOM alive even when viewing a conversation,
           avoiding expensive Shiki re-tokenization when switching back. */}

      {/* File viewer — always rendered when tabs exist, hidden when conversation is active */}
      {visibleTabs.length > 0 && (
        <div className={isFileActive ? 'flex-1 min-h-0 relative' : 'hidden'}>
          {visibleTabs.map((tab) => {
            const isActive = tab.id === selectedFileTabId;
            const tabComments = tab.path === currentFilePath ? fileComments : [];

            return (
              <div
                key={tab.id}
                className={isActive ? 'h-full' : 'hidden'}
              >
                {!fileTabsReady && isActive ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Loading file...</span>
                    </div>
                  </div>
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
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <FileQuestion className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground mb-1">{tab.name}</p>
                      <p className="text-xs text-muted-foreground">File is too large to display</p>
                    </div>
                  </div>
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
                    />
                  </ErrorBoundary>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Conversation messages — hidden when file tab is active */}
      <div className={isFileActive ? 'hidden' : 'contents'}>
        {/* Messages */}
        <div className="relative flex-1 min-h-0">
          {/* Chat Search Bar */}
          <ChatSearchBar
            isOpen={searchOpen}
            onClose={closeSearch}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            currentMatchIndex={clampedMatchIndex}
            totalMatches={searchMatches.total}
            onNextMatch={goToNextMatch}
            onPrevMatch={goToPrevMatch}
            partialResults={pagination?.hasMore}
          />
          <VirtualizedMessageList
            key={selectedConversationId ?? 'none'}
            ref={messageListRef}
            messages={conversationMessages}
            worktreePath={currentSession?.worktreePath}
            searchQuery={searchQuery}
            currentMatchIndex={clampedMatchIndex}
            searchMatches={searchMatches}
            messageHasMatches={messageHasMatches}
            initialTopMostItemIndex={initialTopMostItemIndex}
            onRangeChanged={handleRangeChanged}
            onAtBottomStateChange={handleAtBottomStateChange}
            onStartReached={pagination?.hasMore ? handleStartReached : undefined}
            firstItemIndex={firstItemIndex}
            isLoadingOlder={pagination?.isLoadingMore}
            emptyState={
              (!selectedConversationId || conversationMessages.length === 0) ? (
                sessionConversations.length === 0
                  ? <SessionPreparingState sessionName={currentSession?.branch || currentSession?.name} />
                  : <ConversationEmptyState sessionName={currentSession?.name} />
              ) : undefined
            }
            footer={messageListFooter}
            isStreaming={selectedStreaming?.isStreaming ?? false}
            pendingPlanApproval={!!selectedStreaming?.pendingPlanApproval}
          />
          {/* Fade overlay at bottom of messages */}
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-chat-background to-transparent pointer-events-none z-10" />
        </div>

        {/* Chat Input with floating scroll button */}
        <div className="shrink-0 relative">
          {/* Scroll to bottom button - floating */}
          <div className={cn(
            "absolute -top-7 right-4 z-10 transition-opacity duration-200",
            showScrollButton ? "opacity-100" : "opacity-0 pointer-events-none"
          )}>
            <Button
              variant="secondary"
              size="sm"
              className="h-6 gap-1 pl-1 pr-2 text-xs rounded-full border border-border/50 bg-background/30 backdrop-blur-sm text-muted-foreground/70 hover:text-muted-foreground hover:bg-background/50 transition-colors"
              onClick={forceScrollToBottom}
            >
              <ChevronDown className="h-3 w-3" />
              Scroll to bottom
            </Button>
          </div>
          {children}
        </div>
      </div>

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

      {/* Summary Viewer Dialog */}
      <Dialog open={summaryViewerOpen} onOpenChange={setSummaryViewerOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[60vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conversation Summary</DialogTitle>
          </DialogHeader>
          {summaryViewerConvId && summaries[summaryViewerConvId] ? (
            <div className="text-sm whitespace-pre-wrap text-foreground">
              {summaries[summaryViewerConvId].content}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Loading summary...</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSummaryViewerOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionPreparingState({ sessionName }: { sessionName?: string }) {
  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="max-w-lg mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6 animate-scale-in">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <div className="flex items-center justify-center gap-2 mb-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display">Preparing session</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Setting up your workspace and git branch...
        </p>
      </div>
    </div>
  );
}

function ConversationEmptyState({ sessionName }: { sessionName?: string }) {
  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="max-w-lg mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6 animate-scale-in">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display mb-2">New Session</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Describe your task below. An AI agent will work on it in an isolated git branch.
        </p>
        <div className="text-left bg-background rounded-lg p-4 space-y-3 border border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Example tasks</p>
          <div className="space-y-2 text-sm stagger-children">
            <p className="text-muted-foreground">&quot;Add user authentication with JWT tokens&quot;</p>
            <p className="text-muted-foreground">&quot;Write unit tests for the payment service&quot;</p>
            <p className="text-muted-foreground">&quot;Refactor the API to use async/await&quot;</p>
          </div>
        </div>
      </div>
    </div>
  );
}


