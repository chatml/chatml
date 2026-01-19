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
export interface FileTab {
  id: string;
  workspaceId: string;
  path: string;
  name: string;
  content?: string;
  isLoading?: boolean;
  isDirty?: boolean;
  viewMode?: 'file' | 'diff';
  diff?: {
    oldContent: string;
    newContent: string;
  };
  isBinary?: boolean;
  isTooLarge?: boolean;
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
