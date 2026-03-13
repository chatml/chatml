/**
 * Zustand selector hooks for optimized store subscriptions.
 *
 * These hooks use Zustand's shallow comparison to prevent unnecessary re-renders
 * when unrelated store state changes. Components should use these instead of
 * destructuring from useAppStore() directly.
 *
 * Pattern:
 * - Use useShallow for objects with multiple properties constructed from state
 * - Use direct selector for single primitives or existing store values
 * - Scope to specific conversation/session IDs where possible
 *
 * IMPORTANT: Selectors that filter arrays (useMessages, useActiveTools) create new
 * array references on every store update. Consumers should wrap results with useMemo
 * if referential stability is needed for downstream dependencies.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from './appStore';
import { useSettingsStore } from './settingsStore';
import { useNavigationStore } from './navigationStore';
import { useTabStore } from './tabStore';
import type { Message, Conversation, AgentTodoItem, CustomTodoItem, TerminalInstance, ReviewComment, ActiveTool, SubAgent, SessionActivityState } from '@/lib/types';

// Stable empty arrays to avoid creating new references
// Using readonly to prevent accidental mutations
const EMPTY_MESSAGES: readonly Message[] = [];
const EMPTY_TOOLS: readonly ActiveTool[] = [];
const EMPTY_AGENT_TODOS: readonly AgentTodoItem[] = [];
const EMPTY_CUSTOM_TODOS: readonly CustomTodoItem[] = [];
const EMPTY_TERMINAL_INSTANCES: readonly TerminalInstance[] = [];
const EMPTY_REVIEW_COMMENTS: readonly ReviewComment[] = [];
const EMPTY_CONVERSATIONS: readonly Conversation[] = [];
const EMPTY_SUB_AGENTS: readonly SubAgent[] = [];
const EMPTY_ACTIVE_IDS: readonly string[] = [];
const EMPTY_SEGMENT_STUBS: readonly { id: string; timestamp: number }[] = [];
const EMPTY_FILE_COMMENT_STATS = new Map<string, { total: number; unresolved: number }>();

// ============================================================================
// Conversation State
// ============================================================================

/**
 * Conversation list and selection state.
 * Use in: ConversationArea, HistoryPanel, components that need conversation list
 */
export const useConversationState = () =>
  useAppStore(
    useShallow((s) => ({
      conversations: s.conversations,
      selectedConversationId: s.selectedConversationId,
      selectConversation: s.selectConversation,
      addConversation: s.addConversation,
      removeConversation: s.removeConversation,
      updateConversation: s.updateConversation,
    }))
  );

/**
 * Messages for a specific conversation.
 * Use in: ConversationArea, MessageList
 *
 * O(1) lookup into messagesByConversation. The returned array reference is
 * stable when unrelated store state changes, so useShallow is still used
 * to handle cases where the bucket array is replaced (e.g., new message added).
 */
export const useMessages = (conversationId: string | null) =>
  useAppStore(
    useShallow((s) =>
      conversationId
        ? s.messagesByConversation[conversationId] ?? EMPTY_MESSAGES
        : EMPTY_MESSAGES
    )
  );

/**
 * Pagination state for a specific conversation's messages.
 * Use in: ConversationArea, VirtualizedMessageList for infinite scroll
 */
export const useMessagePagination = (conversationId: string | null) =>
  useAppStore((s) => (conversationId ? s.messagePagination[conversationId] ?? null : null));

/**
 * Check if a conversation has any user messages.
 * Use in: ConversationArea for "fresh conversation" indicator
 *
 * This is more efficient than filtering all messages when you only need
 * to know if user messages exist.
 */
export const useHasUserMessages = (conversationId: string | null) =>
  useAppStore((s) =>
    conversationId
      ? (s.messagesByConversation[conversationId] ?? []).some((m) => m.role === 'user')
      : false
  );

// Stable empty array for conversations with user messages
const EMPTY_CONVERSATION_IDS: readonly string[] = [];

/**
 * Get an array of conversation IDs that have user messages.
 * Use in: ConversationArea for checking "fresh" status across multiple conversations
 *
 * This avoids subscribing to the entire messages array when you need to check
 * freshness for multiple conversations (e.g., in tab rendering).
 *
 * Returns a stable reference when empty to avoid infinite re-render loops.
 */
