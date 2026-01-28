package models

import "time"

type Repo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Branch    string    `json:"branch"`
	CreatedAt time.Time `json:"createdAt"`
}

// Session represents a worktree session within a workspace
type Session struct {
	ID               string        `json:"id"`
	WorkspaceID      string        `json:"workspaceId"`
	Name             string        `json:"name"`
	Branch           string        `json:"branch"`
	WorktreePath     string        `json:"worktreePath"`
	BaseCommitSHA    string        `json:"baseCommitSha,omitempty"` // Commit SHA the session was created from
	Task             string        `json:"task,omitempty"`
	Status           string        `json:"status"`            // active, idle, done, error
	AgentID          string        `json:"agentId,omitempty"` // ID of running agent process
	Stats            *SessionStats `json:"stats,omitempty"`
	PRStatus         string        `json:"prStatus,omitempty"` // none, open, merged, closed
	PRUrl            string        `json:"prUrl,omitempty"`
	PRNumber         int           `json:"prNumber,omitempty"`
	HasMergeConflict bool          `json:"hasMergeConflict,omitempty"`
	HasCheckFailures bool          `json:"hasCheckFailures,omitempty"`
	Pinned           bool          `json:"pinned,omitempty"`
	Archived         bool          `json:"archived,omitempty"`
	AutoNamed        bool          `json:"autoNamed,omitempty"` // True if session was auto-renamed based on context
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
	ID          string       `json:"id"`
	SessionID   string       `json:"sessionId"`
	Type        string       `json:"type"`   // "task", "review", "chat"
	Name        string       `json:"name"`   // AI-updatable display name
	Status      string       `json:"status"` // "active", "idle", "completed"
	Messages    []Message    `json:"messages"`
	ToolSummary []ToolAction `json:"toolSummary"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
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

// RunSummary contains summary information displayed at the end of an agent turn
type RunSummary struct {
	Success    bool      `json:"success"`
	Cost       float64   `json:"cost,omitempty"`
	Turns      int       `json:"turns,omitempty"`
	DurationMs int       `json:"durationMs,omitempty"`
	Stats      *RunStats `json:"stats,omitempty"`
	Errors     []any     `json:"errors,omitempty"`
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
	ID          string       `json:"id"`
	Role        string       `json:"role"` // "user", "assistant", "system"
	Content     string       `json:"content"`
	SetupInfo   *SetupInfo   `json:"setupInfo,omitempty"`   // For system messages with setup info
	RunSummary  *RunSummary  `json:"runSummary,omitempty"`  // For assistant messages with run summary
	Attachments []Attachment `json:"attachments,omitempty"` // File attachments
	Timestamp   time.Time    `json:"timestamp"`
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

// PRStatus constants
const (
	PRStatusNone   = "none"
	PRStatusOpen   = "open"
	PRStatusMerged = "merged"
	PRStatusClosed = "closed"
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
	Content    string     `json:"content"`
	Source     string     `json:"source"` // "claude" or "user"
	Author     string     `json:"author"` // Display name
	Severity   string     `json:"severity,omitempty"` // "error", "warning", "suggestion"
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
	SessionID     string `json:"sessionId,omitempty"`
	SessionName   string `json:"sessionName,omitempty"`
	SessionStatus string `json:"sessionStatus,omitempty"`
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

// BranchSyncResult represents the result of a branch sync operation
type BranchSyncResult struct {
	Success       bool     `json:"success"`
	NewBaseSha    string   `json:"newBaseSha,omitempty"`
	ConflictFiles []string `json:"conflictFiles,omitempty"`
	ErrorMessage  string   `json:"errorMessage,omitempty"`
}
