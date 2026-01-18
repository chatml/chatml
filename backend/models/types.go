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
	ID              string         `json:"id"`
	WorkspaceID     string         `json:"workspaceId"`
	Name            string         `json:"name"`
	Branch          string         `json:"branch"`
	WorktreePath    string         `json:"worktreePath"`
	Task            string         `json:"task,omitempty"`
	Status          string         `json:"status"` // active, idle, done, error
	Stats           *SessionStats  `json:"stats,omitempty"`
	PRStatus        string         `json:"prStatus,omitempty"`  // none, open, merged, closed
	PRUrl           string         `json:"prUrl,omitempty"`
	PRNumber        int            `json:"prNumber,omitempty"`
	HasMergeConflict bool          `json:"hasMergeConflict,omitempty"`
	HasCheckFailures bool          `json:"hasCheckFailures,omitempty"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
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
