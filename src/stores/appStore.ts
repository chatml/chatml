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
  AgentTodoItem,
  CustomTodoItem,
  McpServerStatus,
  McpServerConfig,
  CheckpointInfo,
  ContextUsage,
  ToolUsage,
  RunSummary,
  ReviewComment,
  BranchSyncStatus,
  PendingUserQuestion,
  ActiveTool,
  SubAgent,
  Attachment,
  Summary,
  ScriptRun,
  SetupProgress,
  TimelineEntry,
  InputSuggestion,
  SessionToggleState,
} from '@/lib/types';
import { useSettingsStore } from './settingsStore';

// Maximum number of file tabs before LRU eviction kicks in
const MAX_FILE_TABS = 10;

// Script output is stored outside Zustand to avoid O(n²) array copies on every line.
// A version counter in the store triggers re-renders when output changes.
const scriptOutputBuffers = new Map<string, string[]>(); // key: `${sessionId}:${runId}`

/** Get script output lines for a run (read from external buffer) */
export function getScriptOutputLines(sessionId: string, runId: string): string[] {
  return scriptOutputBuffers.get(`${sessionId}:${runId}`) || [];
}

/** Clear script output buffers for a session */
export function clearScriptOutputBuffers(sessionId: string) {
  for (const key of scriptOutputBuffers.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      scriptOutputBuffers.delete(key);
    }
  }
}

// Timeout tracking for orphaned tool cleanup
const toolTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Maximum time a tool can be active before forced completion (5 minutes)
const TOOL_TIMEOUT_MS = 5 * 60 * 1000;

/** Clear all tool timeouts for a given conversation */
function clearToolTimeoutsForConversation(conversationId: string, tools: { id: string }[]) {
  for (const tool of tools) {
    const key = `${conversationId}:${tool.id}`;
    const timeout = toolTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      toolTimeouts.delete(key);
    }
  }
}

/** Clear all tool timeouts for conversations matching the given IDs */
function clearToolTimeoutsForConversations(conversationIds: string[]) {
  for (const [key, timeout] of toolTimeouts) {
    const convId = key.split(':')[0];
    if (conversationIds.includes(convId)) {
      clearTimeout(timeout);
      toolTimeouts.delete(key);
    }
  }
}

/** Clear all tool timeouts globally (for HMR, tests, or app teardown) */
export function clearAllToolTimeouts() {
  for (const timeout of toolTimeouts.values()) {
    clearTimeout(timeout);
  }
  toolTimeouts.clear();
}

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
  pendingPlanApproval: null,
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

// Queued user message (submitted while agent is streaming)
export interface QueuedMessage {
  id: string;
  content: string;
  attachments?: Attachment[];
  timestamp: string;
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
  pendingPlanApproval: { requestId: string; planContent?: string } | null; // Pending ExitPlanMode approval request
  approvedPlanContent?: string; // Plan content to persist after approval
  approvedPlanTimestamp?: number; // When the plan was approved (for timeline ordering)
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
  lastActiveConversationPerSession: Record<string, string>; // sessionId → conversationId

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
  subAgents: { [conversationId: string]: SubAgent[] };

  // Queued message per conversation (max one, submitted while agent is streaming)
  queuedMessage: { [conversationId: string]: QueuedMessage | null };

  // Todo state
  agentTodos: { [conversationId: string]: AgentTodoItem[] };
  customTodos: { [sessionId: string]: CustomTodoItem[] };

  // Terminal instances (bottom panel terminals per session)
  terminalInstances: Record<string, TerminalInstance[]>; // keyed by sessionId
  activeTerminalId: Record<string, string | null>;       // keyed by sessionId

  // MCP servers state
  mcpServers: McpServerStatus[];
  mcpServerConfigs: McpServerConfig[];
  mcpConfigLoading: boolean;
  mcpToolsByServer: Record<string, string[]>; // server name → tool names

  // Checkpoint timeline state
  checkpoints: CheckpointInfo[];

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
  // Timestamp of last agent turn completion per session (triggers changes panel refresh)
  lastTurnCompletedAt: { [sessionId: string]: number };

  // Pending user questions from AskUserQuestion tool (keyed by conversationId)
  pendingUserQuestion: { [conversationId: string]: PendingUserQuestion | null };

  // Input suggestions from Haiku (keyed by conversationId)
  inputSuggestions: { [conversationId: string]: InputSuggestion };

  // Conversation summaries (keyed by conversationId)
  summaries: { [conversationId: string]: Summary };

  // File watcher: last file change event (for reactive subscriptions)
  lastFileChange: { workspaceId: string; path: string; fullPath: string; timestamp: number } | null;

  // Query responses from agent
  supportedModels: Array<{ value: string; displayName: string; description: string }>;
  supportedCommands: Array<{ name: string; description: string; argumentHint: string }>;
  accountInfo: Record<string, unknown> | null;

  // Session-scoped ChatInput toggle states (keyed by sessionId)
  sessionToggleState: Record<string, SessionToggleState>;

  // Draft compose input per session (keyed by sessionId)
  draftInputs: Record<string, { text: string; attachments: Attachment[] }>;

