package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a requested resource does not exist
var ErrNotFound = errors.New("not found")

// SQLiteStore implements data persistence using SQLite
// Note: We don't use a Go mutex because SQLite with WAL mode handles concurrency.
// The busy_timeout pragma handles lock contention at the database level.
type SQLiteStore struct {
	db     *sql.DB
	dbPath string
}

// NewSQLiteStore creates a new SQLite-backed store
func NewSQLiteStore() (*SQLiteStore, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	dataDir := filepath.Join(homeDir, ".chatml")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(dataDir, "chatml.db")

	logger.SQLite.Infof("Opening database at %s", dbPath)

	// Open database with optimized settings
	db, err := sql.Open("sqlite", dbPath+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}

	// Allow multiple connections for nested queries (reading conversations with messages)
	// SQLite with WAL mode handles concurrent readers well
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(0)

	s := &SQLiteStore{
		db:     db,
		dbPath: dbPath,
	}

	// Initialize schema
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, err
	}

	return s, nil
}

// NewSQLiteStoreInMemory creates an in-memory SQLite store for testing
func NewSQLiteStoreInMemory() (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}

	// Single connection for in-memory databases
	db.SetMaxOpenConns(1)

	s := &SQLiteStore{
		db:     db,
		dbPath: ":memory:",
	}

	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, err
	}

	return s, nil
}

// Close closes the database connection
func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// initSchema creates the database tables if they don't exist
func (s *SQLiteStore) initSchema() error {
	schema := `
	-- Repos (workspaces)
	CREATE TABLE IF NOT EXISTS repos (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT NOT NULL UNIQUE,
		branch TEXT NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_repos_path ON repos(path);

	-- Sessions
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		branch TEXT NOT NULL DEFAULT '',
		worktree_path TEXT NOT NULL DEFAULT '',
		task TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'idle',
		agent_id TEXT DEFAULT NULL,
		pr_status TEXT NOT NULL DEFAULT 'none',
		pr_url TEXT NOT NULL DEFAULT '',
		pr_number INTEGER NOT NULL DEFAULT 0,
		has_merge_conflict INTEGER NOT NULL DEFAULT 0,
		has_check_failures INTEGER NOT NULL DEFAULT 0,
		stats_additions INTEGER NOT NULL DEFAULT 0,
		stats_deletions INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (workspace_id) REFERENCES repos(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);

	-- Agents (legacy)
	CREATE TABLE IF NOT EXISTS agents (
		id TEXT PRIMARY KEY,
		repo_id TEXT NOT NULL,
		task TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'pending',
		worktree TEXT NOT NULL DEFAULT '',
		branch TEXT NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_agents_repo_id ON agents(repo_id);

	-- Conversations
	CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'task',
		name TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'active',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);

	-- Messages (normalized from Conversation.Messages)
	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		setup_info TEXT DEFAULT NULL,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		position INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

	-- Tool Actions (normalized from Conversation.ToolSummary)
	CREATE TABLE IF NOT EXISTS tool_actions (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		tool TEXT NOT NULL,
		target TEXT NOT NULL DEFAULT '',
		success INTEGER NOT NULL DEFAULT 1,
		position INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_tool_actions_conversation_id ON tool_actions(conversation_id);

	-- Schema versioning
	CREATE TABLE IF NOT EXISTS schema_version (
		version INTEGER PRIMARY KEY,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	INSERT OR IGNORE INTO schema_version (version) VALUES (1);
	`

	_, err := s.db.Exec(schema)
	if err != nil {
		return err
	}

	// Run migrations
	if err := s.runMigrations(); err != nil {
		return err
	}

	logger.SQLite.Infof("Schema initialized")
	return nil
}

// runMigrations applies any necessary schema migrations
func (s *SQLiteStore) runMigrations() error {
	// Migration: Add setup_info column to messages if it doesn't exist
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'setup_info'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE messages ADD COLUMN setup_info TEXT DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added setup_info column to messages")
	}

	// Migration: Add pinned column to sessions if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'pinned'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added pinned column to sessions")
	}

	// Migration: Add archived column to sessions if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'archived'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added archived column to sessions")
	}

	// Migration: Add run_summary column to messages if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'run_summary'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE messages ADD COLUMN run_summary TEXT DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added run_summary column to messages")
	}

	// Migration: Add base_commit_sha column to sessions if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'base_commit_sha'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN base_commit_sha TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added base_commit_sha column to sessions")
	}

	// Migration: Create file_tabs table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS file_tabs (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			session_id TEXT,
			path TEXT NOT NULL,
			view_mode TEXT NOT NULL DEFAULT 'file',
			is_pinned INTEGER NOT NULL DEFAULT 0,
			position INTEGER NOT NULL DEFAULT 0,
			opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_accessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (workspace_id) REFERENCES repos(id) ON DELETE CASCADE,
			FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	// Create index on workspace_id for efficient lookups
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_file_tabs_workspace ON file_tabs(workspace_id)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: file_tabs table ready")

	// Migration: Create orchestrator_agents table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS orchestrator_agents (
			id TEXT PRIMARY KEY,
			yaml_path TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			polling_interval_ms INTEGER,
			last_run_at DATETIME,
			last_error TEXT,
			total_runs INTEGER NOT NULL DEFAULT 0,
			total_cost REAL NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: orchestrator_agents table ready")

	// Migration: Create agent_runs table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS agent_runs (
			id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL,
			trigger TEXT NOT NULL,
			status TEXT NOT NULL,
			result_summary TEXT,
			sessions_created TEXT,
			cost REAL NOT NULL DEFAULT 0,
			started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME,
			FOREIGN KEY (agent_id) REFERENCES orchestrator_agents(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: agent_runs table ready")

	// Migration: Create review_comments table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS review_comments (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			line_number INTEGER NOT NULL,
			content TEXT NOT NULL,
			source TEXT NOT NULL,
			author TEXT NOT NULL,
			severity TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			resolved INTEGER NOT NULL DEFAULT 0,
			resolved_at DATETIME,
			resolved_by TEXT,
			FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_review_comments_session ON review_comments(session_id)`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_review_comments_file ON review_comments(session_id, file_path)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: review_comments table ready")

	// Migration: Create attachments table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS attachments (
			id TEXT PRIMARY KEY,
			message_id TEXT NOT NULL,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			path TEXT,
			mime_type TEXT NOT NULL,
			size INTEGER NOT NULL,
			line_count INTEGER,
			width INTEGER,
			height INTEGER,
			base64_data TEXT,
			preview TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: attachments table ready")

	return nil
}

// Helper functions
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func intToBool(i int) bool {
	return i != 0
}

// ============================================================================
// Repo methods
// ============================================================================

func (s *SQLiteStore) AddRepo(ctx context.Context, repo *models.Repo) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO repos (id, name, path, branch, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, branch=excluded.branch`,
		repo.ID, repo.Name, repo.Path, repo.Branch, repo.CreatedAt)
	if err != nil {
		return fmt.Errorf("AddRepo: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetRepo(ctx context.Context, id string) (*models.Repo, error) {
	var repo models.Repo
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, path, branch, created_at
		FROM repos WHERE id = ?`, id).Scan(
		&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetRepo: %w", err)
	}
	return &repo, nil
}

func (s *SQLiteStore) ListRepos(ctx context.Context) ([]*models.Repo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, path, branch, created_at FROM repos`)
	if err != nil {
		return nil, fmt.Errorf("ListRepos: %w", err)
	}
	defer rows.Close()

	repos := []*models.Repo{}
	for rows.Next() {
		var repo models.Repo
		if err := rows.Scan(&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.CreatedAt); err != nil {
			return nil, fmt.Errorf("ListRepos scan: %w", err)
		}
		repos = append(repos, &repo)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListRepos rows: %w", err)
	}
	return repos, nil
}

