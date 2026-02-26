package models

import "time"

type Repo struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Path         string    `json:"path"`
	Branch       string    `json:"branch"`
	Remote       string    `json:"remote"`       // git remote name, default "origin"
	BranchPrefix string    `json:"branchPrefix"` // "github", "custom", "none", or "" (use global)
	CustomPrefix string    `json:"customPrefix"` // custom prefix value when BranchPrefix=="custom"
	CreatedAt    time.Time `json:"createdAt"`
}

// Session represents a worktree session within a workspace
type Session struct {
	ID               string        `json:"id"`
	WorkspaceID      string        `json:"workspaceId"`
	Name             string        `json:"name"`
	Branch           string        `json:"branch"`
	WorktreePath     string        `json:"worktreePath"`
	BaseCommitSHA    string        `json:"baseCommitSha,omitempty"`    // Commit SHA the session was created from
	TargetBranch     string        `json:"targetBranch,omitempty"`    // Per-session target branch override (e.g. "origin/develop")
	Task             string        `json:"task,omitempty"`
	Status           string        `json:"status"`            // active, idle, done, error
	AgentID          string        `json:"agentId,omitempty"` // ID of running agent process
	Stats            *SessionStats `json:"stats,omitempty"`
	PRStatus         string        `json:"prStatus,omitempty"` // none, open, merged, closed
	PRUrl            string        `json:"prUrl,omitempty"`
	PRNumber         int           `json:"prNumber,omitempty"`
	PRTitle          string        `json:"prTitle,omitempty"`
	HasMergeConflict bool          `json:"hasMergeConflict,omitempty"`
	HasCheckFailures bool          `json:"hasCheckFailures,omitempty"`
	CheckStatus      string        `json:"checkStatus,omitempty"` // none, pending, success, failure
	Priority         int           `json:"priority"`             // 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
	TaskStatus       string        `json:"taskStatus"`           // backlog, in_progress, in_review, done, cancelled
	Pinned           bool          `json:"pinned,omitempty"`
	Archived             bool   `json:"archived,omitempty"`
	ArchiveSummary       string `json:"archiveSummary,omitempty"`
	ArchiveSummaryStatus string `json:"archiveSummaryStatus,omitempty"` // "", "generating", "completed", "failed"
	AutoNamed            bool   `json:"autoNamed,omitempty"`            // True if session was auto-renamed based on context
	CreatedAt        time.Time     `json:"createdAt"`
	UpdatedAt        time.Time     `json:"updatedAt"`
}

type SessionStats struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

// SessionWithWorkspace combines session data with its parent workspace info
// for efficient single-query fetches that need both session and workspace data
type SessionWithWorkspace struct {
	Session
	WorkspacePath   string `json:"workspacePath"`
	WorkspaceBranch string `json:"workspaceBranch"`
	WorkspaceRemote string `json:"workspaceRemote,omitempty"`
}

// DefaultBranch returns the workspace's default branch name (e.g. "main", "master"),
// falling back to "main" if not set.
func (s *SessionWithWorkspace) DefaultBranch() string {
	if s.WorkspaceBranch != "" {
		return s.WorkspaceBranch
	}
	return "main"
}

// EffectiveRemote returns the workspace's configured remote, defaulting to "origin".
func (s *SessionWithWorkspace) EffectiveRemote() string {
	if s.WorkspaceRemote != "" {
		return s.WorkspaceRemote
	}
	return "origin"
}

// EffectiveTargetBranch returns the session's target branch if set,
// otherwise returns "<remote>/" + the workspace default branch.
// Used for git sync operations and PR base branch.
func (s *SessionWithWorkspace) EffectiveTargetBranch() string {
	if s.TargetBranch != "" {
		return s.TargetBranch
	}
	return s.EffectiveRemote() + "/" + s.DefaultBranch()
}

type Agent struct {
	ID        string    `json:"id"`
	RepoID    string    `json:"repoId"`
	Task      string    `json:"task"`
	Status    string    `json:"status"` // pending, running, done, error
	Worktree  string    `json:"worktree"`
	Branch    string    `json:"branch"`
	CreatedAt time.Time `json:"createdAt"`
}

