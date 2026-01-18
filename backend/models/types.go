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
	Task             string        `json:"task,omitempty"`
	Status           string        `json:"status"` // active, idle, done, error
	AgentID          string        `json:"agentId,omitempty"` // ID of running agent process
	Stats            *SessionStats `json:"stats,omitempty"`
	PRStatus         string        `json:"prStatus,omitempty"` // none, open, merged, closed
	PRUrl            string        `json:"prUrl,omitempty"`
	PRNumber         int           `json:"prNumber,omitempty"`
	HasMergeConflict bool          `json:"hasMergeConflict,omitempty"`
	HasCheckFailures bool          `json:"hasCheckFailures,omitempty"`
	CreatedAt        time.Time     `json:"createdAt"`
	UpdatedAt        time.Time     `json:"updatedAt"`
}

type SessionStats struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
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

// Message represents a single message in a conversation
type Message struct {
	ID        string     `json:"id"`
	Role      string     `json:"role"` // "user", "assistant", "system"
	Content   string     `json:"content"`
	SetupInfo *SetupInfo `json:"setupInfo,omitempty"` // For system messages with setup info
	Timestamp time.Time  `json:"timestamp"`
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
