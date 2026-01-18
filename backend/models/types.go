package models

import "time"

type Repo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Branch    string    `json:"branch"`
	CreatedAt time.Time `json:"createdAt"`
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