func (s *SQLiteStore) GetRepoByPath(ctx context.Context, path string) (*models.Repo, error) {
	var repo models.Repo
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, path, branch, created_at
		FROM repos WHERE path = ?`, path).Scan(
		&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetRepoByPath: %w", err)
	}
	return &repo, nil
}

func (s *SQLiteStore) DeleteRepo(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM repos WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteRepo: %w", err)
	}
	return nil
}

// ============================================================================
// Session methods
// ============================================================================

func (s *SQLiteStore) AddSession(ctx context.Context, session *models.Session) error {
	return RetryDBExec(ctx, "AddSession", DefaultRetryConfig(), func(ctx context.Context) error {
		statsAdditions, statsDeletions := 0, 0
		if session.Stats != nil {
			statsAdditions = session.Stats.Additions
			statsDeletions = session.Stats.Deletions
		}

		_, err := s.db.ExecContext(ctx, `
			INSERT INTO sessions (id, workspace_id, name, branch, worktree_path, base_commit_sha, task,
				status, agent_id, pr_status, pr_url, pr_number, has_merge_conflict,
				has_check_failures, stats_additions, stats_deletions, pinned, archived, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			session.ID, session.WorkspaceID, session.Name, session.Branch,
			session.WorktreePath, session.BaseCommitSHA, session.Task, session.Status, session.AgentID,
			session.PRStatus, session.PRUrl, session.PRNumber,
			boolToInt(session.HasMergeConflict), boolToInt(session.HasCheckFailures),
			statsAdditions, statsDeletions, boolToInt(session.Pinned), boolToInt(session.Archived),
			session.CreatedAt, session.UpdatedAt)
		return err
	})
}

func (s *SQLiteStore) GetSession(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
	var agentID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, archived, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.CreatedAt, &session.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSession: %w", err)
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	session.Pinned = intToBool(pinned)
	session.Archived = intToBool(archived)
	if agentID.Valid {
		session.AgentID = agentID.String
	}
	if statsAdditions > 0 || statsDeletions > 0 {
		session.Stats = &models.SessionStats{
			Additions: statsAdditions,
			Deletions: statsDeletions,
		}
	}

	return &session, nil
}

// GetSessionWithWorkspace fetches a session with its workspace data in a single JOIN query
// This eliminates the N+1 pattern of fetching session then workspace separately
func (s *SQLiteStore) GetSessionWithWorkspace(ctx context.Context, id string) (*models.SessionWithWorkspace, error) {
	var result models.SessionWithWorkspace
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned int
	var agentID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.workspace_id, s.name, s.branch, s.worktree_path, s.base_commit_sha,
			s.task, s.status, s.agent_id, s.pr_status, s.pr_url, s.pr_number,
			s.has_merge_conflict, s.has_check_failures, s.stats_additions, s.stats_deletions,
			s.pinned, s.created_at, s.updated_at,
			r.path, r.branch
		FROM sessions s
		JOIN repos r ON s.workspace_id = r.id
		WHERE s.id = ?`, id).Scan(
		&result.ID, &result.WorkspaceID, &result.Name, &result.Branch,
		&result.WorktreePath, &result.BaseCommitSHA, &result.Task, &result.Status, &agentID,
		&result.PRStatus, &result.PRUrl, &result.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &result.CreatedAt, &result.UpdatedAt,
		&result.WorkspacePath, &result.WorkspaceBranch)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSessionWithWorkspace: %w", err)
	}

	result.HasMergeConflict = intToBool(hasMergeConflict)
	result.HasCheckFailures = intToBool(hasCheckFailures)
	result.Pinned = intToBool(pinned)
	if agentID.Valid {
		result.AgentID = agentID.String
	}
	if statsAdditions > 0 || statsDeletions > 0 {
		result.Stats = &models.SessionStats{
			Additions: statsAdditions,
			Deletions: statsDeletions,
		}
	}

	return &result, nil
}

func (s *SQLiteStore) ListSessions(ctx context.Context, workspaceID string, includeArchived bool) ([]*models.Session, error) {
	query := `SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
		pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
		stats_additions, stats_deletions, pinned, archived, created_at, updated_at
		FROM sessions WHERE workspace_id = ?`
	if !includeArchived {
		query += " AND archived = 0"
	}
	query += " ORDER BY pinned DESC, created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("ListSessions: %w", err)
	}
	defer rows.Close()

	sessions := []*models.Session{}
	for rows.Next() {
		var session models.Session
		var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
		var agentID sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber,
			&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
			&pinned, &archived, &session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
		session.Archived = intToBool(archived)
		if agentID.Valid {
			session.AgentID = agentID.String
		}
		if statsAdditions > 0 || statsDeletions > 0 {
			session.Stats = &models.SessionStats{
				Additions: statsAdditions,
				Deletions: statsDeletions,
			}
		}

		sessions = append(sessions, &session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListSessions rows: %w", err)
	}
	return sessions, nil
}

// ListAllSessions returns all sessions across all workspaces
// Used for dashboard data loading to avoid N queries for N workspaces
func (s *SQLiteStore) ListAllSessions(ctx context.Context, includeArchived bool) ([]*models.Session, error) {
	query := `SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
		pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
		stats_additions, stats_deletions, pinned, archived, created_at, updated_at
		FROM sessions`
	if !includeArchived {
		query += " WHERE archived = 0"
	}
	query += " ORDER BY pinned DESC, created_at DESC"
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("ListAllSessions: %w", err)
	}
	defer rows.Close()

	sessions := []*models.Session{}
	for rows.Next() {
		var session models.Session
		var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
		var agentID sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber,
			&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
			&pinned, &archived, &session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListAllSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
		session.Archived = intToBool(archived)
		if agentID.Valid {
			session.AgentID = agentID.String
		}
		if statsAdditions > 0 || statsDeletions > 0 {
			session.Stats = &models.SessionStats{
				Additions: statsAdditions,
				Deletions: statsDeletions,
			}
		}

		sessions = append(sessions, &session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListAllSessions rows: %w", err)
	}
	return sessions, nil
}

func (s *SQLiteStore) UpdateSession(ctx context.Context, id string, updates func(*models.Session)) error {
	// Read current state outside retry to avoid stale data on retry
	session, err := s.getSessionNoLock(ctx, id)
	if err != nil {
		return err
	}
	if session == nil {
		return nil // No error, just nothing to update
	}

	// Apply updates
	updates(session)
	session.UpdatedAt = time.Now()

	// Write back with retry for transient errors
	statsAdditions, statsDeletions := 0, 0
	if session.Stats != nil {
		statsAdditions = session.Stats.Additions
		statsDeletions = session.Stats.Deletions
	}

	return RetryDBExec(ctx, "UpdateSession", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			UPDATE sessions SET
				name = ?, branch = ?, worktree_path = ?, base_commit_sha = ?, task = ?,
				status = ?, agent_id = ?, pr_status = ?, pr_url = ?,
				pr_number = ?, has_merge_conflict = ?, has_check_failures = ?,
				stats_additions = ?, stats_deletions = ?, pinned = ?, archived = ?, updated_at = ?
			WHERE id = ?`,
			session.Name, session.Branch, session.WorktreePath, session.BaseCommitSHA, session.Task,
			session.Status, session.AgentID, session.PRStatus, session.PRUrl,
			session.PRNumber, boolToInt(session.HasMergeConflict),
			boolToInt(session.HasCheckFailures),
			statsAdditions, statsDeletions, boolToInt(session.Pinned), boolToInt(session.Archived),
			session.UpdatedAt, id)
		return err
	})
}

