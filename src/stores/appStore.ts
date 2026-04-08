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
  ClaudeTerminalInstance,
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
import type { StreamingSnapshotDTO, SnapshotSubAgent } from '@/lib/api';
import { useSettingsStore } from './settingsStore';
import { refreshPRStatus } from '@/lib/api';
import { buildTurnConfigLabel } from '@/lib/models';
import { cleanupConversationState } from '@/hooks/useWebSocket';

// Throttle on-select PR refresh to avoid excessive API calls.
// Entries are pruned when the map exceeds MAX_PR_REFRESH_ENTRIES to prevent unbounded growth.
const lastPRRefreshMap = new Map<string, number>();
const PR_REFRESH_THROTTLE_MS = 15_000; // 15 seconds
const MAX_PR_REFRESH_ENTRIES = 100;

function pruneRefreshMap() {
  if (lastPRRefreshMap.size <= MAX_PR_REFRESH_ENTRIES) return;
  const now = Date.now();
  for (const [key, ts] of lastPRRefreshMap) {
    if (now - ts > PR_REFRESH_THROTTLE_MS) lastPRRefreshMap.delete(key);
  }
}

// Maximum number of file tabs before LRU eviction kicks in
const MAX_FILE_TABS = 10;

// Message eviction thresholds — conversations with more than this many messages
// get trimmed to EVICTION_KEEP when navigating away, reducing memory pressure.
// Pagination metadata is preserved so messages can be re-fetched on scroll-up.
const MESSAGE_EVICTION_THRESHOLD = 100;
const MESSAGE_EVICTION_KEEP = 50;

// Session IDs currently mounted in the LRU conversation cache.
// Eviction is skipped for these so switching back is instant (no re-fetch).
let cachedSessionIds = new Set<string>();
export function setCachedSessionIds(ids: Set<string>) {
  cachedSessionIds = ids;
}

// Callback invoked when conversation messages are evicted, allowing external
// modules (e.g. CachedConversationPane) to clear associated state like scroll
// positions without creating circular imports between store and component.
let onConversationEvict: ((conversationIds: string[]) => void) | null = null;
export function setOnConversationEvict(cb: ((conversationIds: string[]) => void) | null) {
  onConversationEvict = cb;
}

type PaginationState = {
  hasMore: boolean;
  oldestPosition: number | null;
  isLoadingMore: boolean;
  totalCount: number;
};

/**
 * Evicts old messages from the given conversation IDs when they exceed
 * MESSAGE_EVICTION_THRESHOLD. Keeps the most recent MESSAGE_EVICTION_KEEP
 * messages and marks pagination as hasMore so older messages can be re-fetched.
 * Returns the original references unchanged if no eviction is needed.
 */
function evictConversationMessages(
  messages: Record<string, Message[]>,
  pagination: Record<string, PaginationState>,
  convIds: string[],
): { messages: Record<string, Message[]>; pagination: Record<string, PaginationState> } {
  let newMessages = messages;
  let newPagination = pagination;
  let changed = false;

  for (const convId of convIds) {
    const msgs = newMessages[convId];
    if (!msgs || msgs.length <= MESSAGE_EVICTION_THRESHOLD) continue;

    if (!changed) {
      newMessages = { ...newMessages };
      newPagination = { ...newPagination };
      changed = true;
    }

    newMessages[convId] = msgs.slice(-MESSAGE_EVICTION_KEEP);
    const prev = newPagination[convId];
    newPagination[convId] = {
      hasMore: true,
      // Preserve existing cursor; if absent (shouldn't happen for large
      // conversations) leave null — the fetch path treats null as "from latest"
      // which is safe since we kept the most recent messages.
      oldestPosition: prev?.oldestPosition ?? null,
      isLoadingMore: false,
      totalCount: prev?.totalCount ?? msgs.length,
    };
  }

  return { messages: newMessages, pagination: newPagination };
}

// Script output is stored outside Zustand to avoid O(n²) array copies on every line.
// A version counter in the store triggers re-renders when output changes.
const scriptOutputBuffers = new Map<string, string[]>(); // key: `${sessionId}:${runId}`

/** Get script output lines for a run (read from external buffer) */
export function getScriptOutputLines(sessionId: string, runId: string): string[] {
  return scriptOutputBuffers.get(`${sessionId}:${runId}`) || [];
}