  // Script runs state (keyed by sessionId)
  scriptRuns: Record<string, ScriptRun[]>;
  setupProgress: Record<string, SetupProgress>;
  // Monotonic counter bumped on each output line to trigger re-renders
  scriptOutputVersion: number;

  // Draft input actions
  setDraftInput: (sessionId: string, draft: { text: string; attachments: Attachment[] }) => void;
  clearDraftInput: (sessionId: string) => void;

  // Script actions
  addScriptRun: (sessionId: string, run: ScriptRun) => void;
  updateScriptRunStatus: (sessionId: string, run: ScriptRun) => void;
  appendScriptOutput: (sessionId: string, runId: string, line: string) => void;
  setSetupProgress: (sessionId: string, progress: SetupProgress) => void;

  // Workspace actions
  setWorkspaces: (workspaces: Workspace[]) => void;
  addWorkspace: (workspace: Workspace) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;
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
  setSessionToggleState: (sessionId: string, state: SessionToggleState) => void;

  // Team selectors
  hasActiveTeam: (sessionId: string) => boolean;
  getTeammateConversations: (parentConvId: string) => Conversation[];
  getTeamOverviewConversation: (parentConvId: string) => Conversation | undefined;

  // Conversation actions
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  selectConversation: (id: string | null) => void;

  // Summary actions
  setSummary: (conversationId: string, summary: Summary) => void;
  updateSummary: (conversationId: string, updates: Partial<Summary>) => void;

  // Input suggestion actions
  setInputSuggestion: (conversationId: string, suggestion: InputSuggestion) => void;
  clearInputSuggestion: (conversationId: string) => void;

  // Message actions
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;

  // Message pagination state & actions
  messagePagination: Record<string, {
    hasMore: boolean;
    oldestPosition: number | null;
    isLoadingMore: boolean;
    totalCount: number;
  }>;
  setMessagePage: (convId: string, messages: Message[], hasMore: boolean, oldestPosition: number, totalCount: number) => void;
  prependMessages: (convId: string, messages: Message[], hasMore: boolean, oldestPosition: number) => void;
  setLoadingMoreMessages: (convId: string, loading: boolean) => void;

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
  clearStreamingContent: (conversationId: string) => void;
  appendThinkingText: (conversationId: string, text: string) => void;
  setThinking: (conversationId: string, isThinking: boolean) => void;
  clearThinking: (conversationId: string) => void;
  setPlanModeActive: (conversationId: string, active: boolean) => void;
  setPendingPlanApproval: (conversationId: string, requestId: string, planContent?: string) => void;
  clearPendingPlanApproval: (conversationId: string) => void;
  setApprovedPlanContent: (conversationId: string, content: string) => void;
  addActiveTool: (conversationId: string, tool: ActiveTool, opts?: { skipTimeout?: boolean }) => void;
  completeActiveTool: (conversationId: string, toolId: string, success?: boolean, summary?: string, stdout?: string, stderr?: string, metadata?: import('@/lib/types').ToolMetadata) => void;
  updateToolProgress: (conversationId: string, toolId: string, progress: { elapsedTimeSeconds?: number; toolName?: string }) => void;
  clearActiveTools: (conversationId: string) => void;

  // Sub-agent actions
  addSubAgent: (conversationId: string, agent: SubAgent) => void;
  completeSubAgent: (conversationId: string, agentId: string) => void;
  addSubAgentTool: (conversationId: string, agentId: string, tool: ActiveTool) => void;
  completeSubAgentTool: (conversationId: string, agentId: string, toolId: string, success?: boolean, summary?: string, stdout?: string, stderr?: string) => void;
  setSubAgentOutput: (conversationId: string, agentId: string, output: string) => void;
  clearSubAgents: (conversationId: string) => void;

  restoreStreamingFromSnapshot: (conversationId: string, snapshot: {
    text: string;
    textSegments?: { text: string; timestamp: number }[];
    activeTools: { id: string; tool: string; startTime: number; agentId?: string }[];
    thinking?: string;
    isThinking: boolean;
    planModeActive: boolean;
    subAgents?: { agentId: string; agentType: string; parentToolUseId?: string; description?: string; output?: string; startTime: number; activeTools: { id: string; tool: string; startTime: number }[]; completed: boolean }[];
  }) => void;

  // Atomic streaming finalization - creates message and clears streaming in one update
  finalizeStreamingMessage: (
    conversationId: string,
    metadata: {
      durationMs?: number;
      toolUsage?: ToolUsage[];
      runSummary?: RunSummary;
    }
  ) => void;

  // Queued message actions
  setQueuedMessage: (conversationId: string, message: QueuedMessage | null) => void;
  commitQueuedMessage: (conversationId: string) => void;

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
  setMcpToolsByServer: (tools: Record<string, string[]>) => void;
  fetchMcpServerConfigs: (workspaceId: string) => Promise<void>;
  saveMcpServerConfigs: (workspaceId: string, configs: McpServerConfig[]) => Promise<void>;

  // Query response actions
  setSupportedModels: (models: Array<{ value: string; displayName: string; description: string }>) => void;
  setSupportedCommands: (commands: Array<{ name: string; description: string; argumentHint: string }>) => void;
  setAccountInfo: (info: Record<string, unknown>) => void;

