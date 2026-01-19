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
  CustomTodoItem
} from '@/lib/types';

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
  openFileTab: (tab: FileTab) => void;
  closeFileTab: (id: string) => void;
  selectFileTab: (id: string | null) => void;
  updateFileTab: (id: string, updates: Partial<FileTab>) => void;

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
  sessionOutputs: {},
  terminalSessions: {},
  totalCost: 0,
  streamingState: {},
  activeTools: {},
  agentTodos: {},
  customTodos: {},
  terminalInstances: {},
  activeTerminalId: {},

  // Workspace actions
  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (workspace) => set((state) => ({
    workspaces: [...state.workspaces, workspace]
  })),
  removeWorkspace: (id) => set((state) => ({
    workspaces: state.workspaces.filter((w) => w.id !== id),
    selectedWorkspaceId: state.selectedWorkspaceId === id ? null : state.selectedWorkspaceId,
  })),
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
  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter((s) => s.id !== id),
    selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
  })),
  selectSession: (id) => set((state) => {
    // When switching sessions, reset conversation and file tabs
    // Find the first conversation for this session to auto-select
    const sessionConversations = state.conversations.filter(c => c.sessionId === id);
    const firstConversation = sessionConversations[0];

    return {
      selectedSessionId: id,
      selectedConversationId: firstConversation?.id || null,
      selectedFileTabId: null,
      fileTabs: [], // Close all file tabs when switching sessions
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

    // If this was the selected session, select another session in the same workspace
    let newSelectedSessionId = state.selectedSessionId;
    let newSelectedConversationId = state.selectedConversationId;

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
    }

    return {
      sessions: updatedSessions,
      conversations: updatedConversations,
      messages: updatedMessages,
      selectedSessionId: newSelectedSessionId,
      selectedConversationId: newSelectedConversationId,
      selectedFileTabId: null,
      fileTabs: [],
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
  removeConversation: (id) => set((state) => ({
    conversations: state.conversations.filter((c) => c.id !== id),
    selectedConversationId: state.selectedConversationId === id ? null : state.selectedConversationId,
  })),
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

  // File tabs - only one file tab allowed, always replaces
  openFileTab: (tab) => set(() => ({
    fileTabs: [tab],
    selectedFileTabId: tab.id,
  })),
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
  selectFileTab: (id) => set({ selectedFileTabId: id }),
  updateFileTab: (id, updates) => set((state) => ({
    fileTabs: state.fileTabs.map((t) =>
      t.id === id ? { ...t, ...updates } : t
    ),
  })),

  // Output
  appendOutput: (sessionId, line) => set((state) => ({
    sessionOutputs: {
      ...state.sessionOutputs,
      [sessionId]: [...(state.sessionOutputs[sessionId] || []), line],
    },
  })),
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
      id: `${workspaceId}-term-${slot}`,
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
