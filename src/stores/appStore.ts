import { create } from 'zustand';
import type {
  Workspace,
  WorktreeSession,
  Conversation,
  Message,
  FileChange,
  FileTab,
  TerminalSession,
  TerminalInstance,
  Repo,
  Agent,
  AgentTodoItem,
  CustomTodoItem,
  McpServerStatus,
  CheckpointInfo,
  BudgetStatus,
  ContextUsage,
  ToolUsage,
  RunSummary,
  ReviewComment,
  BranchSyncStatus,
  PendingUserQuestion,
  ActiveTool,
} from '@/lib/types';

// Maximum number of file tabs before LRU eviction kicks in
const MAX_FILE_TABS = 10;

// Default streaming state for a conversation (avoids repeating defaults across actions)
const DEFAULT_STREAMING: StreamingState = {
  text: '',
  segments: [],
  currentSegmentId: null,
  isStreaming: false,
  error: null,
  thinking: null,
  isThinking: false,
  planModeActive: false,
  awaitingPlanApproval: false,
  startTime: undefined,
};

/**
 * Update streaming state for a single conversation without repeating defaults.
 * Spreads the current state, applies defaults for missing fields, then applies updates.
 */
function updateStreamingConv(
  allStreaming: Record<string, StreamingState>,
  conversationId: string,
  updates: Partial<StreamingState>,
): Record<string, StreamingState> {
  const current = allStreaming[conversationId];
  return {
    ...allStreaming,
    [conversationId]: {
      ...DEFAULT_STREAMING,
      ...current,
      ...updates,
    },
  };
}

interface SessionOutput {
  [sessionId: string]: string[];
}

// Text segment for interleaved timeline display
interface TextSegment {
  id: string;
  text: string;
  timestamp: number; // When this segment started
}

// Streaming state for conversations
interface StreamingState {
  text: string; // Legacy: full accumulated text for compatibility
  segments: TextSegment[]; // Text segments for interleaved display
  currentSegmentId: string | null; // Current segment being appended to
  isStreaming: boolean;
  error: string | null;
  thinking: string | null; // Current thinking content being streamed
  isThinking: boolean;
  startTime?: number; // When streaming started (for elapsed time)
  planModeActive: boolean; // Whether plan mode is active for this conversation
  awaitingPlanApproval: boolean; // Whether we're waiting for user to approve ExitPlanMode
}

// ActiveTool is imported from @/lib/types

interface AppState {
  // New data model
  workspaces: Workspace[];
  sessions: WorktreeSession[];
  conversations: Conversation[];
  messages: Message[];
  fileChanges: FileChange[];

  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  selectedConversationId: string | null;

  // File tabs
  fileTabs: FileTab[];
  selectedFileTabId: string | null;
  pendingCloseFileTabId: string | null; // For close confirmation dialog

  sessionOutputs: SessionOutput;
  terminalSessions: Record<string, TerminalSession>;
  totalCost: number;

  // Conversation streaming state
  streamingState: { [conversationId: string]: StreamingState };
  activeTools: { [conversationId: string]: ActiveTool[] };

  // Todo state
  agentTodos: { [conversationId: string]: AgentTodoItem[] };
  customTodos: { [sessionId: string]: CustomTodoItem[] };

  // Terminal instances (bottom panel terminals per session)
  terminalInstances: Record<string, TerminalInstance[]>; // keyed by sessionId
  activeTerminalId: Record<string, string | null>;       // keyed by sessionId

  // MCP servers state
  mcpServers: McpServerStatus[];

  // Checkpoint timeline state
  checkpoints: CheckpointInfo[];
  budgetStatus: BudgetStatus | null;

  // Context window usage (keyed by conversationId)
  contextUsage: { [conversationId: string]: ContextUsage };

  // Review comments state (keyed by sessionId)
  reviewComments: { [sessionId: string]: ReviewComment[] };

  // Branch sync state (keyed by sessionId)
  branchSyncStatus: { [sessionId: string]: BranchSyncStatus | null };
  branchSyncLoading: { [sessionId: string]: boolean };
  branchSyncDismissed: { [sessionId: string]: boolean };
  // Timestamp of last successful sync (triggers changes panel refresh)
  branchSyncCompletedAt: { [sessionId: string]: number };

  // Pending user questions from AskUserQuestion tool (keyed by conversationId)
  pendingUserQuestion: { [conversationId: string]: PendingUserQuestion | null };

  // File watcher: last file change event (for reactive subscriptions)
  lastFileChange: { workspaceId: string; path: string; fullPath: string; timestamp: number } | null;

  // Workspace actions
  setWorkspaces: (workspaces: Workspace[]) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  selectWorkspace: (id: string | null) => void;
  reorderWorkspaces: (activeId: string, overId: string) => void;

  // Session actions
  setSessions: (sessions: WorktreeSession[]) => void;
  addSession: (session: WorktreeSession) => void;
  updateSession: (id: string, updates: Partial<WorktreeSession>) => void;
  removeSession: (id: string) => void;
  selectSession: (id: string | null) => void;
  archiveSession: (id: string) => void;
  unarchiveSession: (id: string) => void;

  // Conversation actions
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  selectConversation: (id: string | null) => void;

  // Message actions
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;

  // File changes
  setFileChanges: (changes: FileChange[]) => void;