export const useConversationsWithUserMessages = () =>
  useAppStore(
    useShallow((s) => {
      const ids: string[] = [];
      for (const [convId, msgs] of Object.entries(s.messagesByConversation)) {
        if (msgs.some((m) => m.role === 'user')) {
          ids.push(convId);
        }
      }
      return ids.length > 0 ? ids : EMPTY_CONVERSATION_IDS;
    })
  );

/**
 * Conversations for a specific session.
 */
export const useSessionConversations = (sessionId: string | null) =>
  useAppStore(
    useShallow((s) =>
      sessionId
        ? (s.conversationsBySession[sessionId] ?? EMPTY_CONVERSATIONS)
        : EMPTY_CONVERSATIONS
    )
  );

/**
 * Derive the activity state for a session's active conversation.
 * Priority: awaiting_input > awaiting_approval > working > idle.
 *
 * Replaces the binary `isAgentActive` check in the sidebar.
 * Returns a string primitive — Zustand's default `===` comparison
 * prevents re-renders when the computed state hasn't changed.
 * Use in: WorkspaceSidebar SessionRow
 */
export const useSessionActivityState = (sessionId: string): SessionActivityState =>
  useAppStore(
    useCallback(
      (state) => {
        let highestState: SessionActivityState = 'idle';
        const convs = state.conversationsBySession[sessionId] ?? [];

        for (const c of convs) {
          if (c.status !== 'active') continue;

          const convId = c.id;
          if (state.pendingUserQuestion[convId]) return 'awaiting_input';
          if (state.streamingState[convId]?.pendingPlanApproval) {
            highestState = 'awaiting_approval';
          } else if (state.streamingState[convId]?.isStreaming && highestState === 'idle') {
            highestState = 'working';
          }
        }

        return highestState;
      },
      [sessionId]
    )
  );

/**
 * Return only sessions that have a non-idle activity state.
 * Uses a single store subscription to check all sessions at once,
 * avoiding per-session hook overhead in list views.
 */
export const useActiveSessions = <T extends { id: string }>(sessions: T[]): T[] => {
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  const activeIds = useAppStore(
    useShallow(
      useCallback(
        (state) => {
          const ids: string[] = [];
          for (const sid of sessionIds) {
            let activity: SessionActivityState = 'idle';
            const convs = state.conversationsBySession[sid] ?? [];
            for (const c of convs) {
              if (c.status !== 'active') continue;
              const convId = c.id;
              if (state.pendingUserQuestion[convId]) { activity = 'awaiting_input'; break; }
              if (state.streamingState[convId]?.pendingPlanApproval) {
                activity = 'awaiting_approval';
              } else if (state.streamingState[convId]?.isStreaming && activity === 'idle') {
                activity = 'working';
              }
            }
            if (activity !== 'idle') ids.push(sid);
          }
          return ids.length > 0 ? ids : EMPTY_ACTIVE_IDS;
        },
        [sessionIds]
      )
    )
  );

  return useMemo(
    () => sessions.filter((s) => activeIds.includes(s.id)),
    [sessions, activeIds]
  );
};

/**
 * Whether a session has unread agent completions.
 * Use in: WorkspaceSidebar SessionRow
 */
export const useIsSessionUnread = (sessionId: string): boolean =>
  useSettingsStore((s) => s.unreadSessions.includes(sessionId));

// ============================================================================
// Streaming State
// ============================================================================

/**
 * Streaming state scoped to a single conversation.
 * @deprecated Use useStreamingMeta, useStreamingSegmentIds, useStreamingSegmentText,
 * useStreamingConversationArea, or useStreamingChatInput instead for fine-grained subscriptions.
 */
export const useStreamingState = (conversationId: string | null) =>
  useAppStore((s) => (conversationId ? s.streamingState[conversationId] ?? null : null));

/**
 * Structural streaming metadata — changes only on discrete events (thinking start,
 * plan approval, error, etc.), NOT on every text or thinking delta.
 * Thinking *text* is excluded — subscribe to it separately via useStreamingThinking
 * so that thinking token deltas don't recompute the timeline.
 * Use in: StreamingMessage (timeline useMemo)
 */