  // Checkpoint actions
  setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
  addCheckpoint: (checkpoint: CheckpointInfo) => void;
  clearCheckpoints: () => void;

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
  setLastTurnCompletedAt: (sessionId: string, timestamp: number) => void;
  clearBranchSyncStatus: (sessionId: string) => void;

  // User question actions (AskUserQuestion tool)
  setPendingUserQuestion: (conversationId: string, question: PendingUserQuestion | null) => void;
  updateUserQuestionAnswer: (conversationId: string, header: string, answer: string) => void;
  nextUserQuestion: (conversationId: string) => void;
  prevUserQuestion: (conversationId: string) => void;
  clearPendingUserQuestion: (conversationId: string) => void;

  // File watcher actions
  setLastFileChange: (event: { workspaceId: string; path: string; fullPath: string }) => void;
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
  lastActiveConversationPerSession: {},
  fileTabs: [],
  selectedFileTabId: null,
  pendingCloseFileTabId: null,
  sessionOutputs: {},
  terminalSessions: {},
  totalCost: 0,
  streamingState: {},
  activeTools: {},
  subAgents: {},
  queuedMessage: {},
  agentTodos: {},
  customTodos: {},
  terminalInstances: {},
  activeTerminalId: {},
  mcpServers: [],
  mcpServerConfigs: [],
  mcpConfigLoading: false,
  mcpToolsByServer: {},
  checkpoints: [],
  contextUsage: {},
  reviewComments: {},
  branchSyncStatus: {},
  branchSyncLoading: {},
  branchSyncDismissed: {},
  branchSyncCompletedAt: {},
  lastTurnCompletedAt: {},
  pendingUserQuestion: {},
  inputSuggestions: {},
  summaries: {},
  lastFileChange: null,
  messagePagination: {},

  // Query responses
  supportedModels: [],
  supportedCommands: [],
  accountInfo: null,

  sessionToggleState: {},

  // Draft input state
  draftInputs: {},

  // Script state
  scriptRuns: {},
  setupProgress: {},
  scriptOutputVersion: 0,