  // File tabs actions
  setFileTabs: (tabs: FileTab[]) => void;
  openFileTab: (tab: FileTab) => void;
  closeFileTab: (id: string) => void;
  selectFileTab: (id: string | null) => void;
  updateFileTab: (id: string, updates: Partial<FileTab>) => void;
  updateFileTabContent: (id: string, content: string) => void;
  reorderFileTabs: (activeId: string, overId: string) => void;
  pinFileTab: (id: string, pinned: boolean) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  selectNextTab: () => void;
  selectPreviousTab: () => void;
  setPendingCloseFileTabId: (id: string | null) => void;

  // Output
  appendOutput: (sessionId: string, line: string) => void;
  clearOutput: (sessionId: string) => void;

  // Terminal sessions
  createTerminalSession: (session: TerminalSession) => void;
  updateTerminalSession: (id: string, updates: Partial<TerminalSession>) => void;
  closeTerminalSession: (id: string) => void;

  // Cost
  addCost: (amount: number) => void;

  // Streaming state actions
  appendStreamingText: (conversationId: string, text: string) => void;
  setStreaming: (conversationId: string, isStreaming: boolean) => void;
  setStreamingError: (conversationId: string, error: string | null) => void;
  clearStreamingText: (conversationId: string) => void;
  appendThinkingText: (conversationId: string, text: string) => void;
  setThinking: (conversationId: string, isThinking: boolean) => void;
  clearThinking: (conversationId: string) => void;
  setPlanModeActive: (conversationId: string, active: boolean) => void;
  setAwaitingPlanApproval: (conversationId: string, awaiting: boolean) => void;
  addActiveTool: (conversationId: string, tool: ActiveTool) => void;
  completeActiveTool: (conversationId: string, toolId: string, success?: boolean, summary?: string, stdout?: string, stderr?: string) => void;
  clearActiveTools: (conversationId: string) => void;

  // Atomic streaming finalization - creates message and clears streaming in one update
  finalizeStreamingMessage: (
    conversationId: string,
    metadata: {
      durationMs?: number;
      toolUsage?: ToolUsage[];
      runSummary?: RunSummary;
    }
  ) => void;

  // Todo actions
  setAgentTodos: (conversationId: string, todos: AgentTodoItem[]) => void;
  clearAgentTodos: (conversationId: string) => void;
  addCustomTodo: (sessionId: string, content: string) => void;
  toggleCustomTodo: (sessionId: string, todoId: string) => void;
  deleteCustomTodo: (sessionId: string, todoId: string) => void;

  // Terminal instance actions (bottom panel)
  createTerminal: (sessionId: string) => TerminalInstance | null;
  closeTerminal: (sessionId: string, terminalId: string) => void;
  setActiveTerminal: (sessionId: string, terminalId: string) => void;
  markTerminalExited: (terminalId: string) => void;

  // MCP servers actions
  setMcpServers: (servers: McpServerStatus[]) => void;

  // Checkpoint actions
  setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
  addCheckpoint: (checkpoint: CheckpointInfo) => void;
  clearCheckpoints: () => void;
  setBudgetStatus: (status: BudgetStatus | null) => void;

  // Context usage actions
  setContextUsage: (conversationId: string, usage: Partial<ContextUsage>) => void;
  clearContextUsage: (conversationId: string) => void;

  // Review comments actions
  setReviewComments: (sessionId: string, comments: ReviewComment[]) => void;
  addReviewComment: (sessionId: string, comment: ReviewComment) => void;
  updateReviewComment: (sessionId: string, id: string, updates: Partial<ReviewComment>) => void;
  deleteReviewComment: (sessionId: string, id: string) => void;

  // Branch sync actions
  setBranchSyncStatus: (sessionId: string, status: BranchSyncStatus | null) => void;
  setBranchSyncLoading: (sessionId: string, loading: boolean) => void;
  setBranchSyncDismissed: (sessionId: string, dismissed: boolean) => void;
  setBranchSyncCompletedAt: (sessionId: string, timestamp: number) => void;
  clearBranchSyncStatus: (sessionId: string) => void;

  // User question actions (AskUserQuestion tool)
  setPendingUserQuestion: (conversationId: string, question: PendingUserQuestion | null) => void;
  updateUserQuestionAnswer: (conversationId: string, header: string, answer: string) => void;
  nextUserQuestion: (conversationId: string) => void;
  prevUserQuestion: (conversationId: string) => void;
  clearPendingUserQuestion: (conversationId: string) => void;

  // File watcher actions
  setLastFileChange: (event: { workspaceId: string; path: string; fullPath: string }) => void;

  // Legacy support
  repos: Repo[];
  selectedRepoId: string | null;
  agents: Agent[];
  agentOutputs: { [agentId: string]: string[] };
  setRepos: (repos: Repo[]) => void;
  addRepo: (repo: Repo) => void;
  removeRepo: (id: string) => void;
  selectRepo: (id: string | null) => void;
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (agentId: string, status: Agent['status']) => void;
  removeAgent: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // New state
  workspaces: [],
  sessions: [],
  conversations: [],
  messages: [],
  fileChanges: [],
  selectedWorkspaceId: null,
  selectedSessionId: null,
  selectedConversationId: null,
  fileTabs: [],
  selectedFileTabId: null,
  pendingCloseFileTabId: null,
  sessionOutputs: {},
  terminalSessions: {},
  totalCost: 0,
  streamingState: {},
  activeTools: {},
  agentTodos: {},
  customTodos: {},
  terminalInstances: {},
  activeTerminalId: {},
  mcpServers: [],
  checkpoints: [],
  budgetStatus: null,
  contextUsage: {},
  reviewComments: {},
  branchSyncStatus: {},
  branchSyncLoading: {},
  branchSyncDismissed: {},
  branchSyncCompletedAt: {},
  pendingUserQuestion: {},
  lastFileChange: null,