export const useStreamingMeta = (conversationId: string | null) =>
  useAppStore(
    useShallow((s) => {
      const st = conversationId ? s.streamingState[conversationId] : null;
      if (!st) return null;
      return {
        isStreaming: st.isStreaming,
        isThinking: st.isThinking,
        hasThinking: !!st.thinking,
        error: st.error,
        startTime: st.startTime,
        planModeActive: st.planModeActive,
        pendingPlanApproval: st.pendingPlanApproval,
        approvedPlanContent: st.approvedPlanContent,
        approvedPlanTimestamp: st.approvedPlanTimestamp,
        recovery: st.recovery,
        turnStartMeta: st.turnStartMeta,
      };
    })
  );

/**
 * Thinking text content — changes on every thinking token delta.
 * Separated from useStreamingMeta so thinking deltas don't recompute the timeline.
 * Returns a primitive string (no useShallow needed).
 * Use in: StreamingThinkingSegment
 */
export const useStreamingThinking = (conversationId: string | null) =>
  useAppStore((s) => {
    if (!conversationId) return '';
    return s.streamingState[conversationId]?.thinking ?? '';
  });

/**
 * Segment id+timestamp stubs for timeline structure — changes only when a new
 * segment is created, not on every text append within an existing segment.
 * Uses a custom equality function that compares id+timestamp per element,
 * because useShallow would fail on the fresh objects produced by .map().
 * Use in: StreamingMessage (timeline useMemo)
 */
const segmentStubsEqual = (
  a: readonly { id: string; timestamp: number }[],
  b: readonly { id: string; timestamp: number }[]
): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].timestamp !== b[i].timestamp) return false;
  }
  return true;
};

export function useStreamingSegmentIds(conversationId: string | null) {
  const prevRef = useRef(EMPTY_SEGMENT_STUBS);
  return useAppStore((s) => {
    const segments = conversationId
      ? s.streamingState[conversationId]?.segments
      : undefined;
    if (!segments || segments.length === 0) {
      prevRef.current = EMPTY_SEGMENT_STUBS;
      return EMPTY_SEGMENT_STUBS;
    }
    const next = segments.map((seg) => ({ id: seg.id, timestamp: seg.timestamp }));
    if (segmentStubsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  });
}

/**
 * Text content of a single segment — only the component rendering this segment
 * re-renders on text deltas. Returns a primitive string (no useShallow needed).
 * Use in: StreamingTextSegment
 */
export const useStreamingSegmentText = (conversationId: string, segmentId: string) =>
  useAppStore((s) => {
    const seg = s.streamingState[conversationId]?.segments?.find(
      (seg) => seg.id === segmentId
    );
    return seg?.text ?? '';
  });

/**
 * Minimal streaming fields for ConversationArea.
 * Use in: ConversationArea
 */
export const useStreamingConversationArea = (conversationId: string | null) =>
  useAppStore(
    useShallow((s) => {
      const st = conversationId ? s.streamingState[conversationId] : null;
      return {
        isStreaming: st?.isStreaming ?? false,
        recovery: st?.recovery,
        hasPendingPlanApproval: !!st?.pendingPlanApproval,
      };
    })
  );

/**
 * Minimal streaming fields for ChatInput.
 * Use in: ChatInput
 */
export const useStreamingChatInput = (conversationId: string | null) =>
  useAppStore(
    useShallow((s) => {
      const st = conversationId ? s.streamingState[conversationId] : null;
      return {
        isStreaming: st?.isStreaming ?? false,
        pendingPlanApproval: st?.pendingPlanApproval ?? null,
        planModeActive: st?.planModeActive ?? false,
      };
    })
  );

/**
 * Active tools scoped to a conversation.
 * Use in: StreamingMessage, ToolDisplay
 */
export const useActiveTools = (conversationId: string | null) =>
  useAppStore((s) => (conversationId ? s.activeTools[conversationId] ?? EMPTY_TOOLS : EMPTY_TOOLS));

/**
 * Sub-agents scoped to a conversation.
 * Use in: StreamingMessage, SubAgentGroup
 */
export const useSubAgents = (conversationId: string | null) =>
  useAppStore((s) => (conversationId ? s.subAgents[conversationId] ?? EMPTY_SUB_AGENTS : EMPTY_SUB_AGENTS));

// ============================================================================
// File Tab State
// ============================================================================

/**
 * File tab list, selection, and actions.
 * Use in: ConversationArea, TabBar
 */
export const useFileTabState = () =>
  useAppStore(
    useShallow((s) => ({
      fileTabs: s.fileTabs,
      selectedFileTabId: s.selectedFileTabId,
      pendingCloseFileTabId: s.pendingCloseFileTabId,
      selectFileTab: s.selectFileTab,
      closeFileTab: s.closeFileTab,
      openFileTab: s.openFileTab,
      pinFileTab: s.pinFileTab,
      closeOtherTabs: s.closeOtherTabs,
      closeTabsToRight: s.closeTabsToRight,
      reorderFileTabs: s.reorderFileTabs,
      updateFileTab: s.updateFileTab,
      updateFileTabContent: s.updateFileTabContent,
      setPendingCloseFileTabId: s.setPendingCloseFileTabId,
    }))
  );

// ============================================================================
// Workspace/Session Selection
// ============================================================================

/**
 * Workspace and session lists with selection state.
 * Use in: TopBar, WorkspaceSidebar
 */
export const useWorkspaceSelection = () =>
  useAppStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      sessions: s.sessions,
      selectedWorkspaceId: s.selectedWorkspaceId,
      selectedSessionId: s.selectedSessionId,
    }))
  );

