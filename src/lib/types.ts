// Workspace = A repository pointed to a path on disk
export interface Workspace {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  createdAt: string;
}

// WorktreeSession = A git worktree created for a workspace
export interface WorktreeSession {
  id: string;
  workspaceId: string;
  name: string; // branch name or descriptive name
  branch: string;
  worktreePath: string;
  task?: string; // optional task description
  status: 'active' | 'idle' | 'done' | 'error';
  archived?: boolean; // whether the session is archived
  pinned?: boolean; // whether the session is pinned to the top
  stats?: {
    additions: number;
    deletions: number;
  };
  // PR and merge status
  prStatus?: 'none' | 'open' | 'merged' | 'closed';
  prUrl?: string;
  prNumber?: number;
  hasMergeConflict?: boolean;
  hasCheckFailures?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Conversation = Chat within a worktree session
export interface Conversation {
  id: string;
  sessionId: string;
  type: 'task' | 'review' | 'chat';
  name: string; // AI-updatable display name
  status: 'active' | 'idle' | 'completed';
  messages: Message[];
  toolSummary: ToolAction[];
  createdAt: string;
  updatedAt: string;
}

// ToolAction = Record of a tool usage
export interface ToolAction {
  id: string;
  tool: string;
  target: string;
  success: boolean;
}

// Run summary displayed at end of agent turn
export interface RunSummary {
  success: boolean;
  cost?: number;
  turns?: number;
  durationMs?: number;
  stats?: RunStats;
  errors?: unknown[];
}

// Tool usage record for message history
export interface ToolUsage {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

// Setup info for system messages
export interface SetupInfo {
  sessionName: string;
  branchName: string;
  originBranch: string;
  fileCount?: number;
}

// Message = Individual message in a conversation
export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  // For system messages, can include setup info
  setupInfo?: SetupInfo;
  // For assistant messages, can include structured content
  verificationResults?: VerificationResult[];
  fileChanges?: FileChange[];
  toolUsage?: ToolUsage[];
  timestamp: string;
  durationMs?: number;
  // Run summary at end of agent turn
  runSummary?: RunSummary;
}

// Run statistics from agent
export interface RunStats {
  toolCalls: number;
  toolsByType: Record<string, number>;
  subAgents: number;
  filesRead: number;
  filesWritten: number;
  bashCommands: number;
  webSearches: number;
  totalToolDurationMs: number;
}

// Agent event from WebSocket
export interface AgentEvent {
  type: string;
  conversationId?: string;
  content?: string;
  id?: string;
  tool?: string;
  params?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  duration?: number;
  name?: string;
  message?: string;
  // Result event fields
  cost?: number;
  turns?: number;
  stats?: RunStats;
  subtype?: string;
  errors?: unknown[];
  // Todo update fields
  todos?: AgentTodoItem[];

  // Session management fields
  sessionId?: string;
  resuming?: boolean;
  forking?: boolean;
  source?: 'startup' | 'resume' | 'clear' | 'compact';
  reason?: string;

  // Enhanced init fields
  model?: string;
  tools?: string[];
  mcpServers?: McpServerStatus[];
  slashCommands?: string[];
  skills?: string[];
  plugins?: PluginInfo[];
  agents?: string[];
  permissionMode?: string;
  claudeCodeVersion?: string;
  apiKeySource?: string;
  betas?: string[];
  outputStyle?: string;
  cwd?: string;
  budgetConfig?: {
    maxBudgetUsd?: number;
    maxTurns?: number;
    maxThinkingTokens?: number;
  };

  // Extended result fields
  durationMs?: number;
  durationApiMs?: number;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  structuredOutput?: unknown;

  // Hook event fields
  toolUseId?: string;
  input?: unknown;
  response?: unknown;
  title?: string;
  notificationType?: string;
  error?: string;
  isInterrupt?: boolean;
  stopHookActive?: boolean;

  // Subagent fields
  agentId?: string;
  agentType?: string;
  transcriptPath?: string;

  // Compact boundary fields
  trigger?: 'manual' | 'auto';
  preTokens?: number;

  // Status fields
  status?: string | null;

  // Hook response fields
  hookName?: string;
  hookEvent?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;

  // Tool progress fields
  toolName?: string;
  elapsedTimeSeconds?: number;
  parentToolUseId?: string;

  // Auth status fields
  isAuthenticating?: boolean;
  output?: string[];

  // Query info response fields
  models?: ModelInfo[];
  commands?: SlashCommand[];
  servers?: McpServerStatus[];
  info?: AccountInfo;
  mode?: string;

  // Stderr data
  data?: string;

  // Checkpoint fields
  checkpointUuid?: string;
  messageIndex?: number;
  isResult?: boolean;
}

// MCP server status
export interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending';
}

// Plugin information
export interface PluginInfo {
  name: string;
  path: string;
}

// Model information
export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
}

// Slash command information
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

// Account information
export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
}