func (s *SQLiteStore) getSessionNoLock(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
	var agentID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, archived, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.CreatedAt, &session.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getSessionNoLock: %w", err)
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	session.Pinned = intToBool(pinned)
	session.Archived = intToBool(archived)
	if agentID.Valid {
		session.AgentID = agentID.String
	}
	if statsAdditions > 0 || statsDeletions > 0 {
		session.Stats = &models.SessionStats{
			Additions: statsAdditions,
			Deletions: statsDeletions,
		}
	}

	return &session, nil
}

func (s *SQLiteStore) DeleteSession(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteSession: %w", err)
	}
	return nil
}

// ============================================================================
// Agent methods
// ============================================================================

func (s *SQLiteStore) AddAgent(ctx context.Context, agent *models.Agent) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agents (id, repo_id, task, status, worktree, branch, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		agent.ID, agent.RepoID, agent.Task, agent.Status,
		agent.Worktree, agent.Branch, agent.CreatedAt)
	if err != nil {
		return fmt.Errorf("AddAgent: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetAgent(ctx context.Context, id string) (*models.Agent, error) {
	var agent models.Agent
	err := s.db.QueryRowContext(ctx, `
		SELECT id, repo_id, task, status, worktree, branch, created_at
		FROM agents WHERE id = ?`, id).Scan(
		&agent.ID, &agent.RepoID, &agent.Task, &agent.Status,
		&agent.Worktree, &agent.Branch, &agent.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetAgent: %w", err)
	}
	return &agent, nil
}

func (s *SQLiteStore) ListAgents(ctx context.Context, repoID string) ([]*models.Agent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, repo_id, task, status, worktree, branch, created_at
		FROM agents WHERE repo_id = ?`, repoID)
	if err != nil {
		return nil, fmt.Errorf("ListAgents: %w", err)
	}
	defer rows.Close()

	agents := []*models.Agent{}
	for rows.Next() {
		var agent models.Agent
		if err := rows.Scan(&agent.ID, &agent.RepoID, &agent.Task, &agent.Status,
			&agent.Worktree, &agent.Branch, &agent.CreatedAt); err != nil {
			return nil, fmt.Errorf("ListAgents scan: %w", err)
		}
		agents = append(agents, &agent)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListAgents rows: %w", err)
	}
	return agents, nil
}

func (s *SQLiteStore) UpdateAgentStatus(ctx context.Context, id string, status models.AgentStatus) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agents SET status = ? WHERE id = ?`, string(status), id)
	if err != nil {
		return fmt.Errorf("UpdateAgentStatus: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteAgent(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agents WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteAgent: %w", err)
	}
	return nil
}

// ============================================================================
// Conversation methods
// ============================================================================

func (s *SQLiteStore) AddConversation(ctx context.Context, conv *models.Conversation) error {
	return RetryDBExec(ctx, "AddConversation", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO conversations (id, session_id, type, name, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			conv.ID, conv.SessionID, conv.Type, conv.Name,
			conv.Status, conv.CreatedAt, conv.UpdatedAt)
		return err
	})
}