/**
 * Just the selected IDs for components that don't need the full lists.
 * Use in: Components that only need to know what's selected
 */
export const useSelectedIds = () =>
  useAppStore(
    useShallow((s) => ({
      selectedWorkspaceId: s.selectedWorkspaceId,
      selectedSessionId: s.selectedSessionId,
      selectedConversationId: s.selectedConversationId,
    }))
  );

// ============================================================================
// Terminal State
// ============================================================================

/**
 * Terminal instances for a specific session.
 * Use in: BottomTerminal
 */
export const useTerminalState = (sessionId: string | null) =>
  useAppStore(
    useShallow((s) => ({
      instances: sessionId ? s.terminalInstances[sessionId] ?? EMPTY_TERMINAL_INSTANCES : EMPTY_TERMINAL_INSTANCES,
      activeId: sessionId ? s.activeTerminalId[sessionId] : null,
      createTerminal: s.createTerminal,
      closeTerminal: s.closeTerminal,
      setActiveTerminal: s.setActiveTerminal,
      markTerminalExited: s.markTerminalExited,
    }))
  );

/**
 * All terminal instances across all sessions.
 * Use in: BottomTerminal (for persistent rendering of all sessions' terminals)
 */
export const useAllTerminalInstances = () =>
  useAppStore(
    useShallow((s) => ({
      allInstances: s.terminalInstances,
      allActiveIds: s.activeTerminalId,
    }))
  );

/**
 * Terminal panel visibility for a specific session.
 * Returns false (collapsed) by default — panels start hidden.
 */
export const useTerminalPanelVisible = (sessionId: string | null) =>
  useAppStore((s) => (sessionId ? s.terminalPanelVisible[sessionId] ?? false : false));

// ============================================================================
// Todo State
// ============================================================================

/**
 * Todo items for conversation and session.
 * Use in: ChangesPanel, TodoList
 */
export const useTodoState = (
  conversationId: string | null,
  sessionId: string | null
) =>
  useAppStore(
    useShallow((s) => ({
      agentTodos: conversationId ? s.agentTodos[conversationId] ?? EMPTY_AGENT_TODOS : EMPTY_AGENT_TODOS,
      customTodos: sessionId ? s.customTodos[sessionId] ?? EMPTY_CUSTOM_TODOS : EMPTY_CUSTOM_TODOS,
      setAgentTodos: s.setAgentTodos,
      addCustomTodo: s.addCustomTodo,
      toggleCustomTodo: s.toggleCustomTodo,
      deleteCustomTodo: s.deleteCustomTodo,
    }))
  );