  // Workspace actions
  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (workspace) => set((state) => ({
    workspaces: [...state.workspaces, workspace]
  })),
  removeWorkspace: (id) => set((state) => {
    // Get all sessions for this workspace
    const workspaceSessions = state.sessions.filter((s) => s.workspaceId === id);
    const workspaceSessionIds = workspaceSessions.map((s) => s.id);

    // Get all conversation IDs for these sessions
    const workspaceConvIds = state.conversations
      .filter((c) => workspaceSessionIds.includes(c.sessionId))
      .map((c) => c.id);

    // Clean up streaming state, active tools, and agent todos
    const cleanedStreamingState = { ...state.streamingState };
    const cleanedActiveTools = { ...state.activeTools };
    const cleanedAgentTodos = { ...state.agentTodos };
    for (const convId of workspaceConvIds) {
      delete cleanedStreamingState[convId];
      delete cleanedActiveTools[convId];
      delete cleanedAgentTodos[convId];
    }

    // Clean up custom todos, session outputs, terminal instances, and terminal sessions for all sessions
    const cleanedCustomTodos = { ...state.customTodos };
    const cleanedSessionOutputs = { ...state.sessionOutputs };
    const cleanedTerminalInstances = { ...state.terminalInstances };
    const cleanedActiveTerminalId = { ...state.activeTerminalId };
    const cleanedTerminalSessions = { ...state.terminalSessions };
    for (const sessionId of workspaceSessionIds) {
      delete cleanedCustomTodos[sessionId];
      delete cleanedSessionOutputs[sessionId];
      delete cleanedTerminalInstances[sessionId];
      delete cleanedActiveTerminalId[sessionId];
      delete cleanedTerminalSessions[sessionId];
    }

    return {
      workspaces: state.workspaces.filter((w) => w.id !== id),
      sessions: state.sessions.filter((s) => s.workspaceId !== id),
      conversations: state.conversations.filter((c) => !workspaceSessionIds.includes(c.sessionId)),
      messages: state.messages.filter((m) => !workspaceConvIds.includes(m.conversationId)),
      selectedWorkspaceId: state.selectedWorkspaceId === id ? null : state.selectedWorkspaceId,
      selectedSessionId: workspaceSessionIds.includes(state.selectedSessionId || '')
        ? null
        : state.selectedSessionId,
      selectedConversationId: workspaceConvIds.includes(state.selectedConversationId || '')
        ? null
        : state.selectedConversationId,
      streamingState: cleanedStreamingState,
      activeTools: cleanedActiveTools,
      agentTodos: cleanedAgentTodos,
      customTodos: cleanedCustomTodos,
      sessionOutputs: cleanedSessionOutputs,
      terminalInstances: cleanedTerminalInstances,
      activeTerminalId: cleanedActiveTerminalId,
      terminalSessions: cleanedTerminalSessions,
      selectedFileTabId: null,
      fileTabs: [],
    };
  }),
  selectWorkspace: (id) => set({ selectedWorkspaceId: id }),
  reorderWorkspaces: (activeId, overId) => set((state) => {
    const oldIndex = state.workspaces.findIndex((w) => w.id === activeId);
    const newIndex = state.workspaces.findIndex((w) => w.id === overId);
    if (oldIndex === -1 || newIndex === -1) return state;
    const newWorkspaces = [...state.workspaces];
    const [removed] = newWorkspaces.splice(oldIndex, 1);
    newWorkspaces.splice(newIndex, 0, removed);
    return { workspaces: newWorkspaces };
  }),