func (s *SQLiteStore) GetConversation(ctx context.Context, id string) (*models.Conversation, error) {
	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.CreatedAt, &conv.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetConversation: %w", err)
	}

	// Initialize slices to empty (not nil) so JSON serializes as [] not null
	conv.Messages = []models.Message{}
	conv.ToolSummary = []models.ToolAction{}

	// Load messages
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, role, content, setup_info, run_summary, timestamp
		FROM messages
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("GetConversation messages: %w", err)
	}
	defer rows.Close()
	msgIndexByID := make(map[string]int)
	for rows.Next() {
		var msg models.Message
		var setupInfoJSON sql.NullString
		var runSummaryJSON sql.NullString
		if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &runSummaryJSON, &msg.Timestamp); err != nil {
			return nil, fmt.Errorf("GetConversation message scan: %w", err)
		}
		if setupInfoJSON.Valid {
			var setupInfo models.SetupInfo
			if json.Unmarshal([]byte(setupInfoJSON.String), &setupInfo) == nil {
				msg.SetupInfo = &setupInfo
			}
		}
		if runSummaryJSON.Valid {
			var runSummary models.RunSummary
			if json.Unmarshal([]byte(runSummaryJSON.String), &runSummary) == nil {
				msg.RunSummary = &runSummary
			}
		}
		msgIndexByID[msg.ID] = len(conv.Messages)
		conv.Messages = append(conv.Messages, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetConversation messages rows: %w", err)
	}

	// Load attachments for all messages
	if len(conv.Messages) > 0 {
		if err := s.loadAttachmentsForMessages(ctx, conv.Messages, msgIndexByID); err != nil {
			return nil, err
		}
	}

	// Load tool actions
	toolRows, err := s.db.QueryContext(ctx, `
		SELECT id, tool, target, success
		FROM tool_actions
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("GetConversation tool_actions: %w", err)
	}
	defer toolRows.Close()
	for toolRows.Next() {
		var action models.ToolAction
		var success int
		if err := toolRows.Scan(&action.ID, &action.Tool, &action.Target, &success); err != nil {
			return nil, fmt.Errorf("GetConversation tool_action scan: %w", err)
		}
		action.Success = intToBool(success)
		conv.ToolSummary = append(conv.ToolSummary, action)
	}
	if err := toolRows.Err(); err != nil {
		return nil, fmt.Errorf("GetConversation tool_actions rows: %w", err)
	}

	return &conv, nil
}

// ListConversations returns all conversations for a session with their messages and tools.
// Uses 3 queries total regardless of conversation count (1 for conversations + 1 for all messages + 1 for all tool actions).
func (s *SQLiteStore) ListConversations(ctx context.Context, sessionID string) ([]*models.Conversation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE session_id = ?`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("ListConversations: %w", err)
	}

	convs := []*models.Conversation{}
	convMap := make(map[string]*models.Conversation)
	convIDs := []string{}

	for rows.Next() {
		var conv models.Conversation
		if err := rows.Scan(&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
			&conv.Status, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("ListConversations scan: %w", err)
		}
		// Initialize slices to empty (not nil) so JSON serializes as [] not null
		conv.Messages = []models.Message{}
		conv.ToolSummary = []models.ToolAction{}
		convs = append(convs, &conv)
		convMap[conv.ID] = &conv
		convIDs = append(convIDs, conv.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListConversations rows: %w", err)
	}

	// Early return if no conversations
	if len(convIDs) == 0 {
		return convs, nil
	}

	// Load all messages for these conversations in one query
	if err := s.loadMessagesForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	// Load all tool actions for these conversations in one query
	if err := s.loadToolActionsForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	return convs, nil
}

// ListConversationsForSessions returns conversations for multiple sessions in a single batch query.
// Returns a map of sessionID -> conversations.
// Uses 3 queries total (1 for conversations + 1 for all messages + 1 for all tool actions).
func (s *SQLiteStore) ListConversationsForSessions(ctx context.Context, sessionIDs []string) (map[string][]*models.Conversation, error) {
	result := make(map[string][]*models.Conversation)

	// Initialize result map with empty slices for all session IDs
	for _, sid := range sessionIDs {
		result[sid] = []*models.Conversation{}
	}

	if len(sessionIDs) == 0 {
		return result, nil
	}

	// Build placeholders for IN clause
	placeholders := make([]string, len(sessionIDs))
	args := make([]interface{}, len(sessionIDs))
	for i, id := range sessionIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	// Query all conversations for all sessions in one query
	query := fmt.Sprintf(`
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE session_id IN (%s)`, strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("ListConversationsForSessions: %w", err)
	}

	convMap := make(map[string]*models.Conversation)
	convIDs := []string{}

	for rows.Next() {
		var conv models.Conversation
		if err := rows.Scan(&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
			&conv.Status, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("ListConversationsForSessions scan: %w", err)
		}
		// Initialize slices to empty (not nil) so JSON serializes as [] not null
		conv.Messages = []models.Message{}
		conv.ToolSummary = []models.ToolAction{}
		convMap[conv.ID] = &conv
		convIDs = append(convIDs, conv.ID)
		result[conv.SessionID] = append(result[conv.SessionID], &conv)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListConversationsForSessions rows: %w", err)
	}

	// Early return if no conversations found
	if len(convIDs) == 0 {
		return result, nil
	}

	// Load all messages for all conversations in one query
	if err := s.loadMessagesForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	// Load all tool actions for all conversations in one query
	if err := s.loadToolActionsForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	return result, nil
}

// loadMessagesForConversations loads messages for multiple conversations in a single query
func (s *SQLiteStore) loadMessagesForConversations(ctx context.Context, convMap map[string]*models.Conversation, convIDs []string) error {
	placeholders := make([]string, len(convIDs))
	args := make([]interface{}, len(convIDs))
	for i, id := range convIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT conversation_id, id, role, content, setup_info, run_summary, timestamp
		FROM messages
		WHERE conversation_id IN (%s)
		ORDER BY conversation_id, position`, strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("loadMessagesForConversations: %w", err)
	}
	defer rows.Close()

	// Track message locations for attachment loading
	type msgLocation struct {
		convID string
		index  int
	}
	msgLocations := make(map[string]msgLocation)

	for rows.Next() {
		var convID string
		var msg models.Message
		var setupInfoJSON, runSummaryJSON sql.NullString

		if err := rows.Scan(&convID, &msg.ID, &msg.Role, &msg.Content,
			&setupInfoJSON, &runSummaryJSON, &msg.Timestamp); err != nil {
			return fmt.Errorf("loadMessagesForConversations scan: %w", err)
		}

		if setupInfoJSON.Valid {
			var setupInfo models.SetupInfo
			if json.Unmarshal([]byte(setupInfoJSON.String), &setupInfo) == nil {
				msg.SetupInfo = &setupInfo
			}
		}
		if runSummaryJSON.Valid {
			var runSummary models.RunSummary
			if json.Unmarshal([]byte(runSummaryJSON.String), &runSummary) == nil {
				msg.RunSummary = &runSummary
			}
		}

		if conv, ok := convMap[convID]; ok {
			msgLocations[msg.ID] = msgLocation{convID: convID, index: len(conv.Messages)}
			conv.Messages = append(conv.Messages, msg)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Batch load attachments for all messages
	if len(msgLocations) > 0 {
		msgIDs := make([]string, 0, len(msgLocations))
		for msgID := range msgLocations {
			msgIDs = append(msgIDs, msgID)
		}

		attPlaceholders := make([]string, len(msgIDs))
		attArgs := make([]interface{}, len(msgIDs))
		for i, id := range msgIDs {
			attPlaceholders[i] = "?"
			attArgs[i] = id
		}

		attQuery := fmt.Sprintf(`
			SELECT message_id, id, type, name, path, mime_type, size, line_count, width, height, base64_data, preview
			FROM attachments
			WHERE message_id IN (%s)`, strings.Join(attPlaceholders, ","))

		attRows, err := s.db.QueryContext(ctx, attQuery, attArgs...)
		if err != nil {
			return fmt.Errorf("loadMessagesForConversations attachments: %w", err)
		}
		defer attRows.Close()

		for attRows.Next() {
			var messageID string
			var att models.Attachment
			var path, base64Data, preview sql.NullString
			var lineCount, width, height sql.NullInt64

			if err := attRows.Scan(&messageID, &att.ID, &att.Type, &att.Name, &path, &att.MimeType,
				&att.Size, &lineCount, &width, &height, &base64Data, &preview); err != nil {
				return fmt.Errorf("loadMessagesForConversations attachment scan: %w", err)
			}

			if path.Valid {
				att.Path = path.String
			}
			if base64Data.Valid {
				att.Base64Data = base64Data.String
			}
			if preview.Valid {
				att.Preview = preview.String
			}
			if lineCount.Valid {
				att.LineCount = int(lineCount.Int64)
			}
			if width.Valid {
				att.Width = int(width.Int64)
			}
			if height.Valid {
				att.Height = int(height.Int64)
			}

			// Associate attachment with message
			if loc, ok := msgLocations[messageID]; ok {
				if conv, ok := convMap[loc.convID]; ok {
					conv.Messages[loc.index].Attachments = append(conv.Messages[loc.index].Attachments, att)
				}
			}
		}
		if err := attRows.Err(); err != nil {
			return err
		}
	}

	return nil
}

// loadToolActionsForConversations loads tool actions for multiple conversations in a single query
func (s *SQLiteStore) loadToolActionsForConversations(ctx context.Context, convMap map[string]*models.Conversation, convIDs []string) error {
	placeholders := make([]string, len(convIDs))
	args := make([]interface{}, len(convIDs))
	for i, id := range convIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT conversation_id, id, tool, target, success
		FROM tool_actions
		WHERE conversation_id IN (%s)
		ORDER BY conversation_id, position`, strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("loadToolActionsForConversations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var convID string
		var action models.ToolAction
		var success int

		if err := rows.Scan(&convID, &action.ID, &action.Tool, &action.Target, &success); err != nil {
			return fmt.Errorf("loadToolActionsForConversations scan: %w", err)
		}
		action.Success = intToBool(success)

		if conv, ok := convMap[convID]; ok {
			conv.ToolSummary = append(conv.ToolSummary, action)
		}
	}
	return rows.Err()
}