// ============================================================================
// Scalar Values
// ============================================================================

/**
 * Total cost tracking.
 * Use in: TopBar, CostDisplay
 */
export const useTotalCost = () => useAppStore((s) => s.totalCost);

/**
 * File changes list.
 * Use in: ChangesPanel
 */
export const useFileChanges = () => useAppStore((s) => s.fileChanges);

/**
 * MCP servers.
 * Use in: McpStatus
 */
export const useMcpServers = () => useAppStore((s) => s.mcpServers);

/**
 * MCP server source origins (server name → source).
 * Use in: McpServersPanel
 */
export const useMcpServerSources = () => useAppStore((s) => s.mcpServerSources);

// ============================================================================
// Review Comments State
// ============================================================================

/**
 * Review comments for a specific session.
 * Use in: ChangesPanel, MonacoDiffEditor
 */
export const useReviewComments = (sessionId: string | null) =>
  useAppStore((s) =>
    sessionId ? s.reviewComments[sessionId] ?? EMPTY_REVIEW_COMMENTS : EMPTY_REVIEW_COMMENTS
  );

/**
 * Comment statistics per file for a session.
 * Returns a Map of filePath to { total, unresolved } counts.
 * Use in: ChangesPanel for badge display
 *
 * Derives stats from useReviewComments via useMemo to ensure referential
 * stability. The previous implementation created a new Map inside the Zustand
 * selector on every store update, which caused React's useSyncExternalStore
 * to detect a new snapshot each time, leading to infinite re-render loops.
 */
export const useFileCommentStats = (sessionId: string | null) => {
  const comments = useReviewComments(sessionId);

  return useMemo(() => {
    if (!comments || comments.length === 0) {
      return EMPTY_FILE_COMMENT_STATS;
    }

    const stats = new Map<string, { total: number; unresolved: number }>();
    for (const comment of comments) {
      const current = stats.get(comment.filePath) || { total: 0, unresolved: 0 };
      current.total++;
      if (!comment.resolved) current.unresolved++;
      stats.set(comment.filePath, current);
    }

    return stats;
  }, [comments]);
};

/**
 * Review comment actions for components that need to modify comments.
 * Use in: CommentThread, MonacoDiffEditor
 */
export const useReviewCommentActions = () =>
  useAppStore(
    useShallow((s) => ({
      addReviewComment: s.addReviewComment,
      updateReviewComment: s.updateReviewComment,
      deleteReviewComment: s.deleteReviewComment,
      setReviewComments: s.setReviewComments,
    }))
  );

// ============================================================================
// ChatInput Actions
// ============================================================================

/**
 * Actions needed by ChatInput that don't carry data dependencies.
 * useShallow required — see usePageActions comment.
 * Action refs are stable, so this selector never triggers re-renders after init.
 * Use in: ChatInput
 */
export const useChatInputActions = () =>
  useAppStore(
    useShallow((s) => ({
      addMessage: s.addMessage,
      setStreaming: s.setStreaming,
      addQueuedMessage: s.addQueuedMessage,
      removeQueuedMessage: s.removeQueuedMessage,
      clearQueuedMessages: s.clearQueuedMessages,
      clearPendingPlanApproval: s.clearPendingPlanApproval,
      setApprovedPlanContent: s.setApprovedPlanContent,
      clearApprovedPlanContent: s.clearApprovedPlanContent,
      clearActiveTools: s.clearActiveTools,
      finalizeStreamingMessage: s.finalizeStreamingMessage,
      setPlanModeActive: s.setPlanModeActive,
      clearInputSuggestion: s.clearInputSuggestion,
      setSessionToggleState: s.setSessionToggleState,
      setDraftInput: s.setDraftInput,
      clearDraftInput: s.clearDraftInput,
    }))
  );

// ============================================================================
// Sidebar Actions
// ============================================================================

/**
 * Actions needed by WorkspaceSidebar that don't carry data dependencies.
 * useShallow required — see usePageActions comment.
 * Action refs are stable, so this selector never triggers re-renders after init.
 * Use in: WorkspaceSidebar
 */