/** Clear script output buffers for a session */
export function clearScriptOutputBuffers(sessionId: string) {
  const prefix = `${sessionId}:`;
  const keysToDelete = [...scriptOutputBuffers.keys()].filter(k => k.startsWith(prefix));
  for (const key of keysToDelete) scriptOutputBuffers.delete(key);
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
  const convIdSet = new Set(conversationIds);
  const keysToDelete: string[] = [];
  for (const [key, timeout] of toolTimeouts) {
    const convId = key.split(':')[0];
    if (convIdSet.has(convId)) {
      clearTimeout(timeout);
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) toolTimeouts.delete(key);
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
  pendingToolApproval: null,
  pendingBatchToolApproval: null,
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
  sent?: boolean; // true after backend acknowledges receipt
}

/** Convert a QueuedMessage into a store Message for a given conversation. */
function queuedToMessage(queued: QueuedMessage, conversationId: string): Message {
  return {
    id: queued.id,
    conversationId,
    role: 'user' as const,
    content: queued.content,
    attachments: queued.attachments,
    timestamp: queued.timestamp,
  };
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
  pendingToolApproval: { requestId: string; toolName: string; toolInput: Record<string, unknown>; specifier?: string; timestamp: number } | null; // Pending single tool approval request
  pendingBatchToolApproval: { requestId: string; items: Array<{ toolUseId: string; toolName: string; toolInput: Record<string, unknown>; specifier?: string }>; timestamp: number } | null; // Pending batch tool approval
  approvedPlanContent?: string; // Plan content to persist after approval
  approvedPlanTimestamp?: number; // When the plan was approved (for timeline ordering)
  recovery?: { attempt: number; maxAttempts: number }; // Agent crash recovery in progress
  turnStartMeta?: { model?: string; effort?: string; permissionMode?: string; fastModeState?: 'off' | 'cooldown' | 'on'; backendType?: string }; // Turn-start config from init event
  compactBoundary?: { timestamp: number; trigger?: string; summary?: string; label: string }; // Auto-compact boundary from SDK
  apiRetryStatus?: { attempt: number; maxRetries: number; retryDelayMs: number; error: string } | null; // API retry in progress (SDK 0.2.84)
}

// Info about a conversation interrupted by app shutdown, detected on restart
export interface InterruptedInfo {
  agentSessionId: string;
  hadPendingPlan: boolean;
  hadPendingQuestion: boolean;
  hadPendingElicitation: boolean;
  elicitationMcpServer?: string; // MCP server name if elicitation was pending
  snapshot: StreamingSnapshotDTO | null;
  resuming?: boolean; // true while resume is in progress
}

// ActiveTool is imported from @/lib/types

interface AppState {
  // New data model
  workspaces: Workspace[];
  sessions: WorktreeSession[];
  conversations: Conversation[];
  conversationIds: Set<string>; // O(1) duplicate/existence checks
  conversationsBySession: Record<string, Conversation[]>; // sessionId → conversations (index)
  conversationsVersion: number;
  messagesByConversation: Record<string, Message[]>;
  messagesLoading: Record<string, boolean>;
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
  backgroundTasks: { [conversationId: string]: import('@/lib/types').BackgroundTask[] };

  // Queued messages per conversation (submitted while agent is streaming)
  queuedMessages: { [conversationId: string]: QueuedMessage[] };

  // Todo state
  agentTodos: { [conversationId: string]: AgentTodoItem[] };
  customTodos: { [sessionId: string]: CustomTodoItem[] };

  // Terminal instances (bottom panel terminals per session)
  terminalInstances: Record<string, TerminalInstance[]>; // keyed by sessionId
  activeTerminalId: Record<string, string | null>;       // keyed by sessionId
  terminalPanelVisible: Record<string, boolean>;         // keyed by sessionId

  // Claude Code terminal tabs (embedded CLI sessions per session)
  claudeTerminals: Record<string, ClaudeTerminalInstance[]>; // keyed by sessionId
  activeClaudeTerminalId: Record<string, string | null>;     // keyed by sessionId

  // MCP servers state
  mcpServers: McpServerStatus[];
  mcpServerConfigs: McpServerConfig[];
  mcpConfigLoading: boolean;
  mcpToolsByServer: Record<string, string[]>; // server name → tool names
  mcpServerSources: Record<string, string>;   // server name → source origin

  // Ollama progress (global — shown while binary download or model pull is active)
  ollamaProgress: import('@/lib/types').OllamaProgress | null;

  // Checkpoint timeline state
  checkpoints: CheckpointInfo[];
  // Pending checkpoint UUID per conversation (set on checkpoint_created, consumed by finalizeStreamingMessage).
  // Multiple checkpoint events can fire per turn; only the last one is kept (last-checkpoint-wins).
  // This is intentional — the final checkpoint in a turn represents the most complete file state.
  pendingCheckpointUuid: Record<string, string>;

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

  // Pending QA browser handoff requests (keyed by conversationId)
  pendingQAHandoff: { [conversationId: string]: import('@/lib/types').PendingQAHandoff | null };

  // Interrupted conversations detected on app restart (keyed by conversationId)
  interruptedState: { [conversationId: string]: InterruptedInfo | null };

  // Input suggestions from Haiku (keyed by conversationId)
  inputSuggestions: { [conversationId: string]: InputSuggestion };

  // SDK prompt suggestions (keyed by conversationId, array of suggestion strings)
  promptSuggestions: { [conversationId: string]: string[] };

  // Tool use summaries from SDK (keyed by conversationId)
  toolUseSummaries: { [conversationId: string]: Array<{ summary: string; toolUseIds: string[] }> };

  // Conversation summaries (keyed by conversationId)
  summaries: { [conversationId: string]: Summary };

  // File watcher: last file change event (for reactive subscriptions)
  lastFileChange: { workspaceId: string; path: string; fullPath: string; timestamp: number } | null;

  // Git index change signal from branch watcher (via WebSocket session_stats_update)
  lastStatsInvalidation: { sessionId: string; timestamp: number } | null;

  // Query responses from agent (dynamic model info from SDK)
  supportedModels: Array<{
    value: string;
    displayName: string;
    description: string;
    supportsEffort?: boolean;
    supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
    supportsAdaptiveThinking?: boolean;
    supportsFastMode?: boolean;
  }>;
  supportedCommands: Array<{ name: string; description: string; argumentHint: string }>;
  accountInfo: Record<string, unknown> | null;

  // Session-scoped ChatInput toggle states (keyed by sessionId)
  sessionToggleState: Record<string, SessionToggleState>;

  // Draft compose input per session (keyed by sessionId)
  draftInputs: Record<string, { text: string; attachments: Attachment[] }>;

  // Script runs state (keyed by sessionId)
  scriptRuns: Record<string, ScriptRun[]>;
  setupProgress: Record<string, SetupProgress>;
  // Per-run version counters bumped on each output line to trigger re-renders
  scriptOutputVersions: Record<string, number>;  // keyed by "sessionId:runId"

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

  // SDK prompt suggestion actions
  addPromptSuggestion: (conversationId: string, suggestion: string) => void;
  clearPromptSuggestions: (conversationId: string) => void;

  // Tool use summary actions
  addToolUseSummary: (conversationId: string, summary: { summary: string; toolUseIds: string[] }) => void;
  clearToolUseSummaries: (conversationId: string) => void;

  // Message actions
  addMessage: (message: Message) => void;
  updateMessage: (conversationId: string, id: string, updates: Partial<Message>) => void;
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
  setMessagesLoading: (convId: string, loading: boolean) => void;
  hydrateMessage: (convId: string, msgId: string, fullMsg: Message) => void;

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
  setAgentRecovering: (conversationId: string, attempt: number, maxAttempts: number) => void;
  clearAgentRecovery: (conversationId: string) => void;
  setTurnStartMeta: (conversationId: string, meta: { model?: string; effort?: string; permissionMode?: string; fastModeState?: 'off' | 'cooldown' | 'on'; backendType?: string }) => void;
  setCompactBoundary: (conversationId: string, boundary: { timestamp: number; trigger?: string }) => void;
  setCompactSummary: (conversationId: string, summary: string) => void;
  setApiRetryStatus: (conversationId: string, status: { attempt: number; maxRetries: number; retryDelayMs: number; error: string } | null) => void;
  clearStreamingText: (conversationId: string) => void;
  clearStreamingContent: (conversationId: string) => void;
  appendThinkingText: (conversationId: string, text: string) => void;
  setThinking: (conversationId: string, isThinking: boolean) => void;
  clearThinking: (conversationId: string) => void;
  setPlanModeActive: (conversationId: string, active: boolean) => void;
  setPendingPlanApproval: (conversationId: string, requestId: string, planContent?: string) => void;
  clearPendingPlanApproval: (conversationId: string) => void;
  setPendingToolApproval: (conversationId: string, requestId: string, toolName: string, toolInput: Record<string, unknown>, specifier?: string) => void;
  clearPendingToolApproval: (conversationId: string) => void;
  setPendingBatchToolApproval: (conversationId: string, requestId: string, items: Array<{ toolUseId: string; toolName: string; toolInput: Record<string, unknown>; specifier?: string }>) => void;
  clearPendingBatchToolApproval: (conversationId: string) => void;
  setApprovedPlanContent: (conversationId: string, content: string) => void;
  clearApprovedPlanContent: (conversationId: string) => void;
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
  setSubAgentUsage: (conversationId: string, toolUseId: string, usage: import('@/lib/types').SubAgentUsage) => void;
  clearSubAgents: (conversationId: string) => void;

  // Background task actions
  addBackgroundTask: (conversationId: string, task: import('@/lib/types').BackgroundTask) => void;
  updateBackgroundTask: (conversationId: string, taskId: string, update: Partial<import('@/lib/types').BackgroundTask>) => void;
  stopBackgroundTask: (conversationId: string, taskId: string) => void;
  clearBackgroundTasks: (conversationId: string) => void;
  removeBackgroundTask: (conversationId: string, taskId: string) => void;

  restoreStreamingFromSnapshot: (conversationId: string, snapshot: {
    text: string;
    textSegments?: { text: string; timestamp: number }[];
    activeTools: { id: string; tool: string; startTime: number; agentId?: string }[];
    thinking?: string;
    isThinking: boolean;
    planModeActive: boolean;
    subAgents?: SnapshotSubAgent[];
    pendingPlanApproval?: { requestId: string; planContent?: string; timestamp: number } | null;
    pendingUserQuestion?: { requestId: string; questions: import('@/lib/types').UserQuestion[]; timestamp: number } | null;
  }) => void;

  // Atomic streaming finalization - creates message and clears streaming in one update
  finalizeStreamingMessage: (
    conversationId: string,
    metadata: {
      durationMs?: number;
      toolUsage?: ToolUsage[];
      runSummary?: RunSummary;
      commitQueued?: boolean;
      /** When true, force isStreaming=false and clear all remaining queued messages.
       *  Use for terminal events (complete, error, interrupted, stop). */
      terminal?: boolean;
    }
  ) => void;

  // Queued message actions
  addQueuedMessage: (conversationId: string, message: QueuedMessage) => void;
  removeQueuedMessage: (conversationId: string, messageId: string) => void;
  markQueuedMessageSent: (conversationId: string, messageId: string) => void;
  clearQueuedMessages: (conversationId: string) => void;

  // Session handoff dialog state
  showSessionHandoff: boolean;
  setShowSessionHandoff: (show: boolean) => void;

  // Todo actions
  setAgentTodos: (conversationId: string, todos: AgentTodoItem[]) => void;
  clearAgentTodos: (conversationId: string) => void;
  addCustomTodo: (sessionId: string, content: string) => void;
  toggleCustomTodo: (sessionId: string, todoId: string) => void;
  deleteCustomTodo: (sessionId: string, todoId: string) => void;

  // Terminal instance actions (bottom panel)
  setTerminalPanelVisible: (sessionId: string, visible: boolean) => void;
  createTerminal: (sessionId: string, workspacePath: string) => TerminalInstance | null;
  closeTerminal: (sessionId: string, terminalId: string) => void;
  setActiveTerminal: (sessionId: string, terminalId: string) => void;
  markTerminalExited: (terminalId: string) => void;

  // Claude Code terminal tab actions
  createClaudeTerminal: (sessionId: string, workspacePath: string) => ClaudeTerminalInstance | null;
  closeClaudeTerminal: (sessionId: string, terminalId: string) => void;
  setActiveClaudeTerminal: (sessionId: string, terminalId: string) => void;
  markClaudeTerminalExited: (terminalId: string) => void;

  // MCP servers actions
  setMcpServers: (servers: McpServerStatus[]) => void;
  updateMcpServerStatus: (serverName: string, status: McpServerStatus['status']) => void;
  removeMcpServer: (serverName: string) => void;
  setMcpToolsByServer: (tools: Record<string, string[]>) => void;
  setMcpServerSources: (sources: Record<string, string>) => void;
  fetchMcpServerConfigs: (workspaceId: string) => Promise<void>;
  saveMcpServerConfigs: (workspaceId: string, configs: McpServerConfig[]) => Promise<void>;

  // Ollama progress actions
  setOllamaProgress: (progress: import('@/lib/types').OllamaProgress | null) => void;

  // Query response actions
  setSupportedModels: (models: Array<{
    value: string;
    displayName: string;
    description: string;
    supportsEffort?: boolean;
    supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
    supportsAdaptiveThinking?: boolean;
  }>) => void;
  setSupportedCommands: (commands: Array<{ name: string; description: string; argumentHint: string }>) => void;
  setAccountInfo: (info: Record<string, unknown>) => void;

  // Checkpoint actions
  setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
  addCheckpoint: (checkpoint: CheckpointInfo) => void;
  clearCheckpoints: () => void;
  setPendingCheckpointUuid: (conversationId: string, uuid: string) => void;

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

  // QA browser handoff actions
  setPendingQAHandoff: (conversationId: string, handoff: import('@/lib/types').PendingQAHandoff | null) => void;

  // Interrupted conversation actions (app restart recovery)
  setInterruptedState: (conversationId: string, info: InterruptedInfo | null) => void;
  setInterruptedResuming: (conversationId: string, resuming: boolean) => void;
  clearInterruptedState: (conversationId: string) => void;
  injectInterruptedAssistantMessage: (conversationId: string, snapshot: { text: string; textSegments?: { text: string; timestamp: number }[]; thinking?: string }) => void;

  // File watcher actions
  setLastFileChange: (event: { workspaceId: string; path: string; fullPath: string }) => void;
  setLastStatsInvalidation: (sessionId: string) => void;
}

/** Build a sessionId → Conversation[] lookup from a flat conversations array. */
function buildConversationsBySession(conversations: Conversation[]): Record<string, Conversation[]> {
  const index: Record<string, Conversation[]> = {};
  for (const c of conversations) {
    (index[c.sessionId] ??= []).push(c);
  }
  return index;
}

export const useAppStore = create<AppState>((set, get) => ({
  // New state
  workspaces: [],
  sessions: [],
  conversations: [],
  conversationIds: new Set(),
  conversationsBySession: {},
  conversationsVersion: 0,
  messagesByConversation: {},
  messagesLoading: {},
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
  backgroundTasks: {},
  queuedMessages: {},
  agentTodos: {},
  customTodos: {},
  terminalInstances: {},
  activeTerminalId: {},
  terminalPanelVisible: {},
  claudeTerminals: {},
  activeClaudeTerminalId: {},
  mcpServers: [],
  mcpServerConfigs: [],
  mcpConfigLoading: false,
  mcpToolsByServer: {},
  mcpServerSources: {},
  ollamaProgress: null,
  checkpoints: [],
  pendingCheckpointUuid: {},
  contextUsage: {},
  reviewComments: {},
  branchSyncStatus: {},
  branchSyncLoading: {},
  branchSyncDismissed: {},
  branchSyncCompletedAt: {},
  lastTurnCompletedAt: {},
  pendingUserQuestion: {},
  pendingQAHandoff: {},
  interruptedState: {},
  inputSuggestions: {},
  promptSuggestions: {},
  toolUseSummaries: {},
  summaries: {},
  lastFileChange: null,
  lastStatsInvalidation: null,
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
  scriptOutputVersions: {},

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
    // Bump per-run version counter to trigger re-renders.
    // Use get() + shallow clone to avoid the set(fn) callback spreading on every line.
    const prev = get().scriptOutputVersions;
    set({ scriptOutputVersions: { ...prev, [key]: (prev[key] ?? 0) + 1 } });
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
  removeWorkspace: (id) => {
    set((state) => {
    // Get all sessions for this workspace
    const workspaceSessions = state.sessions.filter((s) => s.workspaceId === id);
    const workspaceSessionIds = new Set(workspaceSessions.map((s) => s.id));

    // Get all conversation IDs for these sessions
    const workspaceConvIds = new Set(
      state.conversations
        .filter((c) => workspaceSessionIds.has(c.sessionId))
        .map((c) => c.id)
    );

    // Clean up streaming state, active tools, agent todos, and pagination
    const cleanedStreamingState = { ...state.streamingState };
    const cleanedActiveTools = { ...state.activeTools };
    const cleanedAgentTodos = { ...state.agentTodos };
    const cleanedPagination = { ...state.messagePagination };
    for (const convId of workspaceConvIds) {
      delete cleanedStreamingState[convId];
      delete cleanedActiveTools[convId];
      delete cleanedAgentTodos[convId];
      delete cleanedPagination[convId];
    }

    // Clean up custom todos, session outputs, terminal instances, terminal sessions, and last active conversation for all sessions
    const cleanedCustomTodos = { ...state.customTodos };
    const cleanedSessionOutputs = { ...state.sessionOutputs };
    const cleanedTerminalInstances = { ...state.terminalInstances };
    const cleanedActiveTerminalId = { ...state.activeTerminalId };
    const cleanedTerminalPanelVisible = { ...state.terminalPanelVisible };
    const cleanedTerminalSessions = { ...state.terminalSessions };
    const cleanedLastActive = { ...state.lastActiveConversationPerSession };
    const cleanedClaudeTerminals = { ...state.claudeTerminals };
    const cleanedActiveClaudeTerminalId = { ...state.activeClaudeTerminalId };
    for (const sessionId of workspaceSessionIds) {
      delete cleanedCustomTodos[sessionId];
      delete cleanedSessionOutputs[sessionId];
      delete cleanedTerminalInstances[sessionId];
      delete cleanedActiveTerminalId[sessionId];
      delete cleanedTerminalPanelVisible[sessionId];
      delete cleanedTerminalSessions[sessionId];
      delete cleanedLastActive[sessionId];
      delete cleanedClaudeTerminals[sessionId];
      delete cleanedActiveClaudeTerminalId[sessionId];
    }

    return {
      workspaces: state.workspaces.filter((w) => w.id !== id),
      sessions: state.sessions.filter((s) => s.workspaceId !== id),
      conversations: state.conversations.filter((c) => !workspaceSessionIds.has(c.sessionId)),
      conversationIds: new Set([...state.conversationIds].filter((cid) => !workspaceConvIds.has(cid))),
      conversationsBySession: Object.fromEntries(
        Object.entries(state.conversationsBySession).filter(([sid]) => !workspaceSessionIds.has(sid))
      ),
      messagesByConversation: Object.fromEntries(
        Object.entries(state.messagesByConversation).filter(([convId]) => !workspaceConvIds.has(convId))
      ),
      selectedWorkspaceId: state.selectedWorkspaceId === id ? null : state.selectedWorkspaceId,
      selectedSessionId: workspaceSessionIds.has(state.selectedSessionId || '')
        ? null
        : state.selectedSessionId,
      selectedConversationId: workspaceConvIds.has(state.selectedConversationId || '')
        ? null
        : state.selectedConversationId,
      streamingState: cleanedStreamingState,
      activeTools: cleanedActiveTools,
      agentTodos: cleanedAgentTodos,
      messagePagination: cleanedPagination,
      customTodos: cleanedCustomTodos,
      sessionOutputs: cleanedSessionOutputs,
      terminalInstances: cleanedTerminalInstances,
      activeTerminalId: cleanedActiveTerminalId,
      terminalPanelVisible: cleanedTerminalPanelVisible,
      terminalSessions: cleanedTerminalSessions,
      lastActiveConversationPerSession: cleanedLastActive,
      claudeTerminals: cleanedClaudeTerminals,
      activeClaudeTerminalId: cleanedActiveClaudeTerminalId,
      selectedFileTabId: null,
      fileTabs: [],
    };
    });

    // Clean up persisted workspace order (outside set() to avoid cross-store side effects)
    const { workspaceOrder, setWorkspaceOrder } = useSettingsStore.getState();
    if (workspaceOrder.includes(id)) {
      setWorkspaceOrder(workspaceOrder.filter((wId) => wId !== id));
    }
  },
  selectWorkspace: (id) => set({ selectedWorkspaceId: id }),
  reorderWorkspaces: (activeId, overId) => set((state) => {
    const oldIndex = state.workspaces.findIndex((w) => w.id === activeId);
    const newIndex = state.workspaces.findIndex((w) => w.id === overId);
    if (oldIndex === -1 || newIndex === -1) return state;
    const newWorkspaces = [...state.workspaces];
    const [removed] = newWorkspaces.splice(oldIndex, 1);
    newWorkspaces.splice(newIndex, 0, removed);
    // Persist the new order to localStorage via settingsStore
    useSettingsStore.getState().setWorkspaceOrder(newWorkspaces.map((w) => w.id));
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
    sessionConvIds.forEach(cleanupConversationState);

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
      const cleanedQueuedMessages = { ...state.queuedMessages };
      const cleanedPagination = { ...state.messagePagination };
      for (const convId of convIds) {
        delete cleanedStreamingState[convId];
        delete cleanedActiveTools[convId];
        delete cleanedAgentTodos[convId];
        delete cleanedContextUsage[convId];
        delete cleanedQueuedMessages[convId];
        delete cleanedPagination[convId];
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _terminals, ...remainingTerminalInstances } = state.terminalInstances;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _activeTerminal, ...remainingActiveTerminalId } = state.activeTerminalId;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _panelVisible, ...remainingTerminalPanelVisible } = state.terminalPanelVisible;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _claudeTerminals, ...remainingClaudeTerminals } = state.claudeTerminals;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _activeClaudeTerminal, ...remainingActiveClaudeTerminalId } = state.activeClaudeTerminalId;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _convsBySession, ...remainingConversationsBySession } = state.conversationsBySession;
      const cleanedScriptOutputVersions = Object.fromEntries(
        Object.entries(state.scriptOutputVersions).filter(([k]) => !k.startsWith(`${id}:`))
      );

      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        conversations: state.conversations.filter((c) => c.sessionId !== id),
        conversationIds: new Set([...state.conversationIds].filter((cid) => !convIds.includes(cid))),
        conversationsBySession: remainingConversationsBySession,
        messagesByConversation: Object.fromEntries(
          Object.entries(state.messagesByConversation).filter(([convId]) => !convIds.includes(convId))
        ),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        selectedConversationId: convIds.includes(state.selectedConversationId || '')
          ? null
          : state.selectedConversationId,
        streamingState: cleanedStreamingState,
        activeTools: cleanedActiveTools,
        agentTodos: cleanedAgentTodos,
        contextUsage: cleanedContextUsage,
        queuedMessages: cleanedQueuedMessages,
        messagePagination: cleanedPagination,
        customTodos: remainingCustomTodos,
        sessionOutputs: remainingSessionOutputs,
        reviewComments: remainingReviewComments,
        lastActiveConversationPerSession: remainingLastActive,
        sessionToggleState: remainingToggleState,
        draftInputs: remainingDraftInputs,
        terminalInstances: remainingTerminalInstances,
        activeTerminalId: remainingActiveTerminalId,
        terminalPanelVisible: remainingTerminalPanelVisible,
        claudeTerminals: remainingClaudeTerminals,
        activeClaudeTerminalId: remainingActiveClaudeTerminalId,
        scriptOutputVersions: cleanedScriptOutputVersions,
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

    // Evict messages from the previous session's conversations to free memory.
    // Only conversations exceeding the threshold are trimmed.
    // Skip eviction for sessions still in the LRU cache — switching back
    // would otherwise trigger an async IPC re-fetch, causing visible delay.
    const prevSessionId = state.selectedSessionId;
    let evictedMessages = state.messagesByConversation;
    let evictedPagination = state.messagePagination;
    if (prevSessionId && prevSessionId !== id && !cachedSessionIds.has(prevSessionId)) {
      const prevConvIds = state.conversations
        .filter(c => c.sessionId === prevSessionId)
        .map(c => c.id);
      const evicted = evictConversationMessages(evictedMessages, evictedPagination, prevConvIds);
      evictedMessages = evicted.messages;
      evictedPagination = evicted.pagination;
      // Notify listeners (e.g. CachedConversationPane) so they can clear
      // stale scroll positions that would otherwise skip the paint gate.
      onConversationEvict?.(prevConvIds);
    }

    set({
      selectedSessionId: id,
      selectedConversationId: targetConversation?.id || null,
      selectedFileTabId: newSelectedTabId,
      messagesByConversation: evictedMessages,
      messagePagination: evictedPagination,
    });

    // Background PR refresh: catches missed WebSocket events and externally-created PRs.
    // Throttled to max once per 30s per session. Result arrives via WebSocket.
    if (id) {
      const session = state.sessions.find(s => s.id === id);
      if (session) {
        const lastRefresh = lastPRRefreshMap.get(id) ?? 0;
        if (Date.now() - lastRefresh > PR_REFRESH_THROTTLE_MS) {
          lastPRRefreshMap.set(id, Date.now());
          pruneRefreshMap();
          refreshPRStatus(session.workspaceId, id).catch(() => {
            // Best-effort — silently ignore errors
          });
        }
      }
    }
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

    // Clean up terminal instances — PTYs for archived sessions should not stay alive
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _terminals, ...remainingTerminalInstances } = state.terminalInstances;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _activeTerminal, ...remainingActiveTerminalId } = state.activeTerminalId;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _panelVisible, ...remainingTerminalPanelVisible } = state.terminalPanelVisible;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _claudeTerminals, ...remainingClaudeTerminals } = state.claudeTerminals;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _activeClaudeTerminal, ...remainingActiveClaudeTerminalId } = state.activeClaudeTerminalId;

    return {
      sessions: updatedSessions,
      selectedSessionId: newSelectedSessionId,
      selectedConversationId: newSelectedConversationId,
      terminalInstances: remainingTerminalInstances,
      activeTerminalId: remainingActiveTerminalId,
      terminalPanelVisible: remainingTerminalPanelVisible,
      claudeTerminals: remainingClaudeTerminals,
      activeClaudeTerminalId: remainingActiveClaudeTerminalId,
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
  setConversations: (conversations) => set((state) => ({
    conversations,
    conversationIds: new Set(conversations.map((c) => c.id)),
    conversationsBySession: buildConversationsBySession(conversations),
    conversationsVersion: state.conversationsVersion + 1,
    // Messages are loaded on-demand via getConversationMessages, not inline.
    // The useEffect in ConversationArea will fetch messages for the active conversation.
  })),
  addConversation: (conversation) => set((state) => {
    // Prevent duplicates (e.g., restoring a conversation that's already in the store)
    if (state.conversationIds.has(conversation.id)) {
      return state;
    }
    const newIds = new Set(state.conversationIds);
    newIds.add(conversation.id);
    return {
      conversations: [...state.conversations, conversation],
      conversationIds: newIds,
      conversationsBySession: {
        ...state.conversationsBySession,
        [conversation.sessionId]: [...(state.conversationsBySession[conversation.sessionId] ?? []), conversation],
      },
      conversationsVersion: state.conversationsVersion + 1,
      // Also add any initial messages (e.g., system setup message from createConversation)
      messagesByConversation: conversation.messages.length > 0
        ? {
            ...state.messagesByConversation,
            [conversation.id]: [
              ...(state.messagesByConversation[conversation.id] ?? []),
              ...conversation.messages,
            ],
          }
        : state.messagesByConversation,
    };
  }),
  updateConversation: (id, updates) => set((state) => {
    const newConversations = state.conversations.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    );
    const orig = state.conversations.find((c) => c.id === id);
    const sid = orig?.sessionId;
    // If sessionId changed or conversation not found, rebuild the full index
    if (!sid || ('sessionId' in updates && updates.sessionId !== sid)) {
      return {
        conversations: newConversations,
        conversationsBySession: buildConversationsBySession(newConversations),
      };
    }
    return {
      conversations: newConversations,
      conversationsBySession: {
        ...state.conversationsBySession,
        [sid]: (state.conversationsBySession[sid] ?? []).map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      },
    };
  }),
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
    const { [id]: _qaHandoff, ...remainingQAHandoffs } = state.pendingQAHandoff;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _interrupted, ...remainingInterruptedState } = state.interruptedState;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _context, ...remainingContextUsage } = state.contextUsage;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _queued, ...remainingQueuedMessages } = state.queuedMessages;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _pagination, ...remainingPagination } = state.messagePagination;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _loading, ...remainingMessagesLoading } = state.messagesLoading;

    const removedConv = state.conversations.find((c) => c.id === id);
    const newConversations = state.conversations.filter((c) => c.id !== id);
    const newIds = new Set(state.conversationIds);
    newIds.delete(id);

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
      conversationIds: newIds,
      conversationsBySession: buildConversationsBySession(newConversations),
      messagesByConversation: (() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _removedMsgs, ...rest } = state.messagesByConversation;
        return rest;
      })(),
      selectedConversationId: newSelectedConversationId,
      lastActiveConversationPerSession: updatedLastActive,
      streamingState: remainingStreamingState,
      activeTools: remainingActiveTools,
      agentTodos: remainingAgentTodos,
      pendingUserQuestion: remainingPendingQuestions,
      pendingQAHandoff: remainingQAHandoffs,
      interruptedState: remainingInterruptedState,
      contextUsage: remainingContextUsage,
      queuedMessages: remainingQueuedMessages,
      messagePagination: remainingPagination,
      messagesLoading: remainingMessagesLoading,
    };
  });
  },
  selectConversation: (id) => {
    const state = get();
    const conversation = id ? state.conversations.find(c => c.id === id) : undefined;
    const sessionId = conversation?.sessionId || state.selectedSessionId;

    // Evict messages from the previously-selected conversation if it's large.
    // Keeps the most recent messages so scroll-to-bottom still works; older
    // messages are re-fetched on demand via pagination when the user scrolls up.
    const prevId = state.selectedConversationId;
    const shouldEvict = prevId && prevId !== id;
    const evicted = shouldEvict
      ? evictConversationMessages(state.messagesByConversation, state.messagePagination, [prevId])
      : { messages: state.messagesByConversation, pagination: state.messagePagination };
    if (shouldEvict) onConversationEvict?.([prevId]);

    set({
      selectedConversationId: id,
      checkpoints: [],
      messagesByConversation: evicted.messages,
      messagePagination: evicted.pagination,
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
    if (!state.inputSuggestions[conversationId]) return state; // No-op if already cleared
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [conversationId]: _removed, ...rest } = state.inputSuggestions;
    return { inputSuggestions: rest };
  }),

  // SDK prompt suggestion actions
  addPromptSuggestion: (conversationId, suggestion) => set((state) => {
    const existing = state.promptSuggestions[conversationId] ?? [];
    // Deduplicate and cap at 3
    if (existing.includes(suggestion)) return state;
    const updated = [...existing, suggestion].slice(-3);
    return { promptSuggestions: { ...state.promptSuggestions, [conversationId]: updated } };
  }),
  clearPromptSuggestions: (conversationId) => set((state) => {
    if (!state.promptSuggestions[conversationId]) return state;
    const { [conversationId]: _removed, ...rest } = state.promptSuggestions;
    return { promptSuggestions: rest };
  }),

  // Tool use summary actions
  addToolUseSummary: (conversationId, summary) => set((state) => {
    const existing = state.toolUseSummaries[conversationId] ?? [];
    const updated = [...existing, summary].slice(-20);
    return { toolUseSummaries: { ...state.toolUseSummaries, [conversationId]: updated } };
  }),
  clearToolUseSummaries: (conversationId) => set((state) => {
    if (!state.toolUseSummaries[conversationId]) return state;
    const { [conversationId]: _removed, ...rest } = state.toolUseSummaries;
    return { toolUseSummaries: rest };
  }),

  // Message actions
  addMessage: (message) => set((state) => {
    const convId = message.conversationId;
    const existing = state.messagesByConversation[convId] ?? [];
    const convPagination = state.messagePagination[convId];
    return {
      messagesByConversation: {
        ...state.messagesByConversation,
        [convId]: [...existing, message],
      },
      // Keep totalCount in sync so firstItemIndex stays stable
      ...(convPagination ? {
        messagePagination: {
          ...state.messagePagination,
          [convId]: {
            ...convPagination,
            totalCount: convPagination.totalCount + 1,
          },
        },
      } : {}),
    };
  }),
  updateMessage: (conversationId, id, updates) => set((state) => {
    const existing = state.messagesByConversation[conversationId];
    if (!existing) return state;
    return {
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: existing.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        ),
      },
    };
  }),
  // Message pagination actions
  setMessagePage: (convId, messages, hasMore, oldestPosition, totalCount) => set((state) => ({
    messagesByConversation: {
      ...state.messagesByConversation,
      [convId]: messages,
    },
    messagePagination: {
      ...state.messagePagination,
      [convId]: { hasMore, oldestPosition, isLoadingMore: false, totalCount },
    },
    messagesLoading: {
      ...state.messagesLoading,
      [convId]: false,
    },
  })),
  prependMessages: (convId, messages, hasMore, oldestPosition) => set((state) => {
    const existing = state.messagesByConversation[convId] ?? [];
    const existingIds = new Set(existing.map((m) => m.id));
    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    return {
      messagesByConversation: {
        ...state.messagesByConversation,
        [convId]: [...newMessages, ...existing],
      },
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
  setMessagesLoading: (convId, loading) => set((state) => ({
    messagesLoading: {
      ...state.messagesLoading,
      [convId]: loading,
    },
  })),

  hydrateMessage: (convId, msgId, fullMsg) => set((state) => {
    const messages = state.messagesByConversation[convId];
    if (!messages) return state;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return state;
    const updated = [...messages];
    updated[idx] = fullMsg;
    return { messagesByConversation: { ...state.messagesByConversation, [convId]: updated } };
  }),

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
      // Preserve pending approvals — they are active user interactions that should
      // only be dismissed explicitly by terminal events, not as a side effect.
      pendingPlanApproval: state.streamingState[conversationId]?.pendingPlanApproval ?? null,
      pendingToolApproval: state.streamingState[conversationId]?.pendingToolApproval ?? null,
      pendingBatchToolApproval: state.streamingState[conversationId]?.pendingBatchToolApproval ?? null,
      startTime: undefined,
      recovery: undefined,
    }),
  })),
  setAgentRecovering: (conversationId, attempt, maxAttempts) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      recovery: { attempt, maxAttempts },
    }),
  })),
  clearAgentRecovery: (conversationId) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      recovery: undefined,
    }),
  })),
  setTurnStartMeta: (conversationId, meta) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      turnStartMeta: meta,
    }),
  })),
  setCompactBoundary: (conversationId, boundary) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      compactBoundary: {
        ...boundary,
        label: boundary.trigger
          ? `Context was compacted (${boundary.trigger}).`
          : 'Context was compacted.',
      },
      // Force a new text segment so the compact marker appears between pre/post text
      currentSegmentId: null,
    }),
  })),
  setCompactSummary: (conversationId, summary) => set((state) => {
    const current = state.streamingState[conversationId];
    if (!current?.compactBoundary) return state;
    return {
      streamingState: updateStreamingConv(state.streamingState, conversationId, {
        compactBoundary: { ...current.compactBoundary, summary },
      }),
    };
  }),
  setApiRetryStatus: (conversationId, status) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      apiRetryStatus: status,
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
      // Preserve pending approvals — see setStreamingError comment.
      pendingPlanApproval: state.streamingState[conversationId]?.pendingPlanApproval ?? null,
      pendingToolApproval: state.streamingState[conversationId]?.pendingToolApproval ?? null,
      pendingBatchToolApproval: state.streamingState[conversationId]?.pendingBatchToolApproval ?? null,
      startTime: undefined,
      compactBoundary: undefined,
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
      compactBoundary: undefined,
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
  setPendingToolApproval: (conversationId: string, requestId: string, toolName: string, toolInput: Record<string, unknown>, specifier?: string) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      pendingToolApproval: { requestId, toolName, toolInput, specifier, timestamp: Date.now() },
    }),
  })),
  clearPendingToolApproval: (conversationId: string) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      pendingToolApproval: null,
    }),
  })),
  setPendingBatchToolApproval: (conversationId: string, requestId: string, items: Array<{ toolUseId: string; toolName: string; toolInput: Record<string, unknown>; specifier?: string }>) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      pendingBatchToolApproval: { requestId, items, timestamp: Date.now() },
    }),
  })),
  clearPendingBatchToolApproval: (conversationId: string) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      pendingBatchToolApproval: null,
    }),
  })),
  setApprovedPlanContent: (conversationId, content) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      approvedPlanContent: content,
      approvedPlanTimestamp: Date.now(),
    }),
  })),
  clearApprovedPlanContent: (conversationId) => set((state) => ({
    streamingState: updateStreamingConv(state.streamingState, conversationId, {
      approvedPlanContent: undefined,
      approvedPlanTimestamp: undefined,
    }),
  })),
  addActiveTool: (conversationId, tool, opts) => {
    return set((state) => {
      const existing = state.activeTools[conversationId] || [];
      // Dedup: skip if a tool with this id is already tracked (snapshot + live event race)
      if (existing.some(t => t.id === tool.id)) {
        return {};
      }

      // Set up timeout to force-complete orphaned tools (skip for synthetic entries that will be completed immediately).
      // Registered after dedup check so a duplicate call doesn't orphan the original tool's timeout.
      if (!opts?.skipTimeout) {
        const timeoutKey = `${conversationId}:${tool.id}`;
        const existingTimeout = toolTimeouts.get(timeoutKey);
        if (existingTimeout) clearTimeout(existingTimeout);

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

      return {
        activeTools: {
          ...state.activeTools,
          [conversationId]: [...existing, tool],
        },
        // Seal current text segment so next text creates a new segment after this tool
        streamingState: updateStreamingConv(state.streamingState, conversationId, {
          currentSegmentId: null,
        }),
      };
    });
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
  addSubAgent: (conversationId, agent) => set((state) => {
    const existing = state.subAgents[conversationId] || [];
    // Dedup: skip if a sub-agent with this id is already tracked (snapshot + live event race)
    if (existing.some(a => a.agentId === agent.agentId)) {
      return {};
    }
    return {
      subAgents: {
        ...state.subAgents,
        [conversationId]: [...existing, agent],
      },
    };
  }),
  completeSubAgent: (conversationId, agentId) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: (state.subAgents[conversationId] || []).map((a) =>
        a.agentId === agentId ? { ...a, completed: true, endTime: Date.now() } : a
      ),
    },
  })),
  addSubAgentTool: (conversationId, agentId, tool) => set((state) => {
    const agents = state.subAgents[conversationId] || [];
    const agent = agents.find(a => a.agentId === agentId);
    if (!agent) {
      console.warn(`[Store] addSubAgentTool: sub-agent ${agentId} not found for conversation ${conversationId}, dropping tool ${tool.id}`);
      return {};
    }
    // Dedup: skip if tool already exists in sub-agent's tool list (snapshot + live event race)
    if (agent.tools.some(t => t.id === tool.id)) {
      return {};
    }
    return {
      subAgents: {
        ...state.subAgents,
        [conversationId]: agents.map((a) =>
          a.agentId === agentId ? { ...a, tools: [...a.tools, tool] } : a
        ),
      },
    };
  }),
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
  setSubAgentUsage: (conversationId, toolUseId, usage) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: (state.subAgents[conversationId] || []).map((a) =>
        a.parentToolUseId === toolUseId ? { ...a, usage } : a
      ),
    },
  })),
  clearSubAgents: (conversationId) => set((state) => ({
    subAgents: {
      ...state.subAgents,
      [conversationId]: [],
    },
  })),

  // Background task mutations
  addBackgroundTask: (conversationId, task) => set((state) => {
    const existing = state.backgroundTasks[conversationId] || [];
    if (existing.some((t) => t.taskId === task.taskId)) return {};
    return {
      backgroundTasks: {
        ...state.backgroundTasks,
        [conversationId]: [...existing, task],
      },
    };
  }),
  updateBackgroundTask: (conversationId, taskId, update) => set((state) => ({
    backgroundTasks: {
      ...state.backgroundTasks,
      [conversationId]: (state.backgroundTasks[conversationId] || []).map((t) =>
        t.taskId === taskId ? { ...t, ...update } : t
      ),
    },
  })),
  stopBackgroundTask: (conversationId, taskId) => set((state) => ({
    backgroundTasks: {
      ...state.backgroundTasks,
      [conversationId]: (state.backgroundTasks[conversationId] || []).map((t) =>
        t.taskId === taskId ? { ...t, status: 'stopped' as const, endTime: Date.now() } : t
      ),
    },
  })),
  clearBackgroundTasks: (conversationId) => set((state) => ({
    backgroundTasks: {
      ...state.backgroundTasks,
      [conversationId]: [],
    },
  })),
  removeBackgroundTask: (conversationId, taskId) => set((state) => {
    const tasks = state.backgroundTasks[conversationId] || [];
    if (!tasks.some((t) => t.taskId === taskId)) return state;
    return {
      backgroundTasks: {
        ...state.backgroundTasks,
        [conversationId]: tasks.filter((t) => t.taskId !== taskId),
      },
    };
  }),
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

    // Restore pending plan approval from snapshot (if persisted before shutdown)
    const pendingPlanApproval = snapshot.pendingPlanApproval
      ? { requestId: snapshot.pendingPlanApproval.requestId, planContent: snapshot.pendingPlanApproval.planContent }
      : null;

    set((state) => ({
      streamingState: updateStreamingConv(state.streamingState, conversationId, {
        text: snapshot.text,
        segments,
        currentSegmentId,
        isStreaming: true,
        thinking: snapshot.thinking || null,
        isThinking: snapshot.isThinking,
        planModeActive: snapshot.planModeActive,
        pendingPlanApproval,
      }),
      activeTools: {
        ...state.activeTools,
        [conversationId]: parentTools,
      },
      subAgents: {
        ...state.subAgents,
        [conversationId]: restoredSubAgents,
      },
      // Restore pending user question from snapshot (if persisted before shutdown)
      ...(snapshot.pendingUserQuestion ? {
        pendingUserQuestion: {
          ...state.pendingUserQuestion,
          [conversationId]: {
            requestId: snapshot.pendingUserQuestion.requestId,
            questions: snapshot.pendingUserQuestion.questions,
            currentIndex: 0,
            answers: {},
          },
        },
      } : {}),
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
      const queuedQueue = state.queuedMessages[conversationId] ?? [];

      // Compute queued message commit EARLY so keepStreaming uses post-commit count.
      // Previously keepStreaming used pre-commit count, causing isStreaming to stay true
      // even when the queue would be empty after commit — leading to a stale streaming
      // state that turn_complete then had to clean up, causing a visual flash.
      const queued = metadata.commitQueued && queuedQueue.length > 0 ? queuedQueue[0] : null;
      const remaining = metadata.terminal ? [] : (queued ? queuedQueue.slice(1) : queuedQueue);
      // When terminal, force streaming off and clear queue regardless
      const keepStreaming = !metadata.terminal && remaining.length > 0;

      // Build cleared streaming state (preserve planModeActive and pending approvals)
      // If there are remaining queued messages (non-terminal), keep isStreaming true to avoid flash
      const clearedStreaming = {
        text: '',
        segments: [],
        currentSegmentId: null,
        isStreaming: keepStreaming,
        error: null,
        thinking: null,
        isThinking: false,
        startTime: keepStreaming ? Date.now() : undefined,
        planModeActive: streaming?.planModeActive || false,
        // Preserve pending approvals — they are active user interactions cleared
        // explicitly by terminal event handlers, not by finalization side effects.
        pendingPlanApproval: streaming?.pendingPlanApproval ?? null,
        pendingToolApproval: streaming?.pendingToolApproval ?? null,
        pendingBatchToolApproval: streaming?.pendingBatchToolApproval ?? null,
        approvedPlanContent: undefined,
        approvedPlanTimestamp: undefined,
      };

      // If no streaming text, just clear the state (but still commit first queued message if requested)
      if (!streaming?.text) {
        // queued and remaining already computed above
        const convPagination = state.messagePagination[conversationId];
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
          // Keep running background tasks alive — they can outlive the main turn
          backgroundTasks: {
            ...state.backgroundTasks,
            [conversationId]: (state.backgroundTasks[conversationId] ?? []).filter((t) => t.status === 'running'),
          },
          // Commit first queued user message even with no streaming text (e.g. turn_complete after result)
          ...(queued ? {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: [...(state.messagesByConversation[conversationId] ?? []), queuedToMessage(queued, conversationId)],
            },
            queuedMessages: { ...state.queuedMessages, [conversationId]: remaining },
            ...(convPagination ? {
              messagePagination: {
                ...state.messagePagination,
                [conversationId]: {
                  ...convPagination,
                  totalCount: convPagination.totalCount + 1,
                },
              },
            } : {}),
          } : {}),
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
      // Add thinking content to timeline (mirrors backend's thinkingBlocks logic)
      if (streaming.thinking) {
        timelineItems.push({
          timestamp: streaming.startTime || 0,
          entry: { type: 'thinking', content: streaming.thinking },
        });
      }
      // Add turn-start configuration status entry
      if (streaming.turnStartMeta) {
        const label = buildTurnConfigLabel(streaming.turnStartMeta);
        if (label) {
          timelineItems.push({
            timestamp: (streaming.startTime || 0) - 1, // Sort before thinking
            entry: { type: 'status', content: label, variant: 'config' },
          });
        }
      }
      // Add approved plan content at its chronological position
      if (streaming.approvedPlanContent && streaming.approvedPlanTimestamp) {
        timelineItems.push({ timestamp: streaming.approvedPlanTimestamp, entry: { type: 'plan', content: streaming.approvedPlanContent } });
      }
      // Add compact boundary at its chronological position
      if (streaming.compactBoundary) {
        timelineItems.push({
          timestamp: streaming.compactBoundary.timestamp,
          entry: { type: 'compact', content: streaming.compactBoundary.label, summary: streaming.compactBoundary.summary },
        });
      }
      timelineItems.sort((a, b) => a.timestamp - b.timestamp);
      const timeline: TimelineEntry[] | undefined =
        timelineItems.length > 0 ? timelineItems.map(item => item.entry) : undefined;

      // Auto-derive toolUsage from activeTools when not explicitly provided.
      // This ensures tool blocks render correctly even when callers (handleStop,
      // complete event, safety net) don't capture toolUsage themselves.
      const derivedToolUsage: ToolUsage[] | undefined =
        metadata.toolUsage !== undefined
          ? metadata.toolUsage
          : tools.length > 0
            ? tools.map((t) => ({
                id: t.id,
                tool: t.tool,
                params: t.params,
                success: t.success,
                summary: t.summary,
                durationMs: t.endTime && t.startTime ? t.endTime - t.startTime : undefined,
                stdout: t.stdout,
                stderr: t.stderr,
                metadata: t.metadata,
              }))
            : undefined;

      // Create the message from streaming text
      const pendingCpUuid = state.pendingCheckpointUuid[conversationId];
      const newMessage: Message = {
        id: `msg-${Date.now()}`,
        conversationId,
        role: 'assistant',
        content: streaming.text,
        timestamp: new Date().toISOString(),
        durationMs: metadata.durationMs,
        toolUsage: derivedToolUsage,
        runSummary: metadata.runSummary,
        ...(streaming.thinking ? { thinkingContent: streaming.thinking } : {}),
        ...(timeline ? { timeline } : {}),
        ...(pendingCpUuid ? { checkpointUuid: pendingCpUuid } : {}),
      };

      // Atomically: add message AND clear streaming state
      // When commitQueued is set, commit the first queued user message AFTER the assistant message
      // (queued and remaining already computed above)
      const existing = state.messagesByConversation[conversationId] ?? [];
      const updatedMessages = queued
        ? [...existing, newMessage, queuedToMessage(queued, conversationId)]
        : [...existing, newMessage];

      const convPagination = state.messagePagination[conversationId];
      const { [conversationId]: _removedCp, ...remainingPendingCp } = state.pendingCheckpointUuid;
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updatedMessages,
        },
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
        // Keep running background tasks alive — they can outlive the main turn
        backgroundTasks: {
          ...state.backgroundTasks,
          [conversationId]: (state.backgroundTasks[conversationId] ?? []).filter((t) => t.status === 'running'),
        },
        pendingCheckpointUuid: remainingPendingCp,
        // Update queued messages if first was committed or terminal flag clears the queue
        ...((queued || metadata.terminal) ? {
          queuedMessages: { ...state.queuedMessages, [conversationId]: remaining },
        } : {}),
        // Keep pagination totalCount in sync: +1 for the assistant message,
        // +1 more if a queued user message was also committed.
        ...(convPagination ? {
          messagePagination: {
            ...state.messagePagination,
            [conversationId]: {
              ...convPagination,
              totalCount: convPagination.totalCount + 1 + (queued ? 1 : 0),
            },
          },
        } : {}),
      };
    });
  },

  // Queued message actions
  addQueuedMessage: (conversationId, message) => set((state) => ({
    queuedMessages: {
      ...state.queuedMessages,
      [conversationId]: [...(state.queuedMessages[conversationId] ?? []), message],
    },
  })),
  removeQueuedMessage: (conversationId, messageId) => set((state) => ({
    queuedMessages: {
      ...state.queuedMessages,
      [conversationId]: (state.queuedMessages[conversationId] ?? []).filter(m => m.id !== messageId),
    },
  })),
  markQueuedMessageSent: (conversationId, messageId) => set((state) => {
    const queue = state.queuedMessages[conversationId];
    if (!queue) return {};
    const idx = queue.findIndex(m => m.id === messageId);
    if (idx === -1) return {};
    const updated = [...queue];
    updated[idx] = { ...updated[idx], sent: true };
    return { queuedMessages: { ...state.queuedMessages, [conversationId]: updated } };
  }),
  clearQueuedMessages: (conversationId) => set((state) => ({
    queuedMessages: { ...state.queuedMessages, [conversationId]: [] },
  })),

  // Session handoff dialog state
  showSessionHandoff: false,
  setShowSessionHandoff: (show) => set({ showSessionHandoff: show }),

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
  setTerminalPanelVisible: (sessionId, visible) => set((state) => ({
    terminalPanelVisible: { ...state.terminalPanelVisible, [sessionId]: visible },
  })),

  createTerminal: (sessionId, workspacePath) => {
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
      workspacePath,
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

  // Claude Code terminal tab actions
  createClaudeTerminal: (sessionId, workspacePath) => {
    const state = get();
    const existing = state.claudeTerminals[sessionId] || [];

    // Max 3 Claude Code terminals per session
    if (existing.length >= 3) return null;

    // Find lowest available slot (1-3)
    const usedSlots = new Set(existing.map(t => t.slotNumber));
    let slot = 1;
    while (usedSlots.has(slot) && slot <= 3) slot++;

    const terminal: ClaudeTerminalInstance = {
      id: `claude-term-${sessionId}-${slot}-${Date.now()}`,
      sessionId,
      slotNumber: slot,
      status: 'active',
      workspacePath,
      name: `Claude Code ${slot}`,
    };

    set({
      claudeTerminals: {
        ...state.claudeTerminals,
        [sessionId]: [...existing, terminal],
      },
      activeClaudeTerminalId: {
        ...state.activeClaudeTerminalId,
        [sessionId]: terminal.id,
      },
    });

    return terminal;
  },

  closeClaudeTerminal: (sessionId, terminalId) => {
    const state = get();
    const existing = state.claudeTerminals[sessionId] || [];
    const filtered = existing.filter(t => t.id !== terminalId);
    const wasActive = state.activeClaudeTerminalId[sessionId] === terminalId;

    let newActiveId = state.activeClaudeTerminalId[sessionId];
    if (wasActive && filtered.length > 0) {
      const closedIndex = existing.findIndex(t => t.id === terminalId);
      const nextIndex = Math.min(closedIndex, filtered.length - 1);
      newActiveId = filtered[nextIndex]?.id || null;
    } else if (filtered.length === 0) {
      newActiveId = null;
    }

    set({
      claudeTerminals: {
        ...state.claudeTerminals,
        [sessionId]: filtered,
      },
      activeClaudeTerminalId: {
        ...state.activeClaudeTerminalId,
        [sessionId]: newActiveId,
      },
    });
  },

  setActiveClaudeTerminal: (sessionId, terminalId) => {
    set({
      activeClaudeTerminalId: {
        ...get().activeClaudeTerminalId,
        [sessionId]: terminalId,
      },
    });
  },

  markClaudeTerminalExited: (terminalId) => {
    const state = get();
    // Find the session that owns this terminal and only update that session's array
    for (const [sid, terminals] of Object.entries(state.claudeTerminals)) {
      const idx = terminals.findIndex(t => t.id === terminalId);
      if (idx !== -1) {
        set({
          claudeTerminals: {
            ...state.claudeTerminals,
            [sid]: terminals.map(t =>
              t.id === terminalId ? { ...t, status: 'exited' as const } : t
            ),
          },
        });
        return;
      }
    }
  },

  // MCP servers actions
  setMcpServers: (servers) => set({ mcpServers: servers }),
  updateMcpServerStatus: (serverName, status) => set((state) => {
    const exists = state.mcpServers.some((s) => s.name === serverName);
    if (exists) {
      return { mcpServers: state.mcpServers.map((s) => s.name === serverName ? { ...s, status } : s) };
    }
    return { mcpServers: [...state.mcpServers, { name: serverName, status }] };
  }),
  removeMcpServer: (serverName) => set((state) => ({
    mcpServers: state.mcpServers.filter((s) => s.name !== serverName),
  })),
  setMcpToolsByServer: (tools) => set({ mcpToolsByServer: tools }),
  setMcpServerSources: (sources) => set({ mcpServerSources: sources }),
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
  // Ollama progress
  setOllamaProgress: (progress) => set({ ollamaProgress: progress }),

  setSupportedModels: (models) => set({ supportedModels: models }),
  setSupportedCommands: (commands) => set({ supportedCommands: commands }),
  setAccountInfo: (info) => set({ accountInfo: info }),

  // Checkpoint actions
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  addCheckpoint: (checkpoint) => set((state) => ({
    checkpoints: [...state.checkpoints, checkpoint]
  })),
  clearCheckpoints: () => set({ checkpoints: [] }),
  setPendingCheckpointUuid: (conversationId, uuid) => set((state) => ({
    pendingCheckpointUuid: { ...state.pendingCheckpointUuid, [conversationId]: uuid },
  })),

  // Context usage actions
  setContextUsage: (conversationId, usage) => set((state) => {
    // Derive default from model — extended context [1m] = 1M tokens
    const model = state.streamingState[conversationId]?.turnStartMeta?.model
      ?? state.conversations.find((c) => c.id === conversationId)?.model;
    const isExtendedContext = model?.includes('[1m]');
    const defaultContextWindow = isExtendedContext ? 1_000_000 : 200_000;

    // If the model is a [1m] variant, don't allow the SDK-reported contextWindow
    // to downgrade from 1M (the SDK reports the base 200K window, not the extended one)
    const sanitizedUsage = (isExtendedContext && usage.contextWindow !== undefined && usage.contextWindow < 1_000_000)
      ? { ...usage, contextWindow: 1_000_000 }
      : usage;

    const existing = state.contextUsage[conversationId] || {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      contextWindow: defaultContextWindow,
      lastUpdated: Date.now(),
    };
    return {
      contextUsage: {
        ...state.contextUsage,
        [conversationId]: { ...existing, ...sanitizedUsage, lastUpdated: Date.now() },
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

  // QA browser handoff actions
  setPendingQAHandoff: (conversationId: string, handoff: import('@/lib/types').PendingQAHandoff | null) => set((state) => ({
    pendingQAHandoff: {
      ...state.pendingQAHandoff,
      [conversationId]: handoff,
    },
  })),

  // Interrupted conversation actions (app restart recovery)
  setInterruptedState: (conversationId, info) => set((state) => ({
    interruptedState: {
      ...state.interruptedState,
      [conversationId]: info,
    },
  })),
  setInterruptedResuming: (conversationId, resuming) => set((state) => {
    const current = state.interruptedState[conversationId];
    if (!current) return state;
    return {
      interruptedState: {
        ...state.interruptedState,
        [conversationId]: { ...current, resuming },
      },
    };
  }),
  clearInterruptedState: (conversationId) => set((state) => ({
    interruptedState: {
      ...state.interruptedState,
      [conversationId]: null,
    },
  })),
  injectInterruptedAssistantMessage: (conversationId, snapshot) => set((state) => {
    if (!snapshot.text) return state;
    const existing = state.messagesByConversation[conversationId] ?? [];
    // Dedup: skip if the last message is already an assistant message with matching content
    // (backend's ConvertSnapshotsToMessages may have already persisted it)
    const lastMsg = existing[existing.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === snapshot.text) {
      return state;
    }
    // Build timeline from text segments
    const timeline: import('@/lib/types').TimelineEntry[] = snapshot.textSegments?.length
      ? snapshot.textSegments.filter(s => s.text).map(s => ({ type: 'text' as const, content: s.text }))
      : [{ type: 'text' as const, content: snapshot.text }];
    const message: import('@/lib/types').Message = {
      id: `interrupted-${conversationId}-${Date.now()}`,
      conversationId,
      role: 'assistant',
      content: snapshot.text,
      thinkingContent: snapshot.thinking,
      timeline,
      timestamp: new Date().toISOString(),
    };
    const convPagination = state.messagePagination[conversationId];
    return {
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [...existing, message],
      },
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
  // File watcher actions
  setLastFileChange: (event) => set({
    lastFileChange: { ...event, timestamp: Date.now() },
  }),
  setLastStatsInvalidation: (sessionId) => set({
    lastStatsInvalidation: { sessionId, timestamp: Date.now() },
  }),

}));