  // Session actions
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions]
  })),
  updateSession: (id, updates) => set((state) => ({
    sessions: state.sessions.map((s) =>
      s.id === id ? { ...s, ...updates } : s
    ),
  })),
  removeSession: (id) => set((state) => {
    // Get all conversation IDs for this session to clean up related state
    const sessionConvIds = state.conversations
      .filter((c) => c.sessionId === id)
      .map((c) => c.id);

    // Clean up streaming state, active tools, and agent todos for all session conversations
    const cleanedStreamingState = { ...state.streamingState };
    const cleanedActiveTools = { ...state.activeTools };
    const cleanedAgentTodos = { ...state.agentTodos };
    const cleanedContextUsage = { ...state.contextUsage };
    for (const convId of sessionConvIds) {
      delete cleanedStreamingState[convId];
      delete cleanedActiveTools[convId];
      delete cleanedAgentTodos[convId];
      delete cleanedContextUsage[convId];
    }

    // Clean up custom todos, session outputs, and review comments
    const { [id]: _customTodos, ...remainingCustomTodos } = state.customTodos;
    const { [id]: _output, ...remainingSessionOutputs } = state.sessionOutputs;
    const { [id]: _comments, ...remainingReviewComments } = state.reviewComments;

    return {
      sessions: state.sessions.filter((s) => s.id !== id),
      conversations: state.conversations.filter((c) => c.sessionId !== id),
      messages: state.messages.filter((m) => !sessionConvIds.includes(m.conversationId)),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
      selectedConversationId: sessionConvIds.includes(state.selectedConversationId || '')
        ? null
        : state.selectedConversationId,
      streamingState: cleanedStreamingState,
      activeTools: cleanedActiveTools,
      agentTodos: cleanedAgentTodos,
      contextUsage: cleanedContextUsage,
      customTodos: remainingCustomTodos,
      sessionOutputs: remainingSessionOutputs,
      reviewComments: remainingReviewComments,
      selectedFileTabId: null,
      fileTabs: [],
    };
  }),
  selectSession: (id) => {
    // NOTE: This intentionally uses get() instead of set((state) => ...) pattern.
    // Using get() ensures we read the latest state, avoiding stale closure issues
    // when called immediately after other store updates like addConversation.
    const state = get();
    const sessionConversations = state.conversations.filter(c => c.sessionId === id);
    const firstConversation = sessionConversations[0];

    // Only show tabs belonging to this session (strict isolation)
    const visibleTabs = state.fileTabs.filter(t => t.sessionId === id);
    const currentTabVisible = visibleTabs.some(t => t.id === state.selectedFileTabId);
    const newSelectedTabId = currentTabVisible
      ? state.selectedFileTabId
      : visibleTabs[0]?.id || null;

    set({
      selectedSessionId: id,
      selectedConversationId: firstConversation?.id || null,
      selectedFileTabId: newSelectedTabId,
    });
  },
  archiveSession: (id) => set((state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return state;

    // Mark the session as archived
    const updatedSessions = state.sessions.map((s) =>
      s.id === id ? { ...s, archived: true } : s
    );

    // If this was the selected session, select another non-archived session in the same workspace
    let newSelectedSessionId = state.selectedSessionId;
    let newSelectedConversationId = state.selectedConversationId;

    if (state.selectedSessionId === id) {
      const otherSessions = updatedSessions.filter(
        (s) => s.workspaceId === session.workspaceId && !s.archived
      );
      newSelectedSessionId = otherSessions[0]?.id || null;

      // Find first conversation for new session
      if (newSelectedSessionId) {
        const sessionConvs = state.conversations.filter(c => c.sessionId === newSelectedSessionId);
        newSelectedConversationId = sessionConvs[0]?.id || null;
      } else {
        newSelectedConversationId = null;
      }
    }

    return {
      sessions: updatedSessions,
      selectedSessionId: newSelectedSessionId,
      selectedConversationId: newSelectedConversationId,
    };
  }),
  unarchiveSession: (id) => set((state) => {
    // Mark the session as not archived
    const updatedSessions = state.sessions.map((s) =>
      s.id === id ? { ...s, archived: false } : s
    );
    return { sessions: updatedSessions };
  }),

  // Conversation actions
  setConversations: (conversations) => set({
    conversations,
    // Also populate the messages array from all conversations
    messages: conversations.flatMap((c) => c.messages),
  }),
  addConversation: (conversation) => set((state) => ({
    conversations: [...state.conversations, conversation],
    // Also add the conversation's messages to the messages array
    messages: [...state.messages, ...conversation.messages]
  })),
  updateConversation: (id, updates) => set((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    ),
  })),
  removeConversation: (id) => set((state) => {
    // Clean up orphaned state for the removed conversation
    const { [id]: _streaming, ...remainingStreamingState } = state.streamingState;
    const { [id]: _tools, ...remainingActiveTools } = state.activeTools;
    const { [id]: _todos, ...remainingAgentTodos } = state.agentTodos;
    const { [id]: _question, ...remainingPendingQuestions } = state.pendingUserQuestion;
    const { [id]: _context, ...remainingContextUsage } = state.contextUsage;

    const removedConv = state.conversations.find((c) => c.id === id);
    const newConversations = state.conversations.filter((c) => c.id !== id);

    // Select another conversation if we're removing the selected one
    let newSelectedConversationId = state.selectedConversationId;
    if (state.selectedConversationId === id && removedConv) {
      // Find conversations from the same session
      const sessionConvs = newConversations.filter((c) => c.sessionId === removedConv.sessionId);
      // Find the position of the removed conversation among session conversations
      const oldSessionConvs = state.conversations.filter((c) => c.sessionId === removedConv.sessionId);
      const removedIdx = oldSessionConvs.findIndex((c) => c.id === id);
      // Select adjacent conversation: prefer next, then previous
      newSelectedConversationId = sessionConvs[removedIdx]?.id
        ?? sessionConvs[removedIdx - 1]?.id
        ?? sessionConvs[0]?.id
        ?? null;
    }

    return {
      conversations: newConversations,
      messages: state.messages.filter((m) => m.conversationId !== id),
      selectedConversationId: newSelectedConversationId,
      streamingState: remainingStreamingState,
      activeTools: remainingActiveTools,
      agentTodos: remainingAgentTodos,
      pendingUserQuestion: remainingPendingQuestions,
      contextUsage: remainingContextUsage,
    };
  }),
  selectConversation: (id) => set({ selectedConversationId: id }),

  // Message actions
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((m) =>
      m.id === id ? { ...m, ...updates } : m
    ),
  })),

  // File changes
  setFileChanges: (fileChanges) => set({ fileChanges }),

  // File tabs - supports multiple tabs with LRU eviction
  setFileTabs: (tabs) => set({ fileTabs: tabs }),

  openFileTab: (tab) => set((state) => {
    const now = new Date().toISOString();
    const existing = state.fileTabs.find((t) => t.id === tab.id);

    if (existing) {
      // Tab already open - select it, update lastAccessedAt, and merge new properties
      // This allows setting isLoading: true when re-opening a tab that needs content loaded
      return {
        fileTabs: state.fileTabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                ...tab, // Merge incoming properties (e.g., isLoading: true)
                lastAccessedAt: now,
              }
            : t
        ),
        selectedFileTabId: tab.id,
      };
    }

    // Add timestamp fields to new tab
    const newTab = {
      ...tab,
      openedAt: tab.openedAt || now,
      lastAccessedAt: now,
    };

    let newTabs = [...state.fileTabs, newTab];

    // If over limit, close oldest unpinned AND non-dirty tab.
    // Never auto-close tabs with unsaved changes (safety) or pinned tabs (user intent).
    // Note: If all tabs are pinned or dirty, no eviction occurs and tabs can exceed
    // MAX_FILE_TABS. This is intentional - we prioritize user data safety over the limit.
    // Users can manually close tabs or save files to free up space.
    if (newTabs.length > MAX_FILE_TABS) {
      const evictableTabs = newTabs.filter(
        (t) => !t.isPinned && !t.isDirty && t.id !== newTab.id
      );
      if (evictableTabs.length > 0) {
        // Sort by lastAccessedAt (oldest first) and remove the oldest
        evictableTabs.sort((a, b) =>
          (a.lastAccessedAt || '').localeCompare(b.lastAccessedAt || '')
        );
        const tabToClose = evictableTabs[0];
        newTabs = newTabs.filter((t) => t.id !== tabToClose.id);
      }
    }

    return {
      fileTabs: newTabs,
      selectedFileTabId: newTab.id,
    };
  }),

  closeFileTab: (id) => set((state) => {
    const closedIdx = state.fileTabs.findIndex((t) => t.id === id);
    const newTabs = state.fileTabs.filter((t) => t.id !== id);

    // Only update selection if we're closing the currently selected tab
    if (state.selectedFileTabId !== id) {
      return { fileTabs: newTabs };
    }

    // Try to select adjacent tab: prefer next, then previous
    const nextTab = newTabs[closedIdx] ?? newTabs[closedIdx - 1];

    return {
      fileTabs: newTabs,
      selectedFileTabId: nextTab?.id ?? null,
    };
  }),

  selectFileTab: (id) => set((state) => {
    const now = new Date().toISOString();
    return {
      selectedFileTabId: id,
      fileTabs: state.fileTabs.map((t) =>
        t.id === id ? { ...t, lastAccessedAt: now } : t
      ),
    };
  }),

  updateFileTab: (id, updates) => set((state) => ({
    fileTabs: state.fileTabs.map((t) =>
      t.id === id ? { ...t, ...updates } : t
    ),
  })),