type AgentStatus string

const (
	StatusPending AgentStatus = "pending"
	StatusRunning AgentStatus = "running"
	StatusDone    AgentStatus = "done"
	StatusError   AgentStatus = "error"
)

// Conversation represents a chat conversation within a session
type Conversation struct {
	ID           string       `json:"id"`
	SessionID    string       `json:"sessionId"`
	Type         string       `json:"type"`   // "task", "review", "chat"
	Name         string       `json:"name"`   // AI-updatable display name
	Status       string       `json:"status"` // "active", "idle", "completed"
	Model          string       `json:"model,omitempty"`
	AgentSessionID string       `json:"agentSessionId,omitempty"` // Claude SDK session ID for resume
	Messages       []Message    `json:"messages"`
	MessageCount int          `json:"messageCount,omitempty"`
	ToolSummary  []ToolAction `json:"toolSummary"`
	CreatedAt    time.Time    `json:"createdAt"`
	UpdatedAt    time.Time    `json:"updatedAt"`
}

// MessagePage represents a paginated page of messages
type MessagePage struct {
	Messages       []Message `json:"messages"`
	HasMore        bool      `json:"hasMore"`
	TotalCount     int       `json:"totalCount"`
	OldestPosition int       `json:"oldestPosition,omitempty"`
}

// SetupInfo contains information about the worktree setup for system messages
type SetupInfo struct {
	SessionName  string `json:"sessionName"`
	BranchName   string `json:"branchName"`
	OriginBranch string `json:"originBranch"`
	FileCount    int    `json:"fileCount,omitempty"`
}

// RunStats contains detailed statistics from an agent run
type RunStats struct {
	ToolCalls           int            `json:"toolCalls"`
	ToolsByType         map[string]int `json:"toolsByType"`
	SubAgents           int            `json:"subAgents"`
	FilesRead           int            `json:"filesRead"`
	FilesWritten        int            `json:"filesWritten"`
	BashCommands        int            `json:"bashCommands"`
	WebSearches         int            `json:"webSearches"`
	TotalToolDurationMs int            `json:"totalToolDurationMs"`
}

// TokenUsage contains aggregated token counts from an agent run
type TokenUsage struct {
	InputTokens              int `json:"inputTokens"`
	OutputTokens             int `json:"outputTokens"`
	CacheReadInputTokens     int `json:"cacheReadInputTokens,omitempty"`
	CacheCreationInputTokens int `json:"cacheCreationInputTokens,omitempty"`
}

// ModelUsageInfo contains per-model usage breakdown
type ModelUsageInfo struct {
	InputTokens              int     `json:"inputTokens"`
	OutputTokens             int     `json:"outputTokens"`
	CacheReadInputTokens     int     `json:"cacheReadInputTokens"`
	CacheCreationInputTokens int     `json:"cacheCreationInputTokens"`
	WebSearchRequests        int     `json:"webSearchRequests"`
	CostUSD                  float64 `json:"costUSD"`
	ContextWindow            int     `json:"contextWindow"`
}

// PermissionDenial records a tool that was denied during a turn
type PermissionDenial struct {
	ToolName  string `json:"toolName"`
	ToolUseId string `json:"toolUseId"`
}

// RunSummary contains summary information displayed at the end of an agent turn
type RunSummary struct {
	Success           bool                       `json:"success"`
	Cost              float64                    `json:"cost,omitempty"`
	Turns             int                        `json:"turns,omitempty"`
	DurationMs        int                        `json:"durationMs,omitempty"`
	Stats             *RunStats                  `json:"stats,omitempty"`
	Errors            []any                      `json:"errors,omitempty"`
	Usage             *TokenUsage                `json:"usage,omitempty"`
	ModelUsage        map[string]*ModelUsageInfo  `json:"modelUsage,omitempty"`
	LimitExceeded     string                     `json:"limitExceeded,omitempty"`
	PermissionDenials []PermissionDenial         `json:"permissionDenials,omitempty"`
}