  // Draft input actions
  setDraftInput: (sessionId, draft) => set((state) => ({
    draftInputs: { ...state.draftInputs, [sessionId]: draft },
  })),
  clearDraftInput: (sessionId) => set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [sessionId]: _, ...rest } = state.draftInputs;
    return { draftInputs: rest };
  }),

  // Script actions
  addScriptRun: (sessionId, run) => {
    // Seed external output buffer from the run's inline output (if any)
    if (run.output && run.output.length > 0) {
      const key = `${sessionId}:${run.id}`;
      scriptOutputBuffers.set(key, [...run.output]);
    }
    return set((state) => ({
      scriptRuns: {
        ...state.scriptRuns,
        [sessionId]: [...(state.scriptRuns[sessionId] || []), { ...run, output: [] }],
      },
    }));
  },

  updateScriptRunStatus: (sessionId, updatedRun) => set((state) => ({
    scriptRuns: {
      ...state.scriptRuns,
      [sessionId]: (state.scriptRuns[sessionId] || []).map((r) =>
        r.id === updatedRun.id ? updatedRun : r
      ),
    },
  })),

  appendScriptOutput: (sessionId, runId, line) => {
    // Append to external buffer (O(1) amortized)
    const key = `${sessionId}:${runId}`;
    let buf = scriptOutputBuffers.get(key);
    if (!buf) {
      buf = [];
      scriptOutputBuffers.set(key, buf);
    }
    buf.push(line);
    // Bump version counter to trigger re-renders
    set((state) => ({ scriptOutputVersion: state.scriptOutputVersion + 1 }));
  },

  setSetupProgress: (sessionId, progress) => set((state) => ({
    setupProgress: {
      ...state.setupProgress,
      [sessionId]: progress,
    },
  })),

  // Workspace actions
  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (workspace) => set((state) => ({
    workspaces: [...state.workspaces, workspace]
  })),
  updateWorkspace: (id, updates) => set((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.id === id ? { ...w, ...updates } : w
    ),
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

    // Clean up custom todos, session outputs, terminal instances, terminal sessions, and last active conversation for all sessions
    const cleanedCustomTodos = { ...state.customTodos };
    const cleanedSessionOutputs = { ...state.sessionOutputs };
    const cleanedTerminalInstances = { ...state.terminalInstances };
    const cleanedActiveTerminalId = { ...state.activeTerminalId };
    const cleanedTerminalSessions = { ...state.terminalSessions };
    const cleanedLastActive = { ...state.lastActiveConversationPerSession };
    for (const sessionId of workspaceSessionIds) {
      delete cleanedCustomTodos[sessionId];
      delete cleanedSessionOutputs[sessionId];
      delete cleanedTerminalInstances[sessionId];
      delete cleanedActiveTerminalId[sessionId];
      delete cleanedTerminalSessions[sessionId];
      delete cleanedLastActive[sessionId];
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
      lastActiveConversationPerSession: cleanedLastActive,
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
  removeSession: (id) => {
    // Clean up external buffers before updating Zustand state
    const state = get();
    const sessionConvIds = state.conversations
      .filter((c) => c.sessionId === id)
      .map((c) => c.id);
    clearScriptOutputBuffers(id);
    clearToolTimeoutsForConversations(sessionConvIds);

    set((state) => {
      // Re-derive conv IDs inside set() for consistency with latest state
      const convIds = state.conversations
        .filter((c) => c.sessionId === id)
        .map((c) => c.id);

      // Clean up streaming state, active tools, and agent todos for all session conversations
      const cleanedStreamingState = { ...state.streamingState };
      const cleanedActiveTools = { ...state.activeTools };
      const cleanedAgentTodos = { ...state.agentTodos };
      const cleanedContextUsage = { ...state.contextUsage };
      const cleanedQueuedMessage = { ...state.queuedMessage };
      for (const convId of convIds) {
        delete cleanedStreamingState[convId];
        delete cleanedActiveTools[convId];
        delete cleanedAgentTodos[convId];
        delete cleanedContextUsage[convId];
        delete cleanedQueuedMessage[convId];
      }

      // Clean up custom todos, session outputs, review comments, and last active conversation
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _customTodos, ...remainingCustomTodos } = state.customTodos;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _output, ...remainingSessionOutputs } = state.sessionOutputs;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _comments, ...remainingReviewComments } = state.reviewComments;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _lastActive, ...remainingLastActive } = state.lastActiveConversationPerSession;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _toggleState, ...remainingToggleState } = state.sessionToggleState;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _draft, ...remainingDraftInputs } = state.draftInputs;

      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        conversations: state.conversations.filter((c) => c.sessionId !== id),
        messages: state.messages.filter((m) => !convIds.includes(m.conversationId)),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        selectedConversationId: convIds.includes(state.selectedConversationId || '')
          ? null
          : state.selectedConversationId,
        streamingState: cleanedStreamingState,
        activeTools: cleanedActiveTools,
        agentTodos: cleanedAgentTodos,
        contextUsage: cleanedContextUsage,
        queuedMessage: cleanedQueuedMessage,
        customTodos: remainingCustomTodos,
        sessionOutputs: remainingSessionOutputs,
        reviewComments: remainingReviewComments,
        lastActiveConversationPerSession: remainingLastActive,
        sessionToggleState: remainingToggleState,
        draftInputs: remainingDraftInputs,
        selectedFileTabId: null,
        fileTabs: [],
      };
    });
  },
  selectSession: (id) => {
    // NOTE: This intentionally uses get() instead of set((state) => ...) pattern.
    // Using get() ensures we read the latest state, avoiding stale closure issues
    // when called immediately after other store updates like addConversation.
    const state = get();
    const sessionConversations = state.conversations.filter(c => c.sessionId === id);

    // Restore last active conversation for this session, or fall back to first
    const lastActiveId = id ? state.lastActiveConversationPerSession[id] : undefined;
    const lastActive = lastActiveId
      ? sessionConversations.find(c => c.id === lastActiveId)
      : null;
    const targetConversation = lastActive || sessionConversations[0];

    // Only show tabs belonging to this session (strict isolation)
    const visibleTabs = state.fileTabs.filter(t => t.sessionId === id);
    const currentTabVisible = visibleTabs.some(t => t.id === state.selectedFileTabId);
    const newSelectedTabId = currentTabVisible
      ? state.selectedFileTabId
      : visibleTabs[0]?.id || null;

    // Clear unread marker when navigating to a session
    if (id) {
      useSettingsStore.getState().markSessionRead(id);
    }

    set({
      selectedSessionId: id,
      selectedConversationId: targetConversation?.id || null,
      selectedFileTabId: newSelectedTabId,
    });
  },
  setSessionToggleState: (sessionId, toggleState) => set((state) => ({
    sessionToggleState: {
      ...state.sessionToggleState,
      [sessionId]: toggleState,
    },
  })),
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

      // Restore last active conversation for the new session, or fall back to first
      if (newSelectedSessionId) {
        const sessionConvs = state.conversations.filter(c => c.sessionId === newSelectedSessionId);
        const lastActiveId = state.lastActiveConversationPerSession[newSelectedSessionId];
        const lastActive = lastActiveId ? sessionConvs.find(c => c.id === lastActiveId) : null;
        newSelectedConversationId = lastActive?.id || sessionConvs[0]?.id || null;
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

  // Team selectors
  hasActiveTeam: (sessionId: string) => {
    return get().conversations.some(
      c => c.sessionId === sessionId && c.type === 'teammate'
    );
  },
  getTeammateConversations: (parentConvId: string) => {
    return get().conversations.filter(
      c => c.parentConversationId === parentConvId && c.type === 'teammate'
    );
  },
  getTeamOverviewConversation: (parentConvId: string) => {
    return get().conversations.find(
      c => c.parentConversationId === parentConvId && c.type === 'team-overview'
    );
  },

  // Conversation actions
  setConversations: (conversations) => set({
    conversations,
    // Messages are loaded on-demand via getConversationMessages, not inline.
    // The useEffect in ConversationArea will fetch messages for the active conversation.
  }),
  addConversation: (conversation) => set((state) => ({
    conversations: [...state.conversations, conversation],
    // Also add any initial messages (e.g., system setup message from createConversation)
    messages: conversation.messages.length > 0
      ? [...state.messages, ...conversation.messages]
      : state.messages,
  })),
  updateConversation: (id, updates) => set((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    ),
  })),
  removeConversation: (id) => {
    // Clean up external buffers before updating Zustand state
    clearToolTimeoutsForConversations([id]);

    return set((state) => {
    // Clean up orphaned state for the removed conversation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _streaming, ...remainingStreamingState } = state.streamingState;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _tools, ...remainingActiveTools } = state.activeTools;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _todos, ...remainingAgentTodos } = state.agentTodos;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _question, ...remainingPendingQuestions } = state.pendingUserQuestion;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _context, ...remainingContextUsage } = state.contextUsage;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _queued, ...remainingQueuedMessage } = state.queuedMessage;

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

    // Clean up lastActiveConversationPerSession if this was the remembered conversation
    let updatedLastActive = state.lastActiveConversationPerSession;
    if (removedConv && state.lastActiveConversationPerSession[removedConv.sessionId] === id) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [removedConv.sessionId]: _removed, ...rest } = state.lastActiveConversationPerSession;
      updatedLastActive = rest;
    }

    return {
      conversations: newConversations,
      messages: state.messages.filter((m) => m.conversationId !== id),
      selectedConversationId: newSelectedConversationId,
      lastActiveConversationPerSession: updatedLastActive,
      streamingState: remainingStreamingState,
      activeTools: remainingActiveTools,
      agentTodos: remainingAgentTodos,
      pendingUserQuestion: remainingPendingQuestions,
      contextUsage: remainingContextUsage,
      queuedMessage: remainingQueuedMessage,
    };
  });
  },
  selectConversation: (id) => {
    const state = get();
    const conversation = id ? state.conversations.find(c => c.id === id) : undefined;
    const sessionId = conversation?.sessionId || state.selectedSessionId;
    set({
      selectedConversationId: id,
      checkpoints: [],
      ...(sessionId && id ? {
        lastActiveConversationPerSession: {
          ...state.lastActiveConversationPerSession,
          [sessionId]: id,
        },
      } : {}),
    });
  },

  // Summary actions
  setSummary: (conversationId, summary) => set((state) => ({
    summaries: { ...state.summaries, [conversationId]: summary },
  })),
  updateSummary: (conversationId, updates) => set((state) => {
    const existing = state.summaries[conversationId];
    if (!existing) return state;
    return {
      summaries: { ...state.summaries, [conversationId]: { ...existing, ...updates } },
    };
  }),

  // Input suggestion actions
  setInputSuggestion: (conversationId, suggestion) => set((state) => ({
    inputSuggestions: { ...state.inputSuggestions, [conversationId]: { ...suggestion, timestamp: Date.now() } },
  })),
  clearInputSuggestion: (conversationId) => set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [conversationId]: _removed, ...rest } = state.inputSuggestions;
    return { inputSuggestions: rest };
  }),

  // Message actions
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => {
    const convPagination = state.messagePagination[message.conversationId];
    return {
      messages: [...state.messages, message],
      // Keep totalCount in sync so firstItemIndex stays stable
      ...(convPagination ? {
        messagePagination: {
          ...state.messagePagination,
          [message.conversationId]: {
            ...convPagination,
            totalCount: convPagination.totalCount + 1,
          },
        },
      } : {}),
    };
  }),
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((m) =>
      m.id === id ? { ...m, ...updates } : m
    ),
  })),

  // Message pagination actions
  setMessagePage: (convId, messages, hasMore, oldestPosition, totalCount) => set((state) => ({
    // Replace any existing messages for this conversation with the new page
    messages: [
      ...state.messages.filter((m) => m.conversationId !== convId),
      ...messages,
    ],
    messagePagination: {
      ...state.messagePagination,
      [convId]: { hasMore, oldestPosition, isLoadingMore: false, totalCount },
    },
  })),
  prependMessages: (convId, messages, hasMore, oldestPosition) => set((state) => {
    // Find where this conversation's messages start and prepend
    const existingIds = new Set(state.messages.filter((m) => m.conversationId === convId).map((m) => m.id));
    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    return {
      messages: [
        ...state.messages.filter((m) => m.conversationId !== convId),
        ...newMessages,
        ...state.messages.filter((m) => m.conversationId === convId),
      ],
      messagePagination: {
        ...state.messagePagination,
        [convId]: {
          ...state.messagePagination[convId],
          hasMore,
          oldestPosition,
          isLoadingMore: false,
        },
      },
    };
  }),
  setLoadingMoreMessages: (convId, loading) => set((state) => ({
    messagePagination: {
      ...state.messagePagination,
      [convId]: {
        ...state.messagePagination[convId],
        isLoadingMore: loading,
      },
    },
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
    if (!state.selectedSessionId) return state;

    // Build unified tab list matching TabBar render order: file tabs then conversations
    const sessionFileTabs = state.fileTabs.filter(t => t.sessionId === state.selectedSessionId);
    const sessionConvs = state.conversations.filter(c => c.sessionId === state.selectedSessionId);
    const unified: { id: string; type: 'file' | 'conversation' }[] = [
      ...sessionFileTabs.map(t => ({ id: t.id, type: 'file' as const })),
      ...sessionConvs.map(c => ({ id: c.id, type: 'conversation' as const })),
    ];
    if (unified.length === 0) return state;

    const activeId = state.selectedFileTabId ?? state.selectedConversationId;
    const currentIdx = unified.findIndex(t => t.id === activeId);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % unified.length;
    const next = unified[nextIdx];

    // Clear selectedFileTabId when navigating to conversation (file tabs take precedence in active-tab logic)
    if (next.type === 'file') return { selectedFileTabId: next.id };
    return {
      selectedFileTabId: null,
      selectedConversationId: next.id,
      checkpoints: [],
      lastActiveConversationPerSession: {
        ...state.lastActiveConversationPerSession,
        [state.selectedSessionId]: next.id,
      },
    };
  }),

  selectPreviousTab: () => set((state) => {
    if (!state.selectedSessionId) return state;

    const sessionFileTabs = state.fileTabs.filter(t => t.sessionId === state.selectedSessionId);
    const sessionConvs = state.conversations.filter(c => c.sessionId === state.selectedSessionId);
    const unified: { id: string; type: 'file' | 'conversation' }[] = [
      ...sessionFileTabs.map(t => ({ id: t.id, type: 'file' as const })),
      ...sessionConvs.map(c => ({ id: c.id, type: 'conversation' as const })),
    ];
    if (unified.length === 0) return state;

    const activeId = state.selectedFileTabId ?? state.selectedConversationId;
    const currentIdx = unified.findIndex(t => t.id === activeId);
    const prevIdx = currentIdx <= 0 ? unified.length - 1 : currentIdx - 1;
    const prev = unified[prevIdx];

    if (prev.type === 'file') return { selectedFileTabId: prev.id };
    return {
      selectedFileTabId: null,
      selectedConversationId: prev.id,
      checkpoints: [],
      lastActiveConversationPerSession: {
        ...state.lastActiveConversationPerSession,
        [state.selectedSessionId]: prev.id,
      },
    };
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _removed, ...rest } = state.terminalSessions;
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
        // Ensure startTime is set when streaming begins (may have been cleared by init event)
        startTime: current?.startTime ?? Date.now(),
      }),
    };
  }),
  setStreaming: (conversationId, isStreaming) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      isStreaming,
      startTime: isStreaming ? Date.now() : undefined,
    }),
  })),
  setStreamingError: (conversationId, error) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      currentSegmentId: null,
      isStreaming: false,
      error,
      thinking: null,
      isThinking: false,
      pendingPlanApproval: null,
      startTime: undefined,
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
      pendingPlanApproval: null,
      startTime: undefined,
    }),
  })),
  // Clear stale content on process restart while preserving isStreaming and startTime
  // so the "Agent is working" timer continues uninterrupted.
  clearStreamingContent: (conversationId) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      text: '',
      segments: [],
      currentSegmentId: null,
      error: null,
      thinking: null,
      isThinking: false,
    }),
  })),
  appendThinkingText: (conversationId, text) => set((state) => {
    const current = state.streamingState[conversationId];
    return {
      streamingState: updateStreamingConv(state.streamingState, conversationId, {
        isStreaming: true,
        error: null,
        thinking: (current?.thinking || '') + text,
        isThinking: true,
        startTime: current?.startTime ?? Date.now(),
      }),
    };
  }),
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
  setPendingPlanApproval: (conversationId, requestId, planContent) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      pendingPlanApproval: { requestId, ...(planContent && { planContent }) },
    }),
  })),
  clearPendingPlanApproval: (conversationId) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      pendingPlanApproval: null,
    }),
  })),
  setApprovedPlanContent: (conversationId, content) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      approvedPlanContent: content,
      approvedPlanTimestamp: Date.now(),
    }),
  })),
  addActiveTool: (conversationId, tool, opts) => {
    // Set up timeout to force-complete orphaned tools (skip for synthetic entries that will be completed immediately)
    if (!opts?.skipTimeout) {
      const timeoutKey = `${conversationId}:${tool.id}`;
      const existing = toolTimeouts.get(timeoutKey);
      if (existing) clearTimeout(existing);

      const timeout = setTimeout(() => {
        toolTimeouts.delete(timeoutKey);
        const current = useAppStore.getState().activeTools[conversationId] || [];
        const stillActive = current.find(t => t.id === tool.id && !t.endTime);
        if (stillActive) {
          console.warn(`[Store] Tool timeout: ${tool.tool} (${tool.id}) - forcing completion after ${TOOL_TIMEOUT_MS}ms`);
          useAppStore.getState().completeActiveTool(
            conversationId, tool.id, false, 'Tool timed out', undefined, undefined
          );
        }
      }, TOOL_TIMEOUT_MS);
      toolTimeouts.set(timeoutKey, timeout);
    }

    return set((state) => ({
      activeTools: {
        ...state.activeTools,
        [conversationId]: [...(state.activeTools[conversationId] || []), tool],
      },
      // Seal current text segment so next text creates a new segment after this tool
      streamingState: updateStreamingConv(state.streamingState, conversationId, {
        currentSegmentId: null,
      }),
    }));
  },
  completeActiveTool: (conversationId, toolId, success, summary, stdout, stderr, metadata) => {
    // Clear the timeout for this tool
    const timeoutKey = `${conversationId}:${toolId}`;
    const timeout = toolTimeouts.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      toolTimeouts.delete(timeoutKey);
    }

    return set((state) => {
      const tools = state.activeTools[conversationId] || [];
      if (!tools.some(t => t.id === toolId)) {
        return {}; // Tool not found - no-op (idempotent)
      }
      return {
        activeTools: {
          ...state.activeTools,
          [conversationId]: tools.map((t) =>
            t.id === toolId
              ? { ...t, endTime: Date.now(), success, summary, stdout, stderr, metadata }
              : t
          ),
        },
      };
    });
  },
  updateToolProgress: (conversationId, toolId, progress) => set((state) => {
    const tools = state.activeTools[conversationId] || [];
    const tool = tools.find(t => t.id === toolId && !t.endTime);
    if (!tool) return state; // Tool not found or already completed — no state change
    return {
      activeTools: {
        ...state.activeTools,
        [conversationId]: tools.map((t) =>
          t.id === toolId
            ? { ...t, elapsedSeconds: progress.elapsedTimeSeconds }
            : t
        ),
      },
    };
  }),
  clearActiveTools: (conversationId) => {
    // Clear all timeouts for this conversation's tools
    const tools = useAppStore.getState().activeTools[conversationId] || [];
    clearToolTimeoutsForConversation(conversationId, tools);

    return set((state) => ({
      activeTools: {
        ...state.activeTools,
        [conversationId]: [],
      },
    }));
  },

  // Sub-agent actions
  addSubAgent: (conversationId, agent) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: [...(state.subAgents[conversationId] || []), agent],
    },
  })),
  completeSubAgent: (conversationId, agentId) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: (state.subAgents[conversationId] || []).map((a) =>
        a.agentId === agentId ? { ...a, completed: true, endTime: Date.now() } : a
      ),
    },
  })),
  addSubAgentTool: (conversationId, agentId, tool) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: (state.subAgents[conversationId] || []).map((a) =>
        a.agentId === agentId ? { ...a, tools: [...a.tools, tool] } : a
      ),
    },
  })),
  completeSubAgentTool: (conversationId, agentId, toolId, success, summary, stdout, stderr) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: (state.subAgents[conversationId] || []).map((a) =>
        a.agentId === agentId
          ? {
              ...a,
              tools: a.tools.map((t) =>
                t.id === toolId ? { ...t, endTime: Date.now(), success, summary, stdout, stderr } : t
              ),
            }
          : a
      ),
    },
  })),
  setSubAgentOutput: (conversationId, agentId, output) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: (state.subAgents[conversationId] || []).map((a) =>
        a.agentId === agentId ? { ...a, output } : a
      ),
    },
  })),
  clearSubAgents: (conversationId) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: [],
    },
  })),

  restoreStreamingFromSnapshot: (conversationId, snapshot) => {
    // Restore streaming state from a backend snapshot after WebSocket reconnection.
    // When textSegments are available, restore individual segments to preserve
    // the interleaved timeline of text and tools.
    // Falls back to a single segment from the flat text field for older snapshots.
    let segments: TextSegment[];
    let currentSegmentId: string | null;

    if (snapshot.textSegments && snapshot.textSegments.length > 0) {
      // Restore individual segments from snapshot
      segments = snapshot.textSegments.map((seg, i) => ({
        id: `recovered-${conversationId}-${i}-${crypto.randomUUID().slice(0, 8)}`,
        text: seg.text,
        timestamp: seg.timestamp, // Already in milliseconds from backend
      }));
      // The last segment is the current (potentially in-progress) segment
      currentSegmentId = segments[segments.length - 1].id;
    } else {
      // Legacy fallback: single segment from flat text
      const segmentId = `recovered-${conversationId}-${crypto.randomUUID()}`;
      segments = [{ id: segmentId, text: snapshot.text, timestamp: Date.now() }];
      currentSegmentId = segmentId;
    }

    // Filter parent-agent tools (no agentId) for flat activeTools
    const parentTools = snapshot.activeTools
      .filter((t) => !t.agentId)
      .map((t) => ({
        id: t.id,
        tool: t.tool,
        startTime: t.startTime * 1000, // Convert seconds to ms
      }));

    // Restore sub-agents with their active tools
    const restoredSubAgents = (snapshot.subAgents || []).map((sa) => ({
      agentId: sa.agentId,
      agentType: sa.agentType,
      parentToolUseId: sa.parentToolUseId,
      description: sa.description,
      output: sa.output,
      startTime: sa.startTime * 1000, // Convert seconds to ms
      completed: sa.completed,
      tools: sa.activeTools.map((t) => ({
        id: t.id,
        tool: t.tool,
        startTime: t.startTime * 1000,
        agentId: sa.agentId,
      })),
    }));

    set((state) => ({
      streamingState: updateStreamingConv(state.streamingState, conversationId, {
        text: snapshot.text,
        segments,
        currentSegmentId,
        isStreaming: true,
        thinking: snapshot.thinking || null,
        isThinking: snapshot.isThinking,
        planModeActive: snapshot.planModeActive,
      }),
      activeTools: {
        ...state.activeTools,
        [conversationId]: parentTools,
      },
      subAgents: {
        ...state.subAgents,
        [conversationId]: restoredSubAgents,
      },
    }));
  },

  // Atomic streaming finalization - creates message and clears streaming in one update
  // This prevents the data loss bug where streaming text could be cleared before message is saved
  finalizeStreamingMessage: (conversationId, metadata) => {
    // Clear tool timeouts before clearing active tools
    const currentTools = useAppStore.getState().activeTools[conversationId] || [];
    clearToolTimeoutsForConversation(conversationId, currentTools);

    return set((state) => {
      const streaming = state.streamingState[conversationId];
      const hasQueuedMessage = state.queuedMessage[conversationId] != null;

      // Build cleared streaming state (preserve planModeActive)
      // If there's a queued message, keep isStreaming true to avoid flash
      const clearedStreaming = {
        text: '',
        segments: [],
        currentSegmentId: null,
        isStreaming: hasQueuedMessage,
        error: null,
        thinking: null,
        isThinking: false,
        startTime: hasQueuedMessage ? Date.now() : undefined,
        planModeActive: streaming?.planModeActive || false,
        pendingPlanApproval: null,
        approvedPlanContent: undefined,
        approvedPlanTimestamp: undefined,
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
          subAgents: {
            ...state.subAgents,
            [conversationId]: [],
          },
        };
      }

      // Build interleaved timeline from text segments and tools
      const segments = streaming.segments || [];
      const tools = state.activeTools[conversationId] || [];
      const timelineItems: Array<{ timestamp: number; entry: TimelineEntry }> = [];
      for (const seg of segments) {
        if (seg.text) {
          timelineItems.push({ timestamp: seg.timestamp, entry: { type: 'text', content: seg.text } });
        }
      }
      for (const tool of tools) {
        if (!tool.agentId) {
          timelineItems.push({ timestamp: tool.startTime, entry: { type: 'tool', toolId: tool.id } });
        }
      }
      // Add approved plan content at its chronological position
      if (streaming.approvedPlanContent && streaming.approvedPlanTimestamp) {
        timelineItems.push({ timestamp: streaming.approvedPlanTimestamp, entry: { type: 'plan', content: streaming.approvedPlanContent } });
      }
      timelineItems.sort((a, b) => a.timestamp - b.timestamp);
      const timeline: TimelineEntry[] | undefined =
        timelineItems.length > 0 ? timelineItems.map(item => item.entry) : undefined;

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
        ...(timeline ? { timeline } : {}),
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
        subAgents: {
          ...state.subAgents,
          [conversationId]: [],
        },
      };
    });
  },

  // Queued message actions
  setQueuedMessage: (conversationId, message) => set((state) => ({
    queuedMessage: { ...state.queuedMessage, [conversationId]: message },
  })),
  commitQueuedMessage: (conversationId) => set((state) => {
    const queued = state.queuedMessage[conversationId];
    if (!queued) return state;
    const msg: Message = {
      id: queued.id,
      conversationId,
      role: 'user',
      content: queued.content,
      attachments: queued.attachments,
      timestamp: queued.timestamp,
    };
    const convPagination = state.messagePagination[conversationId];
    return {
      messages: [...state.messages, msg],
      queuedMessage: { ...state.queuedMessage, [conversationId]: null },
      // Keep totalCount in sync (same pattern as addMessage)
      ...(convPagination ? {
        messagePagination: {
          ...state.messagePagination,
          [conversationId]: {
            ...convPagination,
            totalCount: convPagination.totalCount + 1,
          },
        },
      } : {}),
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
  setMcpToolsByServer: (tools) => set({ mcpToolsByServer: tools }),
  fetchMcpServerConfigs: async (workspaceId) => {
    set({ mcpConfigLoading: true });
    try {
      const configs = await import('@/lib/api').then(m => m.getMcpServers(workspaceId));
      set({ mcpServerConfigs: configs, mcpConfigLoading: false });
    } catch {
      set({ mcpConfigLoading: false });
    }
  },
  saveMcpServerConfigs: async (workspaceId, configs) => {
    set({ mcpConfigLoading: true });
    try {
      const saved = await import('@/lib/api').then(m => m.setMcpServers(workspaceId, configs));
      set({ mcpServerConfigs: saved, mcpConfigLoading: false });
    } catch {
      set({ mcpConfigLoading: false });
    }
  },

  // Query response actions
  setSupportedModels: (models) => set({ supportedModels: models }),
  setSupportedCommands: (commands) => set({ supportedCommands: commands }),
  setAccountInfo: (info) => set({ accountInfo: info }),

  // Checkpoint actions
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  addCheckpoint: (checkpoint) => set((state) => ({
    checkpoints: [...state.checkpoints, checkpoint]
  })),
  clearCheckpoints: () => set({ checkpoints: [] }),

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [conversationId]: _removed, ...rest } = state.contextUsage;
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
  setLastTurnCompletedAt: (sessionId, timestamp) => set((state) => ({
    lastTurnCompletedAt: {
      ...state.lastTurnCompletedAt,
      [sessionId]: timestamp,
    },
  })),
  clearBranchSyncStatus: (sessionId) => set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [sessionId]: _status, ...remainingStatus } = state.branchSyncStatus;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [sessionId]: _loading, ...remainingLoading } = state.branchSyncLoading;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

}));