updateFileTabContent: (id, content) => set((state) => ({
    fileTabs: state.fileTabs.map((t) =>
      t.id === id
        ? {
            ...t,
            content,
            isDirty: content !== t.originalContent,
          }
        : t
    ),
  })),

  reorderFileTabs: (activeId, overId) => set((state) => {
    const oldIndex = state.fileTabs.findIndex((t) => t.id === activeId);
    const newIndex = state.fileTabs.findIndex((t) => t.id === overId);
    if (oldIndex === -1 || newIndex === -1) return state;
    const newTabs = [...state.fileTabs];
    const [removed] = newTabs.splice(oldIndex, 1);
    newTabs.splice(newIndex, 0, removed);
    return { fileTabs: newTabs };
  }),

  pinFileTab: (id, pinned) => set((state) => ({
    fileTabs: state.fileTabs.map((t) =>
      t.id === id ? { ...t, isPinned: pinned } : t
    ),
  })),

  closeOtherTabs: (id) => set((state) => ({
    fileTabs: state.fileTabs.filter((t) => t.id === id),
    selectedFileTabId: id,
  })),

  closeTabsToRight: (id) => set((state) => {
    const idx = state.fileTabs.findIndex((t) => t.id === id);
    if (idx === -1) return state;
    const newTabs = state.fileTabs.slice(0, idx + 1);
    const newSelectedId = newTabs.some((t) => t.id === state.selectedFileTabId)
      ? state.selectedFileTabId
      : id;
    return {
      fileTabs: newTabs,
      selectedFileTabId: newSelectedId,
    };
  }),

  selectNextTab: () => set((state) => {
    if (state.fileTabs.length === 0) return state;
    const currentIdx = state.fileTabs.findIndex(
      (t) => t.id === state.selectedFileTabId
    );
    const nextIdx = (currentIdx + 1) % state.fileTabs.length;
    return { selectedFileTabId: state.fileTabs[nextIdx].id };
  }),

  selectPreviousTab: () => set((state) => {
    if (state.fileTabs.length === 0) return state;
    const currentIdx = state.fileTabs.findIndex(
      (t) => t.id === state.selectedFileTabId
    );
    const prevIdx =
      currentIdx <= 0 ? state.fileTabs.length - 1 : currentIdx - 1;
    return { selectedFileTabId: state.fileTabs[prevIdx].id };
  }),

  setPendingCloseFileTabId: (id) => set({ pendingCloseFileTabId: id }),

  // Output - max 10,000 lines per session to prevent memory leaks
  appendOutput: (sessionId, line) => set((state) => {
    const MAX_OUTPUT_LINES = 10000;
    const existing = state.sessionOutputs[sessionId] || [];
    const updated = [...existing, line];
    // Keep only the last MAX_OUTPUT_LINES lines (ring buffer behavior)
    const trimmed = updated.length > MAX_OUTPUT_LINES
      ? updated.slice(-MAX_OUTPUT_LINES)
      : updated;
    return {
      sessionOutputs: {
        ...state.sessionOutputs,
        [sessionId]: trimmed,
      },
    };
  }),
  clearOutput: (sessionId) => set((state) => ({
    sessionOutputs: {
      ...state.sessionOutputs,
      [sessionId]: [],
    },
  })),

  // Terminal sessions
  createTerminalSession: (session) => set((state) => ({
    terminalSessions: {
      ...state.terminalSessions,
      [session.id]: session,
    },
  })),
  updateTerminalSession: (id, updates) => set((state) => ({
    terminalSessions: {
      ...state.terminalSessions,
      [id]: state.terminalSessions[id]
        ? { ...state.terminalSessions[id], ...updates }
        : state.terminalSessions[id],
    },
  })),
  closeTerminalSession: (id) => set((state) => {
    const { [id]: _, ...rest } = state.terminalSessions;
    return { terminalSessions: rest };
  }),

  // Cost
  addCost: (amount) => set((state) => ({
    totalCost: state.totalCost + amount
  })),

  // Streaming state actions
  appendStreamingText: (conversationId, text) => set((state) => {
    const current = state.streamingState[conversationId];
    const existingSegments = current?.segments || [];
    const currentSegmentId = current?.currentSegmentId;

    let newSegments: TextSegment[];
    let newCurrentSegmentId: string | null;

    if (currentSegmentId) {
      newSegments = existingSegments.map(seg =>
        seg.id === currentSegmentId
          ? { ...seg, text: seg.text + text }
          : seg
      );
      newCurrentSegmentId = currentSegmentId;
    } else {
      const segmentId = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      newSegments = [...existingSegments, { id: segmentId, text, timestamp: Date.now() }];
      newCurrentSegmentId = segmentId;
    }

    return {
      streamingState: updateStreamingConv(state.streamingState, conversationId, {
        text: (current?.text || '') + text,
        segments: newSegments,
        currentSegmentId: newCurrentSegmentId,
        isStreaming: true,
        error: null,
        isThinking: false,
      }),
    };
  }),
  setStreaming: (conversationId, isStreaming) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      isStreaming,
      startTime: isStreaming
        ? (state.streamingState[conversationId]?.startTime || Date.now())
        : undefined,
    }),
  })),
  setStreamingError: (conversationId, error) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      currentSegmentId: null,
      isStreaming: false,
      error,
      thinking: null,
      isThinking: false,
      awaitingPlanApproval: false,
    }),
  })),
  clearStreamingText: (conversationId) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      text: '',
      segments: [],
      currentSegmentId: null,
      isStreaming: false,
      error: null,
      thinking: null,
      isThinking: false,
      awaitingPlanApproval: false,
    }),
  })),
  appendThinkingText: (conversationId, text) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      isStreaming: true,
      error: null,
      thinking: (state.streamingState[conversationId]?.thinking || '') + text,
      isThinking: true,
    }),
  })),
  setThinking: (conversationId, isThinking) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, { isThinking }),
  })),
  clearThinking: (conversationId) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      thinking: null,
      isThinking: false,
    }),
  })),
  setPlanModeActive: (conversationId, active) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      planModeActive: active,
    }),
  })),
  setAwaitingPlanApproval: (conversationId, awaiting) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      awaitingPlanApproval: awaiting,
    }),
  })),
  addActiveTool: (conversationId, tool) => set((state) => ({
    activeTools: {
      ...state.activeTools,
      [conversationId]: [...(state.activeTools[conversationId] || []), tool],
    },
    // Seal current text segment so next text creates a new segment after this tool
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      currentSegmentId: null,
    }),
  })),
  completeActiveTool: (conversationId, toolId, success, summary, stdout, stderr) => set((state) => ({
    activeTools: {
      ...state.activeTools,
      [conversationId]: (state.activeTools[conversationId] || []).map((t) =>
        t.id === toolId
          ? { ...t, endTime: Date.now(), success, summary, stdout, stderr }
          : t
      ),
    },
  })),
  clearActiveTools: (conversationId) => set((state) => ({
    activeTools: {
      ...state.activeTools,
      [conversationId]: [],
    },
  })),

  // Atomic streaming finalization - creates message and clears streaming in one update
  // This prevents the data loss bug where streaming text could be cleared before message is saved
  finalizeStreamingMessage: (conversationId, metadata) => set((state) => {
    const streaming = state.streamingState[conversationId];

    // Build cleared streaming state (preserve planModeActive)
    const clearedStreaming = {
      text: '',
      segments: [],
      currentSegmentId: null,
      isStreaming: false,
      error: null,
      thinking: null,
      isThinking: false,
      planModeActive: streaming?.planModeActive || false,
      awaitingPlanApproval: false,
    };

    // If no streaming text, just clear the state
    if (!streaming?.text) {
      return {
        streamingState: {
          ...state.streamingState,
          [conversationId]: clearedStreaming,
        },
        activeTools: {
          ...state.activeTools,
          [conversationId]: [],
        },
      };
    }

    // Create the message from streaming text
    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      conversationId,
      role: 'assistant',
      content: streaming.text,
      timestamp: new Date().toISOString(),
      durationMs: metadata.durationMs,
      toolUsage: metadata.toolUsage,
      runSummary: metadata.runSummary,
      ...(streaming.thinking ? { thinkingContent: streaming.thinking } : {}),
    };

    // Atomically: add message AND clear streaming state
    return {
      messages: [...state.messages, newMessage],
      streamingState: {
        ...state.streamingState,
        [conversationId]: clearedStreaming,
      },
      activeTools: {
        ...state.activeTools,
        [conversationId]: [],
      },
    };
  }),

  // Todo actions
  setAgentTodos: (conversationId, todos) => set((state) => ({
    agentTodos: {
      ...state.agentTodos,
      [conversationId]: todos,
    },
  })),
  clearAgentTodos: (conversationId) => set((state) => ({
    agentTodos: {
      ...state.agentTodos,
      [conversationId]: [],
    },
  })),
  addCustomTodo: (sessionId, content) => set((state) => ({
    customTodos: {
      ...state.customTodos,
      [sessionId]: [
        ...(state.customTodos[sessionId] || []),
        {
          id: `todo-${Date.now()}`,
          content,
          completed: false,
          createdAt: new Date().toISOString(),
        },
      ],
    },
  })),
  toggleCustomTodo: (sessionId, todoId) => set((state) => ({
    customTodos: {
      ...state.customTodos,
      [sessionId]: (state.customTodos[sessionId] || []).map((todo) =>
        todo.id === todoId ? { ...todo, completed: !todo.completed } : todo
      ),
    },
  })),
  deleteCustomTodo: (sessionId, todoId) => set((state) => ({
    customTodos: {
      ...state.customTodos,
      [sessionId]: (state.customTodos[sessionId] || []).filter((todo) => todo.id !== todoId),
    },
  })),

  // Terminal instance actions (bottom panel)
  createTerminal: (sessionId) => {
    const state = get();
    const existing = state.terminalInstances[sessionId] || [];

    // Max 5 terminals per session
    if (existing.length >= 5) return null;

    // Find lowest available slot (1-5)
    const usedSlots = new Set(existing.map(t => t.slotNumber));
    let slot = 1;
    while (usedSlots.has(slot) && slot <= 5) slot++;

    const terminal: TerminalInstance = {
      id: `${sessionId}-term-${slot}-${Date.now()}`,
      sessionId,
      slotNumber: slot,
      status: 'active',
    };

    set({
      terminalInstances: {
        ...state.terminalInstances,
        [sessionId]: [...existing, terminal],
      },
      activeTerminalId: {
        ...state.activeTerminalId,
        [sessionId]: terminal.id,
      },
    });

    return terminal;
  },

  closeTerminal: (sessionId, terminalId) => {
    const state = get();
    const existing = state.terminalInstances[sessionId] || [];
    const filtered = existing.filter(t => t.id !== terminalId);
    const wasActive = state.activeTerminalId[sessionId] === terminalId;

    let newActiveId = state.activeTerminalId[sessionId];
    if (wasActive && filtered.length > 0) {
      // Select next available or last
      const closedIndex = existing.findIndex(t => t.id === terminalId);
      const nextIndex = Math.min(closedIndex, filtered.length - 1);
      newActiveId = filtered[nextIndex]?.id || null;
    } else if (filtered.length === 0) {
      newActiveId = null;
    }

    set({
      terminalInstances: {
        ...state.terminalInstances,
        [sessionId]: filtered,
      },
      activeTerminalId: {
        ...state.activeTerminalId,
        [sessionId]: newActiveId,
      },
    });
  },

  setActiveTerminal: (sessionId, terminalId) => {
    set({
      activeTerminalId: {
        ...get().activeTerminalId,
        [sessionId]: terminalId,
      },
    });
  },

  markTerminalExited: (terminalId) => {
    const state = get();
    const updated = { ...state.terminalInstances };
    for (const wsId of Object.keys(updated)) {
      updated[wsId] = updated[wsId].map(t =>
        t.id === terminalId ? { ...t, status: 'exited' as const } : t
      );
    }
    set({ terminalInstances: updated });
  },

  // MCP servers actions
  setMcpServers: (servers) => set({ mcpServers: servers }),

  // Checkpoint actions
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  addCheckpoint: (checkpoint) => set((state) => ({
    checkpoints: [...state.checkpoints, checkpoint]
  })),
  clearCheckpoints: () => set({ checkpoints: [] }),
  setBudgetStatus: (budgetStatus) => set({ budgetStatus }),

  // Context usage actions
  setContextUsage: (conversationId, usage) => set((state) => {
    const existing = state.contextUsage[conversationId] || {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      contextWindow: 200000,
      lastUpdated: Date.now(),
    };
    return {
      contextUsage: {
        ...state.contextUsage,
        [conversationId]: { ...existing, ...usage, lastUpdated: Date.now() },
      },
    };
  }),
  clearContextUsage: (conversationId) => set((state) => {
    const { [conversationId]: _, ...rest } = state.contextUsage;
    return { contextUsage: rest };
  }),

  // Review comments actions
  setReviewComments: (sessionId, comments) => set((state) => ({
    reviewComments: {
      ...state.reviewComments,
      [sessionId]: comments,
    },
  })),
  addReviewComment: (sessionId, comment) => set((state) => {
    const existing = state.reviewComments[sessionId] || [];
    if (existing.some((c) => c.id === comment.id)) return state;
    return {
      reviewComments: {
        ...state.reviewComments,
        [sessionId]: [...existing, comment],
      },
    };
  }),
  updateReviewComment: (sessionId, id, updates) => set((state) => ({
    reviewComments: {
      ...state.reviewComments,
      [sessionId]: (state.reviewComments[sessionId] || []).map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    },
  })),
  deleteReviewComment: (sessionId, id) => set((state) => ({
    reviewComments: {
      ...state.reviewComments,
      [sessionId]: (state.reviewComments[sessionId] || []).filter((c) => c.id !== id),
    },
  })),

  // Branch sync actions
  setBranchSyncStatus: (sessionId, status) => set((state) => ({
    branchSyncStatus: {
      ...state.branchSyncStatus,
      [sessionId]: status,
    },
  })),
  setBranchSyncLoading: (sessionId, loading) => set((state) => ({
    branchSyncLoading: {
      ...state.branchSyncLoading,
      [sessionId]: loading,
    },
  })),
  setBranchSyncDismissed: (sessionId, dismissed) => set((state) => ({
    branchSyncDismissed: {
      ...state.branchSyncDismissed,
      [sessionId]: dismissed,
    },
  })),
  setBranchSyncCompletedAt: (sessionId, timestamp) => set((state) => ({
    branchSyncCompletedAt: {
      ...state.branchSyncCompletedAt,
      [sessionId]: timestamp,
    },
  })),
  clearBranchSyncStatus: (sessionId) => set((state) => {
    const { [sessionId]: _status, ...remainingStatus } = state.branchSyncStatus;
    const { [sessionId]: _loading, ...remainingLoading } = state.branchSyncLoading;
    const { [sessionId]: _dismissed, ...remainingDismissed } = state.branchSyncDismissed;
    return {
      branchSyncStatus: remainingStatus,
      branchSyncLoading: remainingLoading,
      branchSyncDismissed: remainingDismissed,
    };
  }),

  // User question actions (AskUserQuestion tool)
  setPendingUserQuestion: (conversationId, question) => set((state) => ({
    pendingUserQuestion: {
      ...state.pendingUserQuestion,
      [conversationId]: question,
    },
  })),

  updateUserQuestionAnswer: (conversationId, header, answer) => set((state) => {
    const pending = state.pendingUserQuestion[conversationId];
    if (!pending) return state;
    return {
      pendingUserQuestion: {
        ...state.pendingUserQuestion,
        [conversationId]: {
          ...pending,
          answers: {
            ...pending.answers,
            [header]: answer,
          },
        },
      },
    };
  }),

  nextUserQuestion: (conversationId) => set((state) => {
    const pending = state.pendingUserQuestion[conversationId];
    if (!pending || pending.currentIndex >= pending.questions.length - 1) return state;
    return {
      pendingUserQuestion: {
        ...state.pendingUserQuestion,
        [conversationId]: {
          ...pending,
          currentIndex: pending.currentIndex + 1,
        },
      },
    };
  }),

  prevUserQuestion: (conversationId) => set((state) => {
    const pending = state.pendingUserQuestion[conversationId];
    if (!pending || pending.currentIndex <= 0) return state;
    return {
      pendingUserQuestion: {
        ...state.pendingUserQuestion,
        [conversationId]: {
          ...pending,
          currentIndex: pending.currentIndex - 1,
        },
      },
    };
  }),

  clearPendingUserQuestion: (conversationId) => set((state) => ({
    pendingUserQuestion: {
      ...state.pendingUserQuestion,
      [conversationId]: null,
    },
  })),

  // File watcher actions
  setLastFileChange: (event) => set({
    lastFileChange: { ...event, timestamp: Date.now() },
  }),

  // Legacy support
  repos: [],
  selectedRepoId: null,
  agents: [],
  agentOutputs: {},
  setRepos: (repos) => set({ repos }),
  addRepo: (repo) => set((state) => ({ repos: [...state.repos, repo] })),
  removeRepo: (id) => set((state) => ({
    repos: state.repos.filter((r) => r.id !== id),
    selectedRepoId: state.selectedRepoId === id ? null : state.selectedRepoId,
  })),
  selectRepo: (id) => set({ selectedRepoId: id }),
  setAgents: (agents) => set({ agents }),
  addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
  updateAgentStatus: (agentId, status) => set((state) => ({
    agents: state.agents.map((a) =>
      a.id === agentId ? { ...a, status } : a
    ),
  })),
  removeAgent: (id) => set((state) => ({
    agents: state.agents.filter((a) => a.id !== id),
  })),
}));