// Attachment represents a file attached to a message
type Attachment struct {
	ID         string `json:"id"`
	Type       string `json:"type"`               // "file" or "image"
	Name       string `json:"name"`               // Display filename
	Path       string `json:"path,omitempty"`     // Local file path
	MimeType   string `json:"mimeType"`           // MIME type
	Size       int64  `json:"size"`               // Size in bytes
	LineCount  int    `json:"lineCount,omitempty"`  // For text/code files
	Width      int    `json:"width,omitempty"`      // For images
	Height     int    `json:"height,omitempty"`     // For images
	Base64Data string `json:"base64Data,omitempty"` // Base64-encoded content
	Preview    string `json:"preview,omitempty"`    // Text preview
}

// Message represents a single message in a conversation
type Message struct {
	ID              string             `json:"id"`
	Role            string             `json:"role"` // "user", "assistant", "system"
	Content         string             `json:"content"`
	SetupInfo       *SetupInfo         `json:"setupInfo,omitempty"`       // For system messages with setup info
	RunSummary      *RunSummary        `json:"runSummary,omitempty"`      // For assistant messages with run summary
	Attachments     []Attachment       `json:"attachments,omitempty"`     // File attachments
	ToolUsage       []ToolUsageRecord  `json:"toolUsage,omitempty"`       // Per-message tool usage details
	ThinkingContent string             `json:"thinkingContent,omitempty"` // Extended thinking/reasoning content
	DurationMs      int                `json:"durationMs,omitempty"`      // Turn duration in milliseconds
	Timeline        []TimelineEntry    `json:"timeline,omitempty"`        // Interleaved text/tool ordering
	PlanContent     string             `json:"planContent,omitempty"`     // Approved plan content
	CheckpointUuid  string             `json:"checkpointUuid,omitempty"`  // File checkpoint UUID for revert
	Timestamp       time.Time          `json:"timestamp"`
}

