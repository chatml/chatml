// Session priority levels (matches Linear)
export type SessionPriority = 0 | 1 | 2 | 3 | 4;

// Session task status (user-managed workflow state, distinct from agent execution status)
export type SessionTaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

// Workspace = A repository pointed to a path on disk
export interface Workspace {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  remote: string;
  branchPrefix: string;   // "github" | "custom" | "none" | ""
  customPrefix: string;
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
  priority: SessionPriority;
  taskStatus: SessionTaskStatus;
  archived?: boolean; // whether the session is archived
  archiveSummary?: string; // AI-generated summary created at archive time
  archiveSummaryStatus?: '' | 'generating' | 'completed' | 'failed';
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
  targetBranch?: string; // Per-session target branch override (e.g. "origin/develop")
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
  model?: string; // Last-used model (e.g., "claude-opus-4-5-20251101", "claude-sonnet-4-20250514")
  messages: Message[];
  messageCount?: number; // Total messages (set when messages are loaded lazily)
  toolSummary: ToolAction[];
  createdAt: string;
  updatedAt: string;
}

// Summary of a conversation, generated on demand
export interface Summary {
  id: string;
  conversationId: string;
  sessionId: string;
  conversationName?: string;
  content: string;
  status: 'generating' | 'completed' | 'failed';
  errorMessage?: string;
  messageCount: number;
  createdAt: string;
}

// ToolAction = Record of a tool usage
export interface ToolAction {
  id: string;
  tool: string;
  target: string;
  success: boolean;
}

// Token usage from an agent run (aggregated across all API calls).
// Cache fields are optional because some API responses omit them when zero.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

// Per-model usage breakdown (matches Claude Agent SDK's ModelUsage).
// All fields are required here because the SDK always provides them, defaulting to 0.
export interface ModelUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

// Run summary displayed at end of agent turn
export interface RunSummary {
  success: boolean;
  cost?: number;
  turns?: number;
  durationMs?: number;
  stats?: RunStats;
  errors?: unknown[];
  usage?: TokenUsage;
  modelUsage?: Record<string, ModelUsageInfo>;
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

// Timeline entry preserving interleaved text/tool ordering in finalized messages
export type TimelineEntry =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolId: string };

// Active tool during streaming (real-time tracking)
export interface ActiveTool {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  success?: boolean;
  summary?: string;
  stdout?: string;
  stderr?: string;
  untracked?: boolean; // Tool result arrived without matching tool_start (race condition recovery)
  elapsedSeconds?: number; // Updated from tool_progress events for long-running tools
  agentId?: string; // Sub-agent that owns this tool (undefined = parent agent)
}

// Sub-agent spawned by the Task tool during parallel execution
export interface SubAgent {
  agentId: string;
  agentType: string; // e.g., "Explore", "Bash", "general-purpose"
  parentToolUseId?: string; // The Task tool_use_id that spawned this sub-agent
  description?: string; // Task description from the Task tool's description parameter
  output?: string; // Result text from sub-agent completion
  startTime: number;
  endTime?: number;
  completed: boolean;
  tools: ActiveTool[];
}

// Setup info for system messages
export interface SetupInfo {
  sessionName: string;
  branchName: string;
  originBranch: string;
  fileCount?: number;
}

// Attachment = File attached to a message
export interface Attachment {
  id: string;
  type: 'file' | 'image';
  name: string;              // Display filename
  path?: string;             // Local file path (optional - may not exist for stored attachments)
  mimeType: string;
  size: number;              // bytes
  lineCount?: number;        // For text/code files
  width?: number;            // For images
  height?: number;           // For images
  base64Data?: string;       // Loaded on demand before send
  preview?: string;          // Text preview (first N chars)
}

// SuggestionPill = A clickable suggestion option
export interface SuggestionPill {
  label: string;
  value: string;
}

// InputSuggestion = AI-generated input suggestion (ghost text + optional pills)
export interface InputSuggestion {
  ghostText: string;
  pills: SuggestionPill[];
  timestamp?: number; // Date.now() when suggestion was created
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
  // File attachments (images, code, text files)
  attachments?: Attachment[];
  // Extended thinking/reasoning content from the model
  thinkingContent?: string;
  // Ordered timeline preserving interleaved text and tool structure from streaming
  timeline?: TimelineEntry[];
  // Approved plan content from ExitPlanMode
  planContent?: string;
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
  source?: 'startup' | 'resume' | 'clear' | 'compact' | 'user' | 'exit_plan' | 'sdk_status';
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
  // Raw from WebSocket — normalized to TokenUsage in useWebSocket before storing
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  structuredOutput?: unknown;

  // Context usage fields
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow?: number;

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
  description?: string;
  agentOutput?: string;
  transcriptPath?: string;

  // Compact boundary fields
  trigger?: 'manual' | 'auto';
  preTokens?: number;
  customInstructions?: string | null;

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

  // User question fields (AskUserQuestion tool)
  requestId?: string;
  questions?: UserQuestion[];

  // Plan approval fields (ExitPlanMode tool)
  planContent?: string;

  // Input suggestion fields
  ghostText?: string;
  pills?: SuggestionPill[];

  // CLI crash recovery fields
  attempt?: number;
  maxAttempts?: number;
}

// MCP server status
export interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'idle';
}

// MCP server configuration (user-managed)
export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
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
  PRE_COMPACT: 'pre_compact',
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

  // User question events (AskUserQuestion tool)
  USER_QUESTION_REQUEST: 'user_question_request',
} as const;

// AskUserQuestion tool types
export interface UserQuestionOption {
  label: string;
  description: string;
}

export interface UserQuestion {
  question: string;
  header: string;
  options: UserQuestionOption[];
  multiSelect: boolean;
}

export interface PendingUserQuestion {
  requestId: string;
  questions: UserQuestion[];
  currentIndex: number;  // Track which question is being shown
  answers: Record<string, string>;  // header -> selected label(s)
}

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
  conversationId?: string;
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

// Context window usage tracking
export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextWindow: number;
  lastUpdated: number;
}

// User-defined custom todo item
export interface CustomTodoItem {
  id: string;
  content: string;
  completed: boolean;
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
  isEmpty?: boolean;          // File has no content (0 bytes)
  loadError?: string;         // Error message if loading failed
  saveError?: string;         // Error message if saving failed
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
  title?: string;
  content: string;
  source: 'claude' | 'user';
  author: string;
  severity?: 'error' | 'warning' | 'suggestion' | 'info';
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

// Commit info for branch sync
export interface SyncCommit {
  sha: string;
  subject: string;
}

// Branch sync status - how far behind the session is from origin/main
export interface BranchSyncStatus {
  behindBy: number;
  commits: SyncCommit[];
  baseBranch: string;   // e.g., "origin/main"
  lastChecked: string;  // ISO timestamp
}

// Branch sync result - result of a rebase or merge operation
export interface BranchSyncResult {
  success: boolean;
  newBaseSha?: string;
  conflictFiles?: string[];
  errorMessage?: string;
}

// Scripts config (.chatml/config.json)
export interface ScriptDef {
  name: string;
  command: string;
}

export interface ChatMLConfig {
  setupScripts: ScriptDef[];
  runScripts: Record<string, ScriptDef>;
  hooks: Record<string, string>;
  autoSetup: boolean;
}

export type ScriptRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface ScriptRun {
  id: string;
  sessionId: string;
  scriptKey?: string;
  scriptName: string;
  command: string;
  status: ScriptRunStatus;
  exitCode?: number;
  output: string[];
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface SetupProgress {
  current: number;
  total: number;
  status: 'running' | 'completed' | 'failed';
}
