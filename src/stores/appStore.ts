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
  BudgetStatus
} from '@/lib/types';

// Maximum number of file tabs before LRU eviction kicks in
const MAX_FILE_TABS = 10;

interface SessionOutput {
  [sessionId: string]: string[];
}

// Streaming state for conversations
interface StreamingState {
  text: string;
  isStreaming: boolean;
  error: string | null;
  thinking: string | null; // Current thinking content being streamed
  isThinking: boolean;
  startTime?: number; // When streaming started (for elapsed time)
}

interface ActiveTool {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  success?: boolean;
  summary?: string;
}

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

  // Terminal instances (bottom panel terminals per workspace)
  terminalInstances: Record<string, TerminalInstance[]>; // keyed by workspaceId
  activeTerminalId: Record<string, string | null>;       // keyed by workspaceId

  // MCP servers state
  mcpServers: McpServerStatus[];

  // Checkpoint timeline state
  checkpoints: CheckpointInfo[];
  budgetStatus: BudgetStatus | null;

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
  addActiveTool: (conversationId: string, tool: ActiveTool) => void;
  completeActiveTool: (conversationId: string, toolId: string, success?: boolean, summary?: string) => void;
  clearActiveTools: (conversationId: string) => void;

  // Todo actions
  setAgentTodos: (conversationId: string, todos: AgentTodoItem[]) => void;
  clearAgentTodos: (conversationId: string) => void;
  addCustomTodo: (sessionId: string, content: string) => void;
  toggleCustomTodo: (sessionId: string, todoId: string) => void;
  deleteCustomTodo: (sessionId: string, todoId: string) => void;

  // Terminal instance actions (bottom panel)
  createTerminal: (workspaceId: string) => TerminalInstance | null;
  closeTerminal: (workspaceId: string, terminalId: string) => void;
  setActiveTerminal: (workspaceId: string, terminalId: string) => void;
  markTerminalExited: (terminalId: string) => void;

  // MCP servers actions
  setMcpServers: (servers: McpServerStatus[]) => void;

  // Checkpoint actions
  setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
  addCheckpoint: (checkpoint: CheckpointInfo) => void;
  clearCheckpoints: () => void;
  setBudgetStatus: (status: BudgetStatus | null) => void;

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

    // Clean up custom todos and session outputs for all sessions
    const cleanedCustomTodos = { ...state.customTodos };
    const cleanedSessionOutputs = { ...state.sessionOutputs };
    for (const sessionId of workspaceSessionIds) {
      delete cleanedCustomTodos[sessionId];
      delete cleanedSessionOutputs[sessionId];
    }

    // Clean up terminal instances
    const { [id]: _terminals, ...remainingTerminalInstances } = state.terminalInstances;
    const { [id]: _activeTerminal, ...remainingActiveTerminalId } = state.activeTerminalId;

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
      terminalInstances: remainingTerminalInstances,
      activeTerminalId: remainingActiveTerminalId,
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
    sessions: [...state.sessions, session]
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
    for (const convId of sessionConvIds) {
      delete cleanedStreamingState[convId];
      delete cleanedActiveTools[convId];
      delete cleanedAgentTodos[convId];
    }

    // Clean up custom todos and session outputs
    const { [id]: _customTodos, ...remainingCustomTodos } = state.customTodos;
    const { [id]: _output, ...remainingSessionOutputs } = state.sessionOutputs;

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
      customTodos: remainingCustomTodos,
      sessionOutputs: remainingSessionOutputs,
      selectedFileTabId: null,
      fileTabs: [],
    };
  }),
  selectSession: (id) => set((state) => {
    // When switching sessions, find the first conversation for this session
    // File tabs persist in store but UI only shows tabs for current session
    const sessionConversations = state.conversations.filter(c => c.sessionId === id);
    const firstConversation = sessionConversations[0];

    // Only show tabs belonging to this session (strict isolation)
    const visibleTabs = state.fileTabs.filter(t => t.sessionId === id);
    const currentTabVisible = visibleTabs.some(t => t.id === state.selectedFileTabId);
    const newSelectedTabId = currentTabVisible
      ? state.selectedFileTabId
      : visibleTabs[0]?.id || null;

    return {
      selectedSessionId: id,
      selectedConversationId: firstConversation?.id || null,
      selectedFileTabId: newSelectedTabId,
      // fileTabs remain unchanged - UI filters by session
    };
  }),
  archiveSession: (id) => set((state) => {
    const session = state.sessions.find((s) => s.id === id);

    // Remove the session entirely
    const updatedSessions = state.sessions.filter((s) => s.id !== id);

    // Remove conversations and messages for this session
    const updatedConversations = state.conversations.filter((c) => c.sessionId !== id);
    const sessionConvIds = state.conversations.filter((c) => c.sessionId === id).map((c) => c.id);
    const updatedMessages = state.messages.filter((m) => !sessionConvIds.includes(m.conversationId));

// Clean up streaming state, active tools, and agent todos for all session conversations
    const cleanedStreamingState = { ...state.streamingState };
    const cleanedActiveTools = { ...state.activeTools };
    const cleanedAgentTodos = { ...state.agentTodos };
    for (const convId of sessionConvIds) {
      delete cleanedStreamingState[convId];
      delete cleanedActiveTools[convId];
      delete cleanedAgentTodos[convId];
    }

    // Clean up custom todos and session outputs
    const { [id]: _customTodos, ...remainingCustomTodos } = state.customTodos;
    const { [id]: _output, ...remainingSessionOutputs } = state.sessionOutputs;

    // Close only tabs that belong to this session (keep workspace tabs)
    const updatedFileTabs = state.fileTabs.filter((t) => t.sessionId !== id);

    // If this was the selected session, select another session in the same workspace
    let newSelectedSessionId = state.selectedSessionId;
    let newSelectedConversationId = state.selectedConversationId;
    let newSelectedFileTabId = state.selectedFileTabId;

    if (state.selectedSessionId === id) {
      const otherSessions = updatedSessions.filter(
        (s) => s.workspaceId === session?.workspaceId
      );
      newSelectedSessionId = otherSessions[0]?.id || null;

      // Find first conversation for new session
      if (newSelectedSessionId) {
        const sessionConvs = updatedConversations.filter(c => c.sessionId === newSelectedSessionId);
        newSelectedConversationId = sessionConvs[0]?.id || null;
      } else {
        newSelectedConversationId = null;
      }

      // Update selected file tab if it was closed
      if (!updatedFileTabs.some(t => t.id === state.selectedFileTabId)) {
        newSelectedFileTabId = updatedFileTabs[0]?.id || null;
      }
    }

    return {
      sessions: updatedSessions,
      conversations: updatedConversations,
      messages: updatedMessages,
      fileTabs: updatedFileTabs,
      selectedSessionId: newSelectedSessionId,
      selectedConversationId: newSelectedConversationId,
streamingState: cleanedStreamingState,
      activeTools: cleanedActiveTools,
      agentTodos: cleanedAgentTodos,
      customTodos: remainingCustomTodos,
      sessionOutputs: remainingSessionOutputs,
      selectedFileTabId: newSelectedFileTabId,
    };
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

    return {
      conversations: state.conversations.filter((c) => c.id !== id),
      messages: state.messages.filter((m) => m.conversationId !== id),
      selectedConversationId: state.selectedConversationId === id ? null : state.selectedConversationId,
      streamingState: remainingStreamingState,
      activeTools: remainingActiveTools,
      agentTodos: remainingAgentTodos,
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
    const newTabs = state.fileTabs.filter((t) => t.id !== id);
    let newSelectedId = state.selectedFileTabId;
    if (state.selectedFileTabId === id) {
      // Select adjacent tab or null
      const idx = state.fileTabs.findIndex((t) => t.id === id);
      newSelectedId = newTabs[idx]?.id || newTabs[idx - 1]?.id || null;
    }
    return {
      fileTabs: newTabs,
      selectedFileTabId: newSelectedId,
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
  appendStreamingText: (conversationId, text) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: {
        ...state.streamingState[conversationId],
        text: (state.streamingState[conversationId]?.text || '') + text,
        isStreaming: true,
        error: null,
        thinking: state.streamingState[conversationId]?.thinking || null,
        isThinking: false, // Stop thinking when text starts
      },
    },
  })),
  setStreaming: (conversationId, isStreaming) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: {
        ...state.streamingState[conversationId],
        text: state.streamingState[conversationId]?.text || '',
        isStreaming,
        error: state.streamingState[conversationId]?.error || null,
        thinking: state.streamingState[conversationId]?.thinking || null,
        isThinking: state.streamingState[conversationId]?.isThinking || false,
        // Set startTime when streaming starts, clear when it stops
        startTime: isStreaming
          ? (state.streamingState[conversationId]?.startTime || Date.now())
          : undefined,
      },
    },
  })),
  setStreamingError: (conversationId, error) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: {
        text: state.streamingState[conversationId]?.text || '',
        isStreaming: false,
        error,
        thinking: null,
        isThinking: false,
      },
    },
  })),
  clearStreamingText: (conversationId) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: { text: '', isStreaming: false, error: null, thinking: null, isThinking: false },
    },
  })),
  appendThinkingText: (conversationId, text) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: {
        ...state.streamingState[conversationId],
        text: state.streamingState[conversationId]?.text || '',
        isStreaming: true,
        error: null,
        thinking: (state.streamingState[conversationId]?.thinking || '') + text,
        isThinking: true,
      },
    },
  })),
  setThinking: (conversationId, isThinking) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: {
        ...state.streamingState[conversationId],
        text: state.streamingState[conversationId]?.text || '',
        isStreaming: state.streamingState[conversationId]?.isStreaming || false,
        error: state.streamingState[conversationId]?.error || null,
        thinking: state.streamingState[conversationId]?.thinking || null,
        isThinking,
      },
    },
  })),
  clearThinking: (conversationId) => set((state) => ({
    streamingState: {
      ...state.streamingState,
      [conversationId]: {
        ...state.streamingState[conversationId],
        text: state.streamingState[conversationId]?.text || '',
        isStreaming: state.streamingState[conversationId]?.isStreaming || false,
        error: state.streamingState[conversationId]?.error || null,
        thinking: null,
        isThinking: false,
      },
    },
  })),
  addActiveTool: (conversationId, tool) => set((state) => ({
    activeTools: {
      ...state.activeTools,
      [conversationId]: [...(state.activeTools[conversationId] || []), tool],
    },
  })),
  completeActiveTool: (conversationId, toolId, success, summary) => set((state) => ({
    activeTools: {
      ...state.activeTools,
      [conversationId]: (state.activeTools[conversationId] || []).map((t) =>
        t.id === toolId
          ? { ...t, endTime: Date.now(), success, summary }
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
  createTerminal: (workspaceId) => {
    const state = get();
    const existing = state.terminalInstances[workspaceId] || [];

    // Max 5 terminals per workspace
    if (existing.length >= 5) return null;

    // Find lowest available slot (1-5)
    const usedSlots = new Set(existing.map(t => t.slotNumber));
    let slot = 1;
    while (usedSlots.has(slot) && slot <= 5) slot++;

    const terminal: TerminalInstance = {
      id: `${workspaceId}-term-${slot}-${Date.now()}`,
      workspaceId,
      slotNumber: slot,
      status: 'active',
    };

    set({
      terminalInstances: {
        ...state.terminalInstances,
        [workspaceId]: [...existing, terminal],
      },
      activeTerminalId: {
        ...state.activeTerminalId,
        [workspaceId]: terminal.id,
      },
    });

    return terminal;
  },

  closeTerminal: (workspaceId, terminalId) => {
    const state = get();
    const existing = state.terminalInstances[workspaceId] || [];
    const filtered = existing.filter(t => t.id !== terminalId);
    const wasActive = state.activeTerminalId[workspaceId] === terminalId;

    let newActiveId = state.activeTerminalId[workspaceId];
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
        [workspaceId]: filtered,
      },
      activeTerminalId: {
        ...state.activeTerminalId,
        [workspaceId]: newActiveId,
      },
    });
  },

  setActiveTerminal: (workspaceId, terminalId) => {
    set({
      activeTerminalId: {
        ...get().activeTerminalId,
        [workspaceId]: terminalId,
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