// ToolUsageRecord represents detailed tool usage information stored per-message
type ToolUsageRecord struct {
	ID         string                 `json:"id"`
	Tool       string                 `json:"tool"`
	Params     map[string]interface{} `json:"params,omitempty"`
	Success    *bool                  `json:"success,omitempty"`
	Summary    string                 `json:"summary,omitempty"`
	DurationMs int                    `json:"durationMs,omitempty"`
	Stdout     string                 `json:"stdout,omitempty"`
	Stderr     string                 `json:"stderr,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	StartTime  time.Time              `json:"-"` // Not persisted; used for timeline ordering
}

// TimelineEntry represents an entry in the interleaved message timeline
type TimelineEntry struct {
	Type    string `json:"type"`              // "text", "tool", "thinking", "plan", or "status"
	Content string `json:"content,omitempty"` // For text, thinking, plan, and status entries
	ToolID  string `json:"toolId,omitempty"`  // For tool entries, references ToolUsageRecord.ID
	Variant string `json:"variant,omitempty"` // For status entries: "thinking_enabled", "config", "info"
}

// ToolAction represents a tool usage record for the summary
type ToolAction struct {
	ID      string `json:"id"`
	Tool    string `json:"tool"`   // "read_file", "write_file", "bash", etc.
	Target  string `json:"target"` // file path or command
	Success bool   `json:"success"`
}

// ConversationType constants
const (
	ConversationTypeTask   = "task"
	ConversationTypeReview = "review"
	ConversationTypeChat   = "chat"
)

// ConversationStatus constants
const (
	ConversationStatusActive    = "active"
	ConversationStatusIdle      = "idle"
	ConversationStatusCompleted = "completed"
)

// SessionStatus constants
const (
	SessionStatusActive = "active"
	SessionStatusIdle   = "idle"
	SessionStatusDone   = "done"
	SessionStatusError  = "error"
)

// ValidSessionStatuses is the set of valid session status values
var ValidSessionStatuses = map[string]bool{
	SessionStatusActive: true,
	SessionStatusIdle:   true,
	SessionStatusDone:   true,
	SessionStatusError:  true,
}

// Priority constants
const (
	PriorityNone   = 0
	PriorityUrgent = 1
	PriorityHigh   = 2
	PriorityMedium = 3
	PriorityLow    = 4
)

// ValidPriorities is the set of valid priority values
var ValidPriorities = map[int]bool{
	PriorityNone:   true,
	PriorityUrgent: true,
	PriorityHigh:   true,
	PriorityMedium: true,
	PriorityLow:    true,
}

// TaskStatus constants (user-managed workflow state, distinct from agent execution Status)
const (
	TaskStatusBacklog    = "backlog"
	TaskStatusInProgress = "in_progress"
	TaskStatusInReview   = "in_review"
	TaskStatusDone       = "done"
	TaskStatusCancelled  = "cancelled"
)

// ValidTaskStatuses is the set of valid task status values
var ValidTaskStatuses = map[string]bool{
	TaskStatusBacklog:    true,
	TaskStatusInProgress: true,
	TaskStatusInReview:   true,
	TaskStatusDone:       true,
	TaskStatusCancelled:  true,
}

// Summary represents a generated summary of a conversation
type Summary struct {
	ID               string    `json:"id"`
	ConversationID   string    `json:"conversationId"`
	SessionID        string    `json:"sessionId"`
	ConversationName string    `json:"conversationName,omitempty"`
	Content          string    `json:"content"`
	Status           string    `json:"status"` // "generating", "completed", "failed"
	ErrorMessage     string    `json:"errorMessage,omitempty"`
	MessageCount     int       `json:"messageCount"`
	CreatedAt        time.Time `json:"createdAt"`
}

// SummaryStatus constants
const (
	SummaryStatusGenerating = "generating"
	SummaryStatusCompleted  = "completed"
	SummaryStatusFailed     = "failed"
)

// PRStatus constants
const (
	PRStatusNone   = "none"
	PRStatusOpen   = "open"
	PRStatusMerged = "merged"
	PRStatusClosed = "closed"
)

// CheckStatus constants
const (
	CheckStatusNone    = "none"
	CheckStatusPending = "pending"
	CheckStatusSuccess = "success"
	CheckStatusFailure = "failure"
)

// ValidPRStatuses is the set of valid PR status values
var ValidPRStatuses = map[string]bool{
	PRStatusNone:   true,
	PRStatusOpen:   true,
	PRStatusMerged: true,
	PRStatusClosed: true,
}

// FileTab represents an open file tab in the editor
type FileTab struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspaceId"`
	SessionID      string    `json:"sessionId,omitempty"` // Optional - null for workspace-scoped tabs
	Path           string    `json:"path"`
	ViewMode       string    `json:"viewMode"` // "file" or "diff"
	IsPinned       bool      `json:"isPinned"`
	Position       int       `json:"position"`
	OpenedAt       time.Time `json:"openedAt"`
	LastAccessedAt time.Time `json:"lastAccessedAt"`
}