// loadAttachmentsForMessages loads attachments for a slice of messages in a single batch query.
// NOTE: This function mutates the messages slice directly by appending to the Attachments field
// of each message. The msgIndexByID map is used to locate each message by its ID.
func (s *SQLiteStore) loadAttachmentsForMessages(ctx context.Context, messages []models.Message, msgIndexByID map[string]int) error {
	if len(messages) == 0 {
		return nil
	}

	// Collect message IDs
	msgIDs := make([]string, len(messages))
	for i, msg := range messages {
		msgIDs[i] = msg.ID
	}

	placeholders := make([]string, len(msgIDs))
	args := make([]interface{}, len(msgIDs))
	for i, id := range msgIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT message_id, id, type, name, path, mime_type, size, line_count, width, height, base64_data, preview
		FROM attachments
		WHERE message_id IN (%s)`, strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("loadAttachmentsForMessages: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var messageID string
		var att models.Attachment
		var path, base64Data, preview sql.NullString
		var lineCount, width, height sql.NullInt64

		if err := rows.Scan(&messageID, &att.ID, &att.Type, &att.Name, &path, &att.MimeType,
			&att.Size, &lineCount, &width, &height, &base64Data, &preview); err != nil {
			return fmt.Errorf("loadAttachmentsForMessages scan: %w", err)
		}

		if path.Valid {
			att.Path = path.String
		}
		if base64Data.Valid {
			att.Base64Data = base64Data.String
		}
		if preview.Valid {
			att.Preview = preview.String
		}
		if lineCount.Valid {
			att.LineCount = int(lineCount.Int64)
		}
		if width.Valid {
			att.Width = int(width.Int64)
		}
		if height.Valid {
			att.Height = int(height.Int64)
		}

		// Associate attachment with message
		if idx, ok := msgIndexByID[messageID]; ok {
			messages[idx].Attachments = append(messages[idx].Attachments, att)
		}
	}
	return rows.Err()
}

func (s *SQLiteStore) UpdateConversation(ctx context.Context, id string, updates func(*models.Conversation)) error {
	// Read current state
	conv, err := s.getConversationNoLock(ctx, id)
	if err != nil {
		return err
	}
	if conv == nil {
		return nil // No error, just nothing to update
	}

	// Apply updates
	updates(conv)
	conv.UpdatedAt = time.Now()

	// Write back (only conversation table, not messages/tools)
	_, err = s.db.ExecContext(ctx, `
		UPDATE conversations SET
			type = ?, name = ?, status = ?, updated_at = ?
		WHERE id = ?`,
		conv.Type, conv.Name, conv.Status, conv.UpdatedAt, id)
	if err != nil {
		return fmt.Errorf("UpdateConversation: %w", err)
	}
	return nil
}

func (s *SQLiteStore) getConversationNoLock(ctx context.Context, id string) (*models.Conversation, error) {
	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.CreatedAt, &conv.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getConversationNoLock: %w", err)
	}

	// Initialize slices to empty (not nil) so JSON serializes as [] not null
	conv.Messages = []models.Message{}
	conv.ToolSummary = []models.ToolAction{}

	// Load messages
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, role, content, setup_info, run_summary, timestamp
		FROM messages
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("getConversationNoLock messages: %w", err)
	}
	defer rows.Close()
	msgIndexByID := make(map[string]int)
	for rows.Next() {
		var msg models.Message
		var setupInfoJSON sql.NullString
		var runSummaryJSON sql.NullString
		if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &runSummaryJSON, &msg.Timestamp); err != nil {
			return nil, fmt.Errorf("getConversationNoLock message scan: %w", err)
		}
		if setupInfoJSON.Valid {
			var setupInfo models.SetupInfo
			if json.Unmarshal([]byte(setupInfoJSON.String), &setupInfo) == nil {
				msg.SetupInfo = &setupInfo
			}
		}
		if runSummaryJSON.Valid {
			var runSummary models.RunSummary
			if json.Unmarshal([]byte(runSummaryJSON.String), &runSummary) == nil {
				msg.RunSummary = &runSummary
			}
		}
		msgIndexByID[msg.ID] = len(conv.Messages)
		conv.Messages = append(conv.Messages, msg)
	}

	// Load attachments for all messages
	if len(conv.Messages) > 0 {
		if err := s.loadAttachmentsForMessages(ctx, conv.Messages, msgIndexByID); err != nil {
			return nil, err
		}
	}

	// Load tool actions
	toolRows, err := s.db.QueryContext(ctx, `
		SELECT id, tool, target, success
		FROM tool_actions
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("getConversationNoLock tool_actions: %w", err)
	}
	defer toolRows.Close()
	for toolRows.Next() {
		var action models.ToolAction
		var success int
		if err := toolRows.Scan(&action.ID, &action.Tool, &action.Target, &success); err != nil {
			return nil, fmt.Errorf("getConversationNoLock tool_action scan: %w", err)
		}
		action.Success = intToBool(success)
		conv.ToolSummary = append(conv.ToolSummary, action)
	}

	return &conv, nil
}