// Event type constants for type safety
export const AgentEventTypes = {
  // Core events
  READY: 'ready',
  INIT: 'init',
  ASSISTANT_TEXT: 'assistant_text',
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  NAME_SUGGESTION: 'name_suggestion',
  TODO_UPDATE: 'todo_update',
  RESULT: 'result',
  COMPLETE: 'complete',
  ERROR: 'error',
  SHUTDOWN: 'shutdown',

  // Session events
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  SESSION_ID_UPDATE: 'session_id_update',

  // Hook events
  HOOK_PRE_TOOL: 'hook_pre_tool',
  HOOK_POST_TOOL: 'hook_post_tool',
  HOOK_TOOL_FAILURE: 'hook_tool_failure',
  AGENT_NOTIFICATION: 'agent_notification',
  AGENT_STOP: 'agent_stop',
  HOOK_RESPONSE: 'hook_response',

  // Subagent events
  SUBAGENT_STARTED: 'subagent_started',
  SUBAGENT_STOPPED: 'subagent_stopped',

  // System events
  COMPACT_BOUNDARY: 'compact_boundary',
  STATUS_UPDATE: 'status_update',
  TOOL_PROGRESS: 'tool_progress',
  AUTH_STATUS: 'auth_status',
  AGENT_STDERR: 'agent_stderr',

  // Control events
  INTERRUPTED: 'interrupted',
  MODEL_CHANGED: 'model_changed',
  PERMISSION_MODE_CHANGED: 'permission_mode_changed',
  SUPPORTED_MODELS: 'supported_models',
  SUPPORTED_COMMANDS: 'supported_commands',
  MCP_STATUS: 'mcp_status',
  ACCOUNT_INFO: 'account_info',

  // Thinking events
  THINKING: 'thinking',
  THINKING_DELTA: 'thinking_delta',
  THINKING_START: 'thinking_start',

  // Checkpoint events
  CHECKPOINT_CREATED: 'checkpoint_created',
  FILES_REWOUND: 'files_rewound',
} as const;

export interface VerificationResult {
  name: string;
  status: 'pass' | 'fail' | 'running' | 'skipped';
  details?: string;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted';
}

// Agent todo item from TodoWrite tool
export interface AgentTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// File checkpoint for rewind support
export interface CheckpointInfo {
  uuid: string;
  timestamp: string;
  messageIndex: number;
  isResult?: boolean;
}

// Budget and limits status
export interface BudgetStatus {
  maxBudgetUsd?: number;
  currentCostUsd: number;
  maxTurns?: number;
  currentTurns: number;
  maxThinkingTokens?: number;
  currentThinkingTokens: number;
  limitExceeded?: 'budget' | 'turns' | 'thinking_tokens';
}

// User-defined custom todo item
export interface CustomTodoItem {
  id: string;
  content: string;
  completed: boolean;
  createdAt: string;
}

// Legacy types for backward compatibility
export interface Repo {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  repoId: string;
  task: string;
  status: 'pending' | 'running' | 'done' | 'error';
  worktree: string;
  branch: string;
  createdAt: string;
}

export interface WSEvent {
  type: string; // 'output' | 'status' | 'assistant_text' | 'tool_start' | 'tool_end' | 'name_suggestion' | 'conversation_status' | 'thinking' | 'thinking_delta' | 'thinking_start' | etc.
  agentId?: string;
  sessionId?: string;
  conversationId?: string;
  payload?: string | AgentEvent;
}

// File tab for the editor
// All file tabs are now session-scoped (workspace-scoped tabs were deprecated and auto-migrated)
export interface FileTab {
  id: string;
  workspaceId: string;
  sessionId: string;          // Required: all tabs belong to a session
  path: string;
  name: string;
  content?: string;
  originalContent?: string;   // Content when loaded/saved (for dirty detection)
  isLoading?: boolean;
  isDirty?: boolean;
  viewMode?: 'file' | 'diff';
  diff?: {
    oldContent: string;
    newContent: string;
  };
  isBinary?: boolean;
  isTooLarge?: boolean;
  isPinned?: boolean;         // Pin support - pinned tabs won't auto-close
  openedAt?: string;          // ISO timestamp for ordering/history
  lastAccessedAt?: string;    // ISO timestamp for LRU tab closing
  // Editor state restoration fields
  scrollPosition?: { top: number; left: number };
  cursorPosition?: { line: number; column: number };
}

// Terminal session for interactive PTY
export interface TerminalSession {
  id: string;
  workspaceId: string;
  sessionId: string;
  tabType: 'setup' | 'run' | 'terminal';
  cwd: string;
  status: 'idle' | 'active' | 'closed';
}

// Terminal instance for bottom panel terminals (per session)
export interface TerminalInstance {
  id: string;           // "sessionId-term-slotNumber"
  sessionId: string;
  slotNumber: number;   // 1-5
  status: 'active' | 'exited';
}

// Review comment for code review inline comments
export interface ReviewComment {
  id: string;
  sessionId: string;
  filePath: string;
  lineNumber: number;
  content: string;
  source: 'claude' | 'user';
  author: string;
  severity?: 'error' | 'warning' | 'suggestion';
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

// Comment statistics per file
export interface CommentStats {
  filePath: string;
  total: number;
  unresolved: number;
}