// ReviewComment represents an inline code review comment
type ReviewComment struct {
	ID         string     `json:"id"`
	SessionID  string     `json:"sessionId"`
	FilePath   string     `json:"filePath"`
	LineNumber int        `json:"lineNumber"`
	Title      string     `json:"title,omitempty"`
	Content    string     `json:"content"`
	Source     string     `json:"source"` // "claude" or "user"
	Author     string     `json:"author"` // Display name
	Severity   string     `json:"severity,omitempty"` // "error", "warning", "suggestion", "info"
	CreatedAt  time.Time  `json:"createdAt"`
	Resolved   bool       `json:"resolved"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy string     `json:"resolvedBy,omitempty"`
}

// ReviewCommentSource constants
const (
	CommentSourceClaude = "claude"
	CommentSourceUser   = "user"
)

// ReviewCommentSeverity constants
const (
	CommentSeverityError      = "error"
	CommentSeverityWarning    = "warning"
	CommentSeveritySuggestion = "suggestion"
	CommentSeverityInfo       = "info"
)

// CommentStats represents per-file comment statistics
type CommentStats struct {
	FilePath   string `json:"filePath"`
	Total      int    `json:"total"`
	Unresolved int    `json:"unresolved"`
}

// BranchInfo represents metadata about a git branch
type BranchInfo struct {
	Name              string    `json:"name"`
	IsRemote          bool      `json:"isRemote"`
	IsHead            bool      `json:"isHead"`
	LastCommitSHA     string    `json:"lastCommitSha"`
	LastCommitDate    time.Time `json:"lastCommitDate"`
	LastCommitSubject string    `json:"lastCommitSubject"`
	LastAuthor        string    `json:"lastAuthor"`
	LastAuthorEmail   string    `json:"lastAuthorEmail,omitempty"`
	AheadMain         int       `json:"aheadMain"`
	BehindMain        int       `json:"behindMain"`
	Prefix            string    `json:"prefix"` // e.g., "feature", "fix", "session"
}

// BranchWithSession combines branch info with optional session linkage
type BranchWithSession struct {
	BranchInfo
	SessionID        string `json:"sessionId,omitempty"`
	SessionName      string `json:"sessionName,omitempty"`
	SessionStatus    string `json:"sessionStatus,omitempty"`
	PRNumber         int    `json:"prNumber,omitempty"`
	PRStatus         string `json:"prStatus,omitempty"`
	PRUrl            string `json:"prUrl,omitempty"`
	CheckStatus      string `json:"checkStatus,omitempty"`
	HasMergeConflict bool   `json:"hasMergeConflict,omitempty"`
}

// BranchListResponse is the response structure for the branches endpoint
type BranchListResponse struct {
	SessionBranches []BranchWithSession `json:"sessionBranches"`
	OtherBranches   []BranchWithSession `json:"otherBranches"`
	CurrentBranch   string              `json:"currentBranch"`
	Total           int                 `json:"total"`
	HasMore         bool                `json:"hasMore"`
}

// SyncCommit represents a commit in the sync status
type SyncCommit struct {
	SHA     string `json:"sha"`
	Subject string `json:"subject"`
}

// BranchSyncStatus represents the sync status of a session branch with origin/main
type BranchSyncStatus struct {
	BehindBy    int          `json:"behindBy"`
	Commits     []SyncCommit `json:"commits"`
	BaseBranch  string       `json:"baseBranch"`  // e.g., "origin/main"
	LastChecked string       `json:"lastChecked"` // ISO timestamp
}

// BranchSyncRequest represents a request to sync a session branch
type BranchSyncRequest struct {
	Operation string `json:"operation"` // "rebase" or "merge"
}

// McpServerConfig represents a user-configured MCP server
type McpServerConfig struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"`              // "stdio", "sse", "http"
	Command string            `json:"command,omitempty"`  // stdio: executable path
	Args    []string          `json:"args,omitempty"`     // stdio: command-line arguments
	Env     map[string]string `json:"env,omitempty"`      // stdio: environment variables
	URL     string            `json:"url,omitempty"`      // sse/http: server URL
	Headers map[string]string `json:"headers,omitempty"`  // sse/http: request headers
	Enabled bool              `json:"enabled"`
}

// BranchSyncResult represents the result of a branch sync operation
type BranchSyncResult struct {
	Success       bool     `json:"success"`
	NewBaseSha    string   `json:"newBaseSha,omitempty"`
	ConflictFiles []string `json:"conflictFiles,omitempty"`
	ErrorMessage  string   `json:"errorMessage,omitempty"`
}

// Checkpoint represents a file state snapshot created by the Claude Agent SDK at message boundaries.
type Checkpoint struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	SessionID      string    `json:"sessionId"`
	UUID           string    `json:"uuid"`
	MessageIndex   int       `json:"messageIndex"`
	IsResult       bool      `json:"isResult"`
	Timestamp      time.Time `json:"timestamp"`
}