func (s *SQLiteStore) DeleteConversation(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM conversations WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteConversation: %w", err)
	}
	return nil
}

func (s *SQLiteStore) AddMessageToConversation(ctx context.Context, convID string, msg models.Message) error {
	// Serialize setupInfo if present (outside retry - deterministic)
	var setupInfoJSON sql.NullString
	if msg.SetupInfo != nil {
		data, err := json.Marshal(msg.SetupInfo)
		if err != nil {
			return fmt.Errorf("AddMessageToConversation marshal setupInfo: %w", err)
		}
		setupInfoJSON = sql.NullString{String: string(data), Valid: true}
	}

	// Serialize runSummary if present (outside retry - deterministic)
	var runSummaryJSON sql.NullString
	if msg.RunSummary != nil {
		data, err := json.Marshal(msg.RunSummary)
		if err != nil {
			return fmt.Errorf("AddMessageToConversation marshal runSummary: %w", err)
		}
		runSummaryJSON = sql.NullString{String: string(data), Valid: true}
	}

	return RetryDBExec(ctx, "AddMessageToConversation", DefaultRetryConfig(), func(ctx context.Context) error {
		// Use transaction to make position query + insert atomic
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin: %w", err)
		}

		// Get next position within transaction
		var maxPos sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT MAX(position) FROM messages WHERE conversation_id = ?`, convID).Scan(&maxPos); err != nil && err != sql.ErrNoRows {
			tx.Rollback()
			return fmt.Errorf("get position: %w", err)
		}
		nextPos := 0
		if maxPos.Valid {
			nextPos = int(maxPos.Int64) + 1
		}

		_, err = tx.ExecContext(ctx, `
			INSERT INTO messages (id, conversation_id, role, content, setup_info, run_summary, timestamp, position)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			msg.ID, convID, msg.Role, msg.Content, setupInfoJSON, runSummaryJSON, msg.Timestamp, nextPos)
		if err != nil {
			tx.Rollback()
			return err
		}

		return tx.Commit()
	})
}

func (s *SQLiteStore) AddToolActionToConversation(ctx context.Context, convID string, action models.ToolAction) error {
	return RetryDBExec(ctx, "AddToolActionToConversation", DefaultRetryConfig(), func(ctx context.Context) error {
		// Use transaction to make position query + insert atomic
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin: %w", err)
		}

		// Get next position within transaction
		var maxPos sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT MAX(position) FROM tool_actions WHERE conversation_id = ?`, convID).Scan(&maxPos); err != nil && err != sql.ErrNoRows {
			tx.Rollback()
			return fmt.Errorf("get position: %w", err)
		}
		nextPos := 0
		if maxPos.Valid {
			nextPos = int(maxPos.Int64) + 1
		}

		_, err = tx.ExecContext(ctx, `
			INSERT INTO tool_actions (id, conversation_id, tool, target, success, position)
			VALUES (?, ?, ?, ?, ?, ?)`,
			action.ID, convID, action.Tool, action.Target, boolToInt(action.Success), nextPos)
		if err != nil {
			tx.Rollback()
			return err
		}

		return tx.Commit()
	})
}

// ============================================================================
// FileTab methods
// ============================================================================

func (s *SQLiteStore) ListFileTabs(ctx context.Context, workspaceID string) ([]*models.FileTab, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, session_id, path, view_mode, is_pinned, position, opened_at, last_accessed_at
		FROM file_tabs WHERE workspace_id = ?
		ORDER BY position`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("ListFileTabs: %w", err)
	}
	defer rows.Close()

	tabs := []*models.FileTab{}
	for rows.Next() {
		var tab models.FileTab
		var sessionID sql.NullString
		var isPinned int

		if err := rows.Scan(
			&tab.ID, &tab.WorkspaceID, &sessionID, &tab.Path,
			&tab.ViewMode, &isPinned, &tab.Position,
			&tab.OpenedAt, &tab.LastAccessedAt); err != nil {
			return nil, fmt.Errorf("ListFileTabs scan: %w", err)
		}

		tab.IsPinned = intToBool(isPinned)
		if sessionID.Valid {
			tab.SessionID = sessionID.String
		}

		tabs = append(tabs, &tab)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListFileTabs rows: %w", err)
	}
	return tabs, nil
}