export const useSidebarActions = () =>
  useAppStore(
    useShallow((s) => ({
      addSession: s.addSession,
      addConversation: s.addConversation,
      reorderWorkspaces: s.reorderWorkspaces,
      removeWorkspace: s.removeWorkspace,
      updateSession: s.updateSession,
    }))
  );

// ============================================================================
// Conversation Has Messages
// ============================================================================

/**
 * Check if a conversation has any messages at all.
 * O(1) lookup into messagesByConversation — just checks array length.
 * Use in: ChatInput for ghost text vs placeholder logic
 */
export const useConversationHasMessages = (conversationId: string | null) =>
  useAppStore((s) =>
    conversationId
      ? (s.messagesByConversation[conversationId]?.length ?? 0) > 0
      : false
  );

// ============================================================================
// User Question State (AskUserQuestion tool)
// ============================================================================

/**
 * Pending user question for a specific conversation.
 * Use in: ChatInput, UserQuestionPrompt
 */
export const usePendingUserQuestion = (conversationId: string | null) =>
  useAppStore((s) => (conversationId ? s.pendingUserQuestion[conversationId] ?? null : null));

// ============================================================================
// Page-level Actions
// ============================================================================

/**
 * Actions needed by the root page component.
 * useShallow is required here: without it Zustand's default `===` comparison
 * would see a new object literal on every store update and re-render.
 * useShallow compares each property by reference — since action refs are stable,
 * it always returns the cached object.
 * Use in: page.tsx
 */
export const usePageActions = () =>
  useAppStore(
    useShallow((s) => ({
      setWorkspaces: s.setWorkspaces,
      setSessions: s.setSessions,
      setConversations: s.setConversations,
      addSession: s.addSession,
      addConversation: s.addConversation,
      removeConversation: s.removeConversation,
      selectWorkspace: s.selectWorkspace,
      selectSession: s.selectSession,
      selectConversation: s.selectConversation,
      setMessagePage: s.setMessagePage,
      prependMessages: s.prependMessages,
      setLoadingMoreMessages: s.setLoadingMoreMessages,
    }))
  );

/**
 * User question actions for components that need to modify pending questions.
 * useShallow required — see usePageActions comment.
 * Use in: UserQuestionPrompt
 */
export const useUserQuestionActions = () =>
  useAppStore(
    useShallow((s) => ({
      updateUserQuestionAnswer: s.updateUserQuestionAnswer,
      nextUserQuestion: s.nextUserQuestion,
      prevUserQuestion: s.prevUserQuestion,
      clearPendingUserQuestion: s.clearPendingUserQuestion,
    }))
  );

/**
 * Navigation history state for the active tab.
 * Provides back/forward stack info and capability booleans.
 * Use in: SidebarToolbar, NavigationHistoryPopover
 */
export const useNavigationState = (tabId?: string) => {
  const activeTabId = useNavigationStore((s) => s.activeTabId);
  const id = tabId ?? activeTabId;
  return useNavigationStore(
    useShallow((s) => {
      const tab = s.tabs[id] ?? { backStack: [], forwardStack: [] };
      return {
        canGoBack: tab.backStack.length > 0,
        canGoForward: tab.forwardStack.length > 0,
        backStack: tab.backStack,
        forwardStack: tab.forwardStack,
      };
    })
  );
};

/**
 * Browser tab state selectors.
 * Use in: BrowserTabBar, keyboard shortcut handlers
 */
export const useBrowserTabs = () =>
  useTabStore(
    useShallow((s) => ({
      tabs: s.tabs,
      tabOrder: s.tabOrder,
      activeTabId: s.activeTabId,
      tabCount: s.tabOrder.length,
    }))
  );

export const useActiveTabViewState = () =>
  useTabStore(
    useShallow((s) => {
      const tab = s.tabs[s.activeTabId];
      return {
        selectedWorkspaceId: tab?.selectedWorkspaceId ?? null,
        selectedSessionId: tab?.selectedSessionId ?? null,
        selectedConversationId: tab?.selectedConversationId ?? null,
        contentView: tab?.contentView ?? { type: 'conversation' as const },
        label: tab?.label ?? 'New Tab',
      };
    })
  );
