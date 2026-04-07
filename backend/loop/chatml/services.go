// Package chatml implements ChatML's built-in MCP tools as native Go tools
// for the native agentic loop. These tools provide the same functionality as
// the agent-runner's TypeScript MCP server (agent-runner/src/mcp/server.ts)
// but call backend services directly instead of via HTTP.
package chatml

import (
	"context"
	"sync"

	"github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/models"
)

// Services bundles all backend services needed by ChatML built-in tools.
// Interfaces are used to avoid circular imports (this package cannot import
// backend/store, backend/server, or backend/branch).
type Services struct {
	Store     SessionStore
	PRWatcher PRWatcher
}

// SessionStore is the subset of store.SQLiteStore methods needed by ChatML tools.
type SessionStore interface {
	// Session
	GetSession(ctx context.Context, id string) (*models.Session, error)
	UpdateSession(ctx context.Context, id string, updates func(*models.Session)) error

	// Review comments
	AddReviewComment(ctx context.Context, comment *models.ReviewComment) error
	GetReviewComment(ctx context.Context, id string) (*models.ReviewComment, error)
	ListReviewComments(ctx context.Context, sessionID string) ([]*models.ReviewComment, error)
	ListReviewCommentsForFile(ctx context.Context, sessionID, filePath string) ([]*models.ReviewComment, error)
	UpdateReviewComment(ctx context.Context, id string, updates func(*models.ReviewComment)) error
	GetReviewCommentStats(ctx context.Context, sessionID string) ([]*models.CommentStats, error)
}

// RepoManager is the subset of git.RepoManager methods needed by ChatML tools.
type RepoManager interface {
	GetStatus(ctx context.Context, worktreePath, baseBranch string) (*git.GitStatus, error)
	GetCurrentBranch(ctx context.Context, repoPath string) (string, error)
	GetCommitsAheadOfBase(ctx context.Context, repoPath, baseRef string) ([]git.BranchCommit, error)
	GetChangedFilesWithStats(ctx context.Context, repoPath, baseRef string) ([]git.FileChange, error)
	GetUntrackedFiles(ctx context.Context, repoPath string) ([]git.FileChange, error)
	GetDiffSummary(ctx context.Context, repoPath, baseRef string, maxBytes int) (string, error)
	GetFileDiffUnified(ctx context.Context, repoPath, baseRef, filePath string, maxBytes int) (string, error)
	FilterGitIgnored(ctx context.Context, repoPath string, changes []git.FileChange) []git.FileChange
}

// PRWatcher is the subset of branch.PRWatcher methods needed by ChatML tools.
type PRWatcher interface {
	RegisterPRFromAgent(sessionID string, prNumber int, prURL string)
	ForceCheckSession(sessionID string)
	UnlinkPR(sessionID string)
}

// ToolContext holds per-session immutable context available to all ChatML tools.
type ToolContext struct {
	SessionID    string
	WorkspaceID  string
	Workdir      string
	TargetBranch string
	LinearIssue  string // e.g., "LIN-123"
}

// LinearIssueState holds mutable Linear issue state for the session.
// Thread-safe for concurrent tool access.
type LinearIssueState struct {
	mu    sync.RWMutex
	issue *LinearIssue
}

// LinearIssue represents a Linear issue associated with a session.
type LinearIssue struct {
	ID          string   `json:"id"`
	Identifier  string   `json:"identifier"` // e.g., "LIN-123"
	Title       string   `json:"title"`
	Description string   `json:"description"`
	State       string   `json:"state"`
	Labels      []string `json:"labels"`
	Assignee    string   `json:"assignee,omitempty"`
	Project     string   `json:"project,omitempty"`
}

// NewLinearIssueState creates a LinearIssueState, optionally initialized from an issue identifier.
func NewLinearIssueState(identifier string) *LinearIssueState {
	s := &LinearIssueState{}
	if identifier != "" {
		s.issue = &LinearIssue{Identifier: identifier}
	}
	return s
}

// Get returns a copy of the current Linear issue, or nil if none.
// Returns a copy so callers can read fields without synchronization
// even if Set() is called concurrently.
func (s *LinearIssueState) Get() *LinearIssue {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.issue == nil {
		return nil
	}
	cp := *s.issue
	// Deep-copy the Labels slice to prevent shared backing array.
	if s.issue.Labels != nil {
		cp.Labels = make([]string, len(s.issue.Labels))
		copy(cp.Labels, s.issue.Labels)
	}
	return &cp
}

// Set updates the Linear issue.
func (s *LinearIssueState) Set(issue *LinearIssue) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.issue = issue
}

// Clear removes the Linear issue.
func (s *LinearIssueState) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.issue = nil
}