func (s *SQLiteStore) AddFileTab(ctx context.Context, tab *models.FileTab) error {
	var sessionID sql.NullString
	if tab.SessionID != "" {
		sessionID = sql.NullString{String: tab.SessionID, Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO file_tabs (id, workspace_id, session_id, path, view_mode, is_pinned, position, opened_at, last_accessed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			view_mode = excluded.view_mode,
			is_pinned = excluded.is_pinned,
			position = excluded.position,
			last_accessed_at = excluded.last_accessed_at`,
		tab.ID, tab.WorkspaceID, sessionID, tab.Path, tab.ViewMode,
		boolToInt(tab.IsPinned), tab.Position, tab.OpenedAt, tab.LastAccessedAt)
	if err != nil {
		return fmt.Errorf("AddFileTab: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateFileTab(ctx context.Context, id string, updates func(*models.FileTab)) error {
	// Read current state
	tab, err := s.GetFileTab(ctx, id)
	if err != nil {
		return err
	}
	if tab == nil {
		return nil // No error, just nothing to update
	}

	// Apply updates
	updates(tab)
	tab.LastAccessedAt = time.Now()

	_, err = s.db.ExecContext(ctx, `
		UPDATE file_tabs SET
			view_mode = ?, is_pinned = ?, position = ?, last_accessed_at = ?
		WHERE id = ?`,
		tab.ViewMode, boolToInt(tab.IsPinned), tab.Position, tab.LastAccessedAt, id)
	if err != nil {
		return fmt.Errorf("UpdateFileTab: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetFileTab(ctx context.Context, id string) (*models.FileTab, error) {
	var tab models.FileTab
	var sessionID sql.NullString
	var isPinned int

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, session_id, path, view_mode, is_pinned, position, opened_at, last_accessed_at
		FROM file_tabs WHERE id = ?`, id).Scan(
		&tab.ID, &tab.WorkspaceID, &sessionID, &tab.Path,
		&tab.ViewMode, &isPinned, &tab.Position,
		&tab.OpenedAt, &tab.LastAccessedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetFileTab: %w", err)
	}

	tab.IsPinned = intToBool(isPinned)
	if sessionID.Valid {
		tab.SessionID = sessionID.String
	}

	return &tab, nil
}

func (s *SQLiteStore) DeleteFileTab(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM file_tabs WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteFileTab: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteAllFileTabsForWorkspace(ctx context.Context, workspaceID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM file_tabs WHERE workspace_id = ?`, workspaceID)
	if err != nil {
		return fmt.Errorf("DeleteAllFileTabsForWorkspace: %w", err)
	}
	return nil
}

// SaveFileTabs atomically saves a workspace's file tabs, removing any tabs not in the list.
// Uses a transaction for atomic updates to prevent partial saves on failure.
func (s *SQLiteStore) SaveFileTabs(ctx context.Context, workspaceID string, tabs []*models.FileTab) error {
	return RetryDBExec(ctx, "SaveFileTabs", DefaultRetryConfig(), func(ctx context.Context) error {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin: %w", err)
		}

		// Collect current tab IDs for deletion of removed tabs
		currentTabIDs := make([]string, len(tabs))
		for i, tab := range tabs {
			currentTabIDs[i] = tab.ID
		}

		// Delete tabs that are no longer in the list (more efficient than delete-all)
		if len(currentTabIDs) > 0 {
			// Build placeholders for IN clause dynamically.
			// This is safe because we only generate "?" placeholders (not user input),
			// and actual values are passed via parameterized args.
			placeholders := "?"
			for i := 1; i < len(currentTabIDs); i++ {
				placeholders += ",?"
			}
			args := make([]interface{}, len(currentTabIDs)+1)
			args[0] = workspaceID
			for i, id := range currentTabIDs {
				args[i+1] = id
			}
			_, err = tx.ExecContext(ctx, `DELETE FROM file_tabs WHERE workspace_id = ? AND id NOT IN (`+placeholders+`)`, args...)
		} else {
			// No tabs - delete all for this workspace
			_, err = tx.ExecContext(ctx, `DELETE FROM file_tabs WHERE workspace_id = ?`, workspaceID)
		}
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("delete: %w", err)
		}

		// Upsert all tabs (insert or update if exists)
		stmt, err := tx.PrepareContext(ctx, `
			INSERT INTO file_tabs (id, workspace_id, session_id, path, view_mode, is_pinned, position, opened_at, last_accessed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				view_mode = excluded.view_mode,
				is_pinned = excluded.is_pinned,
				position = excluded.position,
				last_accessed_at = excluded.last_accessed_at`)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("prepare: %w", err)
		}
		defer stmt.Close()

		for i, tab := range tabs {
			var sessionID sql.NullString
			if tab.SessionID != "" {
				sessionID = sql.NullString{String: tab.SessionID, Valid: true}
			}

			_, err = stmt.ExecContext(ctx,
				tab.ID, tab.WorkspaceID, sessionID, tab.Path, tab.ViewMode,
				boolToInt(tab.IsPinned), i, tab.OpenedAt, tab.LastAccessedAt)
			if err != nil {
				tx.Rollback()
				return fmt.Errorf("upsert: %w", err)
			}
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit: %w", err)
		}
		return nil
	})
}

// ============================================================================
// ReviewComment methods
// ============================================================================

func (s *SQLiteStore) AddReviewComment(ctx context.Context, comment *models.ReviewComment) error {
	var severity sql.NullString
	if comment.Severity != "" {
		severity = sql.NullString{String: comment.Severity, Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO review_comments (id, session_id, file_path, line_number, content, source, author, severity, created_at, resolved)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		comment.ID, comment.SessionID, comment.FilePath, comment.LineNumber,
		comment.Content, comment.Source, comment.Author, severity,
		comment.CreatedAt, boolToInt(comment.Resolved))
	if err != nil {
		return fmt.Errorf("AddReviewComment: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetReviewComment(ctx context.Context, id string) (*models.ReviewComment, error) {
	var comment models.ReviewComment
	var severity sql.NullString
	var resolved int
	var resolvedAt sql.NullTime
	var resolvedBy sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, file_path, line_number, content, source, author, severity, created_at, resolved, resolved_at, resolved_by
		FROM review_comments WHERE id = ?`, id).Scan(
		&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
		&comment.Content, &comment.Source, &comment.Author, &severity,
		&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetReviewComment: %w", err)
	}

	comment.Resolved = intToBool(resolved)
	if severity.Valid {
		comment.Severity = severity.String
	}
	if resolvedAt.Valid {
		comment.ResolvedAt = &resolvedAt.Time
	}
	if resolvedBy.Valid {
		comment.ResolvedBy = resolvedBy.String
	}

	return &comment, nil
}

func (s *SQLiteStore) ListReviewComments(ctx context.Context, sessionID string) ([]*models.ReviewComment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, file_path, line_number, content, source, author, severity, created_at, resolved, resolved_at, resolved_by
		FROM review_comments WHERE session_id = ?
		ORDER BY file_path, line_number`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("ListReviewComments: %w", err)
	}
	defer rows.Close()

	comments := []*models.ReviewComment{}
	for rows.Next() {
		var comment models.ReviewComment
		var severity sql.NullString
		var resolved int
		var resolvedAt sql.NullTime
		var resolvedBy sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
			&comment.Content, &comment.Source, &comment.Author, &severity,
			&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy); err != nil {
			return nil, fmt.Errorf("ListReviewComments scan: %w", err)
		}

		comment.Resolved = intToBool(resolved)
		if severity.Valid {
			comment.Severity = severity.String
		}
		if resolvedAt.Valid {
			comment.ResolvedAt = &resolvedAt.Time
		}
		if resolvedBy.Valid {
			comment.ResolvedBy = resolvedBy.String
		}

		comments = append(comments, &comment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListReviewComments rows: %w", err)
	}
	return comments, nil
}

func (s *SQLiteStore) ListReviewCommentsForFile(ctx context.Context, sessionID, filePath string) ([]*models.ReviewComment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, file_path, line_number, content, source, author, severity, created_at, resolved, resolved_at, resolved_by
		FROM review_comments WHERE session_id = ? AND file_path = ?
		ORDER BY line_number`, sessionID, filePath)
	if err != nil {
		return nil, fmt.Errorf("ListReviewCommentsForFile: %w", err)
	}
	defer rows.Close()

	comments := []*models.ReviewComment{}
	for rows.Next() {
		var comment models.ReviewComment
		var severity sql.NullString
		var resolved int
		var resolvedAt sql.NullTime
		var resolvedBy sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
			&comment.Content, &comment.Source, &comment.Author, &severity,
			&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy); err != nil {
			return nil, fmt.Errorf("ListReviewCommentsForFile scan: %w", err)
		}

		comment.Resolved = intToBool(resolved)
		if severity.Valid {
			comment.Severity = severity.String
		}
		if resolvedAt.Valid {
			comment.ResolvedAt = &resolvedAt.Time
		}
		if resolvedBy.Valid {
			comment.ResolvedBy = resolvedBy.String
		}

		comments = append(comments, &comment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListReviewCommentsForFile rows: %w", err)
	}
	return comments, nil
}

// GetReviewCommentStats returns per-file comment statistics for a session
func (s *SQLiteStore) GetReviewCommentStats(ctx context.Context, sessionID string) ([]*models.CommentStats, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT file_path, COUNT(*) as total, SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) as unresolved
		FROM review_comments WHERE session_id = ?
		GROUP BY file_path
		ORDER BY file_path`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("GetReviewCommentStats: %w", err)
	}
	defer rows.Close()

	stats := []*models.CommentStats{}
	for rows.Next() {
		var stat models.CommentStats
		if err := rows.Scan(&stat.FilePath, &stat.Total, &stat.Unresolved); err != nil {
			return nil, fmt.Errorf("GetReviewCommentStats scan: %w", err)
		}
		stats = append(stats, &stat)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetReviewCommentStats rows: %w", err)
	}
	return stats, nil
}

func (s *SQLiteStore) UpdateReviewComment(ctx context.Context, id string, updates func(*models.ReviewComment)) error {
	// Read current state
	comment, err := s.GetReviewComment(ctx, id)
	if err != nil {
		return err
	}
	if comment == nil {
		return fmt.Errorf("UpdateReviewComment: comment %s %w", id, ErrNotFound)
	}

	// Apply updates
	updates(comment)

	// Write back
	var severity sql.NullString
	if comment.Severity != "" {
		severity = sql.NullString{String: comment.Severity, Valid: true}
	}
	var resolvedAt sql.NullTime
	if comment.ResolvedAt != nil {
		resolvedAt = sql.NullTime{Time: *comment.ResolvedAt, Valid: true}
	}
	var resolvedBy sql.NullString
	if comment.ResolvedBy != "" {
		resolvedBy = sql.NullString{String: comment.ResolvedBy, Valid: true}
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE review_comments SET
			content = ?, severity = ?, resolved = ?, resolved_at = ?, resolved_by = ?
		WHERE id = ?`,
		comment.Content, severity, boolToInt(comment.Resolved), resolvedAt, resolvedBy, id)
	if err != nil {
		return fmt.Errorf("UpdateReviewComment: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteReviewComment(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM review_comments WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteReviewComment: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteReviewCommentsForSession(ctx context.Context, sessionID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM review_comments WHERE session_id = ?`, sessionID)
	if err != nil {
		return fmt.Errorf("DeleteReviewCommentsForSession: %w", err)
	}
	return nil
}

// ============================================================================
// Attachment methods
// ============================================================================

// SaveAttachments saves attachments for a message
func (s *SQLiteStore) SaveAttachments(ctx context.Context, messageID string, attachments []models.Attachment) error {
	if len(attachments) == 0 {
		return nil
	}

	return RetryDBExec(ctx, "SaveAttachments", DefaultRetryConfig(), func(ctx context.Context) error {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin: %w", err)
		}

		stmt, err := tx.PrepareContext(ctx, `
			INSERT INTO attachments (id, message_id, type, name, path, mime_type, size, line_count, width, height, base64_data, preview)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("prepare: %w", err)
		}
		defer stmt.Close()

		for _, att := range attachments {
			var lineCount, width, height sql.NullInt64
			if att.LineCount > 0 {
				lineCount = sql.NullInt64{Int64: int64(att.LineCount), Valid: true}
			}
			if att.Width > 0 {
				width = sql.NullInt64{Int64: int64(att.Width), Valid: true}
			}
			if att.Height > 0 {
				height = sql.NullInt64{Int64: int64(att.Height), Valid: true}
			}

			var path, base64Data, preview sql.NullString
			if att.Path != "" {
				path = sql.NullString{String: att.Path, Valid: true}
			}
			if att.Base64Data != "" {
				base64Data = sql.NullString{String: att.Base64Data, Valid: true}
			}
			if att.Preview != "" {
				preview = sql.NullString{String: att.Preview, Valid: true}
			}

			_, err = stmt.ExecContext(ctx,
				att.ID, messageID, att.Type, att.Name, path, att.MimeType,
				att.Size, lineCount, width, height, base64Data, preview)
			if err != nil {
				tx.Rollback()
				return fmt.Errorf("insert: %w", err)
			}
		}

		return tx.Commit()
	})
}

// GetAttachmentsByMessageID retrieves all attachments for a message
func (s *SQLiteStore) GetAttachmentsByMessageID(ctx context.Context, messageID string) ([]models.Attachment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, type, name, path, mime_type, size, line_count, width, height, base64_data, preview
		FROM attachments WHERE message_id = ?`, messageID)
	if err != nil {
		return nil, fmt.Errorf("GetAttachmentsByMessageID: %w", err)
	}
	defer rows.Close()

	attachments := []models.Attachment{}
	for rows.Next() {
		var att models.Attachment
		var path, base64Data, preview sql.NullString
		var lineCount, width, height sql.NullInt64

		if err := rows.Scan(&att.ID, &att.Type, &att.Name, &path, &att.MimeType,
			&att.Size, &lineCount, &width, &height, &base64Data, &preview); err != nil {
			return nil, fmt.Errorf("GetAttachmentsByMessageID scan: %w", err)
		}

		if path.Valid {
			att.Path = path.String
		}
		if base64Data.Valid {
			att.Base64Data = base64Data.String
		}
		if preview.Valid {
			att.Preview = preview.String
		}
		if lineCount.Valid {
			att.LineCount = int(lineCount.Int64)
		}
		if width.Valid {
			att.Width = int(width.Int64)
		}
		if height.Valid {
			att.Height = int(height.Int64)
		}

		attachments = append(attachments, att)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetAttachmentsByMessageID rows: %w", err)
	}
	return attachments, nil
}
