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

// ErrAttachmentNotFound is returned when a requested attachment does not exist
var ErrAttachmentNotFound = errors.New("attachment not found")

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
	CREATE INDEX IF NOT EXISTS idx_messages_conversation_position ON messages(conversation_id, position);

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
	CREATE INDEX IF NOT EXISTS idx_tool_actions_conversation_position ON tool_actions(conversation_id, position);

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

	// Migration: Add priority column to sessions if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'priority'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added priority column to sessions")
	}

	// Migration: Add task_status column to sessions if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'task_status'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN task_status TEXT NOT NULL DEFAULT 'backlog'`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added task_status column to sessions")
	}

	// Migration: Add archive_summary and archive_summary_status columns to sessions
	err = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'archive_summary'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN archive_summary TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN archive_summary_status TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added archive_summary columns to sessions")
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

	// Migration: Add title column to review_comments if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('review_comments') WHERE name = 'title'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE review_comments ADD COLUMN title TEXT`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added title column to review_comments")
	}

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

	// Migration: Create settings table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: settings table ready")

	// Migration: Add composite index on sessions(workspace_id, name) for fast name lookups
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace_name ON sessions(workspace_id, name)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: sessions workspace_name index ready")

	// Migration: Create summaries table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS summaries (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'generating',
			error_message TEXT,
			message_count INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
			FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON summaries(conversation_id)`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: summaries table ready")

	// Migration: Add target_branch column to sessions if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'target_branch'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE sessions ADD COLUMN target_branch TEXT DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added target_branch column to sessions")
	}

	// Migration: Add model column to conversations if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name = 'model'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added model column to conversations")
	}

	// Migration: Add streaming_snapshot column to conversations if it doesn't exist
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name = 'streaming_snapshot'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE conversations ADD COLUMN streaming_snapshot TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added streaming_snapshot column to conversations")
	}

	// Migration: Add agent_session_id column to conversations (for SDK session resume)
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name = 'agent_session_id'
	`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE conversations ADD COLUMN agent_session_id TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added agent_session_id column to conversations")
	}

	// Migration: Convert 'todo' task_status to 'backlog' (todo status was removed)
	err = s.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE task_status = 'todo'`).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		_, err = s.db.Exec(`UPDATE sessions SET task_status = 'backlog' WHERE task_status = 'todo'`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Converted %d sessions from 'todo' to 'backlog' task_status", count)
	}

	// Migration: Add remote, branch_prefix, custom_prefix columns to repos
	err = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('repos') WHERE name = 'remote'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE repos ADD COLUMN remote TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		_, err = s.db.Exec(`ALTER TABLE repos ADD COLUMN branch_prefix TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		_, err = s.db.Exec(`ALTER TABLE repos ADD COLUMN custom_prefix TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added remote, branch_prefix, custom_prefix columns to repos")
	}

	// Migration: Create user_skill_preferences table if it doesn't exist
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS user_skill_preferences (
			id TEXT PRIMARY KEY,
			skill_id TEXT NOT NULL UNIQUE,
			installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_user_skill_preferences_skill_id ON user_skill_preferences(skill_id)`)
	if err != nil {
		return err
	}
	logger.SQLite.Infof("Migration: user_skill_preferences table ready")

	// Migration: Add tool_usage column to messages (JSON blob for per-message tool usage)
	err = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'tool_usage'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE messages ADD COLUMN tool_usage TEXT DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added tool_usage column to messages")
	}

	// Migration: Add thinking_content column to messages
	err = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'thinking_content'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE messages ADD COLUMN thinking_content TEXT DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added thinking_content column to messages")
	}

	// Migration: Add duration_ms column to messages
	err = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'duration_ms'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE messages ADD COLUMN duration_ms INTEGER DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added duration_ms column to messages")
	}

	// Migration: Add timeline column to messages (JSON blob for interleaved text/tool ordering)
	err = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'timeline'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = s.db.Exec(`ALTER TABLE messages ADD COLUMN timeline TEXT DEFAULT NULL`)
		if err != nil {
			return err
		}
		logger.SQLite.Infof("Migration: Added timeline column to messages")
	}

	return nil
}

// Helper functions

// nullString converts a string to sql.NullString for nullable TEXT columns.
// Empty string maps to NULL.
func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

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
		INSERT INTO repos (id, name, path, branch, remote, branch_prefix, custom_prefix, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, branch=excluded.branch,
			remote=excluded.remote, branch_prefix=excluded.branch_prefix, custom_prefix=excluded.custom_prefix`,
		repo.ID, repo.Name, repo.Path, repo.Branch, repo.Remote, repo.BranchPrefix, repo.CustomPrefix, repo.CreatedAt)
	if err != nil {
		return fmt.Errorf("AddRepo: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetRepo(ctx context.Context, id string) (*models.Repo, error) {
	var repo models.Repo
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, path, branch, remote, branch_prefix, custom_prefix, created_at
		FROM repos WHERE id = ?`, id).Scan(
		&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.Remote, &repo.BranchPrefix, &repo.CustomPrefix, &repo.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetRepo: %w", err)
	}
	return &repo, nil
}

func (s *SQLiteStore) ListRepos(ctx context.Context) ([]*models.Repo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, path, branch, remote, branch_prefix, custom_prefix, created_at FROM repos`)
	if err != nil {
		return nil, fmt.Errorf("ListRepos: %w", err)
	}
	defer rows.Close()

	repos := []*models.Repo{}
	for rows.Next() {
		var repo models.Repo
		if err := rows.Scan(&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.Remote, &repo.BranchPrefix, &repo.CustomPrefix, &repo.CreatedAt); err != nil {
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
		SELECT id, name, path, branch, remote, branch_prefix, custom_prefix, created_at
		FROM repos WHERE path = ?`, path).Scan(
		&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.Remote, &repo.BranchPrefix, &repo.CustomPrefix, &repo.CreatedAt)
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

func (s *SQLiteStore) UpdateRepo(ctx context.Context, repo *models.Repo) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE repos SET branch = ?, remote = ?, branch_prefix = ?, custom_prefix = ?
		WHERE id = ?`,
		repo.Branch, repo.Remote, repo.BranchPrefix, repo.CustomPrefix, repo.ID)
	if err != nil {
		return fmt.Errorf("UpdateRepo: %w", err)
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
			INSERT INTO sessions (id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
				task, status, agent_id, pr_status, pr_url, pr_number, has_merge_conflict,
				has_check_failures, stats_additions, stats_deletions, pinned, archived,
				priority, task_status, archive_summary, archive_summary_status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			session.ID, session.WorkspaceID, session.Name, session.Branch,
			session.WorktreePath, session.BaseCommitSHA, nullString(session.TargetBranch),
			session.Task, session.Status, session.AgentID,
			session.PRStatus, session.PRUrl, session.PRNumber,
			boolToInt(session.HasMergeConflict), boolToInt(session.HasCheckFailures),
			statsAdditions, statsDeletions, boolToInt(session.Pinned), boolToInt(session.Archived),
			session.Priority, session.TaskStatus,
			session.ArchiveSummary, session.ArchiveSummaryStatus,
			session.CreatedAt, session.UpdatedAt)
		return err
	})
}

func (s *SQLiteStore) GetSession(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
	var agentID, targetBranch sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
			task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, archived, priority, task_status,
			archive_summary, archive_summary_status, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
		&session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.Priority, &session.TaskStatus,
		&session.ArchiveSummary, &session.ArchiveSummaryStatus,
		&session.CreatedAt, &session.UpdatedAt)
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
	if targetBranch.Valid {
		session.TargetBranch = targetBranch.String
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
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
	var agentID, targetBranch sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.workspace_id, s.name, s.branch, s.worktree_path, s.base_commit_sha,
			s.target_branch, s.task, s.status, s.agent_id, s.pr_status, s.pr_url, s.pr_number,
			s.has_merge_conflict, s.has_check_failures, s.stats_additions, s.stats_deletions,
			s.pinned, s.archived, s.priority, s.task_status, s.archive_summary, s.archive_summary_status, s.created_at, s.updated_at,
			r.path, r.branch, r.remote
		FROM sessions s
		JOIN repos r ON s.workspace_id = r.id
		WHERE s.id = ?`, id).Scan(
		&result.ID, &result.WorkspaceID, &result.Name, &result.Branch,
		&result.WorktreePath, &result.BaseCommitSHA, &targetBranch,
		&result.Task, &result.Status, &agentID,
		&result.PRStatus, &result.PRUrl, &result.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &archived, &result.Priority, &result.TaskStatus, &result.ArchiveSummary, &result.ArchiveSummaryStatus, &result.CreatedAt, &result.UpdatedAt,
		&result.WorkspacePath, &result.WorkspaceBranch, &result.WorkspaceRemote)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSessionWithWorkspace: %w", err)
	}

	result.HasMergeConflict = intToBool(hasMergeConflict)
	result.HasCheckFailures = intToBool(hasCheckFailures)
	result.Pinned = intToBool(pinned)
	result.Archived = intToBool(archived)
	if agentID.Valid {
		result.AgentID = agentID.String
	}
	if targetBranch.Valid {
		result.TargetBranch = targetBranch.String
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
	query := `SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
		task, status, agent_id,
		pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
		stats_additions, stats_deletions, pinned, archived, priority, task_status,
		archive_summary, archive_summary_status, created_at, updated_at
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
		var agentID, targetBranch sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
			&session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber,
			&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
			&pinned, &archived, &session.Priority, &session.TaskStatus,
			&session.ArchiveSummary, &session.ArchiveSummaryStatus,
			&session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
		session.Archived = intToBool(archived)
		if agentID.Valid {
			session.AgentID = agentID.String
		}
		if targetBranch.Valid {
			session.TargetBranch = targetBranch.String
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
	query := `SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
		task, status, agent_id,
		pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
		stats_additions, stats_deletions, pinned, archived, priority, task_status,
		archive_summary, archive_summary_status, created_at, updated_at
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
		var agentID, targetBranch sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
			&session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber,
			&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
			&pinned, &archived, &session.Priority, &session.TaskStatus,
			&session.ArchiveSummary, &session.ArchiveSummaryStatus,
			&session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListAllSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
		session.Archived = intToBool(archived)
		if agentID.Valid {
			session.AgentID = agentID.String
		}
		if targetBranch.Valid {
			session.TargetBranch = targetBranch.String
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

// ArchivedSessionDir holds the minimal info needed to register an archived session with the file watcher.
type ArchivedSessionDir struct {
	ID           string
	WorktreePath string
}

// ListArchivedSessionDirs returns id and worktree_path for archived sessions.
// This is a lightweight query used to register archived worktrees with the file watcher.
func (s *SQLiteStore) ListArchivedSessionDirs(ctx context.Context) ([]ArchivedSessionDir, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, worktree_path FROM sessions WHERE archived = 1`)
	if err != nil {
		return nil, fmt.Errorf("ListArchivedSessionDirs: %w", err)
	}
	defer rows.Close()

	var dirs []ArchivedSessionDir
	for rows.Next() {
		var d ArchivedSessionDir
		if err := rows.Scan(&d.ID, &d.WorktreePath); err != nil {
			return nil, fmt.Errorf("ListArchivedSessionDirs scan: %w", err)
		}
		dirs = append(dirs, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListArchivedSessionDirs rows: %w", err)
	}
	return dirs, nil
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
				name = ?, branch = ?, worktree_path = ?, base_commit_sha = ?, target_branch = ?,
				task = ?, status = ?, agent_id = ?, pr_status = ?, pr_url = ?,
				pr_number = ?, has_merge_conflict = ?, has_check_failures = ?,
				stats_additions = ?, stats_deletions = ?, pinned = ?, archived = ?,
				priority = ?, task_status = ?, archive_summary = ?, archive_summary_status = ?, updated_at = ?
			WHERE id = ?`,
			session.Name, session.Branch, session.WorktreePath, session.BaseCommitSHA,
			nullString(session.TargetBranch),
			session.Task, session.Status, session.AgentID, session.PRStatus, session.PRUrl,
			session.PRNumber, boolToInt(session.HasMergeConflict),
			boolToInt(session.HasCheckFailures),
			statsAdditions, statsDeletions, boolToInt(session.Pinned), boolToInt(session.Archived),
			session.Priority, session.TaskStatus,
			session.ArchiveSummary, session.ArchiveSummaryStatus,
			session.UpdatedAt, id)
		return err
	})
}

func (s *SQLiteStore) getSessionNoLock(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived int
	var agentID, targetBranch sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
			task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, archived, priority, task_status,
			archive_summary, archive_summary_status, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
		&session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.Priority, &session.TaskStatus,
		&session.ArchiveSummary, &session.ArchiveSummaryStatus,
		&session.CreatedAt, &session.UpdatedAt)
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
	if targetBranch.Valid {
		session.TargetBranch = targetBranch.String
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
	return RetryDBExec(ctx, "DeleteSession", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
		return err
	})
}

// SessionExistsByName checks whether a session with the given name exists
// for a workspace. Uses the idx_sessions_workspace_name composite index.
func (s *SQLiteStore) SessionExistsByName(ctx context.Context, workspaceID, name string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM sessions WHERE workspace_id = ? AND name = ?)`,
		workspaceID, name).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("SessionExistsByName: %w", err)
	}
	return exists, nil
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
			INSERT INTO conversations (id, session_id, type, name, status, model, agent_session_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			conv.ID, conv.SessionID, conv.Type, conv.Name,
			conv.Status, conv.Model, conv.AgentSessionID, conv.CreatedAt, conv.UpdatedAt)
		return err
	})
}

// GetConversationMeta returns only the conversation row (no messages, tools, or attachments).
// Use this when you only need to check existence or read status.
func (s *SQLiteStore) GetConversationMeta(ctx context.Context, id string) (*models.Conversation, error) {
	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, type, name, status, model, agent_session_id, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.Model, &conv.AgentSessionID, &conv.CreatedAt, &conv.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetConversationMeta: %w", err)
	}
	return &conv, nil
}

func (s *SQLiteStore) GetConversation(ctx context.Context, id string) (*models.Conversation, error) {
	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, type, name, status, model, agent_session_id, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.Model, &conv.AgentSessionID, &conv.CreatedAt, &conv.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetConversation: %w", err)
	}

	// Initialize slices to empty (not nil) so JSON serializes as [] not null
	conv.Messages = []models.Message{}
	conv.ToolSummary = []models.ToolAction{}

	// Load message count instead of full messages (use GetConversationMessages endpoint for paginated messages)
	count, err := s.GetConversationMessageCount(ctx, id)
	if err != nil {
		return nil, err
	}
	conv.MessageCount = count

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
		SELECT id, session_id, type, name, status, model, agent_session_id, created_at, updated_at
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
			&conv.Status, &conv.Model, &conv.AgentSessionID, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
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

	// Load message counts instead of full messages
	if err := s.loadMessageCountsForConversations(ctx, convMap, convIDs); err != nil {
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
		SELECT id, session_id, type, name, status, model, agent_session_id, created_at, updated_at
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
			&conv.Status, &conv.Model, &conv.AgentSessionID, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
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

	// Load message counts instead of full messages
	if err := s.loadMessageCountsForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	// Load all tool actions for all conversations in one query
	if err := s.loadToolActionsForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	return result, nil
}

// loadMessageCountsForConversations loads message counts for multiple conversations in a single query.
func (s *SQLiteStore) loadMessageCountsForConversations(ctx context.Context, convMap map[string]*models.Conversation, convIDs []string) error {
	if len(convIDs) == 0 {
		return nil
	}

	placeholders := make([]string, len(convIDs))
	args := make([]interface{}, len(convIDs))
	for i, id := range convIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT conversation_id, COUNT(*) as cnt
		FROM messages
		WHERE conversation_id IN (%s)
		GROUP BY conversation_id`, strings.Join(placeholders, ","))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("loadMessageCountsForConversations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var convID string
		var count int
		if err := rows.Scan(&convID, &count); err != nil {
			return fmt.Errorf("loadMessageCountsForConversations scan: %w", err)
		}
		if conv, ok := convMap[convID]; ok {
			conv.MessageCount = count
		}
	}
	return rows.Err()
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
		SELECT conversation_id, id, role, content, setup_info, run_summary,
			tool_usage, thinking_content, duration_ms, timeline,
			timestamp
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
		var toolUsageJSON, thinkingContentNull, timelineJSON sql.NullString
		var durationMsNull sql.NullInt64

		if err := rows.Scan(&convID, &msg.ID, &msg.Role, &msg.Content,
			&setupInfoJSON, &runSummaryJSON,
			&toolUsageJSON, &thinkingContentNull, &durationMsNull, &timelineJSON,
			&msg.Timestamp); err != nil {
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
		if toolUsageJSON.Valid {
			var toolUsage []models.ToolUsageRecord
			if json.Unmarshal([]byte(toolUsageJSON.String), &toolUsage) == nil {
				msg.ToolUsage = toolUsage
			}
		}
		if thinkingContentNull.Valid {
			msg.ThinkingContent = thinkingContentNull.String
		}
		if durationMsNull.Valid {
			msg.DurationMs = int(durationMsNull.Int64)
		}
		if timelineJSON.Valid {
			var timeline []models.TimelineEntry
			if json.Unmarshal([]byte(timelineJSON.String), &timeline) == nil {
				msg.Timeline = timeline
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
			SELECT message_id, id, type, name, path, mime_type, size, line_count, width, height, preview
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
			var path, preview sql.NullString
			var lineCount, width, height sql.NullInt64

			if err := attRows.Scan(&messageID, &att.ID, &att.Type, &att.Name, &path, &att.MimeType,
				&att.Size, &lineCount, &width, &height, &preview); err != nil {
				return fmt.Errorf("loadMessagesForConversations attachment scan: %w", err)
			}

			if path.Valid {
				att.Path = path.String
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
		SELECT message_id, id, type, name, path, mime_type, size, line_count, width, height, preview
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
		var path, preview sql.NullString
		var lineCount, width, height sql.NullInt64

		if err := rows.Scan(&messageID, &att.ID, &att.Type, &att.Name, &path, &att.MimeType,
			&att.Size, &lineCount, &width, &height, &preview); err != nil {
			return fmt.Errorf("loadAttachmentsForMessages scan: %w", err)
		}

		if path.Valid {
			att.Path = path.String
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

// GetConversationMessages returns a paginated page of messages for a conversation.
// Uses cursor-based pagination on the position column.
// If beforePosition is nil, returns the most recent messages.
// Messages are returned in ascending position order.
func (s *SQLiteStore) GetConversationMessages(ctx context.Context, convID string, beforePosition *int, limit int) (*models.MessagePage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	// Get total count
	var totalCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE conversation_id = ?`, convID).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("GetConversationMessages count: %w", err)
	}

	// Fetch limit+1 rows to determine hasMore
	fetchLimit := limit + 1
	var rows *sql.Rows
	var err error
	if beforePosition != nil {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, role, content, setup_info, run_summary,
				tool_usage, thinking_content, duration_ms, timeline,
				timestamp, position
			FROM messages
			WHERE conversation_id = ? AND position < ?
			ORDER BY position DESC
			LIMIT ?`, convID, *beforePosition, fetchLimit)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, role, content, setup_info, run_summary,
				tool_usage, thinking_content, duration_ms, timeline,
				timestamp, position
			FROM messages
			WHERE conversation_id = ?
			ORDER BY position DESC
			LIMIT ?`, convID, fetchLimit)
	}
	if err != nil {
		return nil, fmt.Errorf("GetConversationMessages query: %w", err)
	}
	defer rows.Close()

	type messageWithPos struct {
		msg      models.Message
		position int
	}

	var items []messageWithPos
	for rows.Next() {
		var msg models.Message
		var setupInfoJSON, runSummaryJSON sql.NullString
		var toolUsageJSON, thinkingContentNull, timelineJSON sql.NullString
		var durationMsNull sql.NullInt64
		var position int
		if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &runSummaryJSON,
			&toolUsageJSON, &thinkingContentNull, &durationMsNull, &timelineJSON,
			&msg.Timestamp, &position); err != nil {
			return nil, fmt.Errorf("GetConversationMessages scan: %w", err)
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
		if toolUsageJSON.Valid {
			var toolUsage []models.ToolUsageRecord
			if json.Unmarshal([]byte(toolUsageJSON.String), &toolUsage) == nil {
				msg.ToolUsage = toolUsage
			}
		}
		if thinkingContentNull.Valid {
			msg.ThinkingContent = thinkingContentNull.String
		}
		if durationMsNull.Valid {
			msg.DurationMs = int(durationMsNull.Int64)
		}
		if timelineJSON.Valid {
			var timeline []models.TimelineEntry
			if json.Unmarshal([]byte(timelineJSON.String), &timeline) == nil {
				msg.Timeline = timeline
			}
		}
		items = append(items, messageWithPos{msg: msg, position: position})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetConversationMessages rows: %w", err)
	}

	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}

	// Reverse to ascending order
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}

	messages := make([]models.Message, len(items))
	msgIndexByID := make(map[string]int, len(items))
	oldestPosition := 0
	for i, item := range items {
		messages[i] = item.msg
		msgIndexByID[item.msg.ID] = i
		if i == 0 {
			oldestPosition = item.position
		}
	}

	// Load attachments
	if len(messages) > 0 {
		if err := s.loadAttachmentsForMessages(ctx, messages, msgIndexByID); err != nil {
			return nil, err
		}
	}

	return &models.MessagePage{
		Messages:       messages,
		HasMore:        hasMore,
		TotalCount:     totalCount,
		OldestPosition: oldestPosition,
	}, nil
}

// GetConversationMessageCount returns the number of messages in a conversation.
func (s *SQLiteStore) GetConversationMessageCount(ctx context.Context, convID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE conversation_id = ?`, convID).Scan(&count); err != nil {
		return 0, fmt.Errorf("GetConversationMessageCount: %w", err)
	}
	return count, nil
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
			type = ?, name = ?, status = ?, model = ?, agent_session_id = ?, updated_at = ?
		WHERE id = ?`,
		conv.Type, conv.Name, conv.Status, conv.Model, conv.AgentSessionID, conv.UpdatedAt, id)
	if err != nil {
		return fmt.Errorf("UpdateConversation: %w", err)
	}
	return nil
}

func (s *SQLiteStore) getConversationNoLock(ctx context.Context, id string) (*models.Conversation, error) {
	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, type, name, status, model, agent_session_id, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.Model, &conv.AgentSessionID, &conv.CreatedAt, &conv.UpdatedAt)
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
		SELECT id, role, content, setup_info, run_summary,
			tool_usage, thinking_content, duration_ms, timeline,
			timestamp
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
		var setupInfoJSON, runSummaryJSON sql.NullString
		var toolUsageJSON, thinkingContentNull, timelineJSON sql.NullString
		var durationMsNull sql.NullInt64
		if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &runSummaryJSON,
			&toolUsageJSON, &thinkingContentNull, &durationMsNull, &timelineJSON,
			&msg.Timestamp); err != nil {
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
		if toolUsageJSON.Valid {
			var toolUsage []models.ToolUsageRecord
			if json.Unmarshal([]byte(toolUsageJSON.String), &toolUsage) == nil {
				msg.ToolUsage = toolUsage
			}
		}
		if thinkingContentNull.Valid {
			msg.ThinkingContent = thinkingContentNull.String
		}
		if durationMsNull.Valid {
			msg.DurationMs = int(durationMsNull.Int64)
		}
		if timelineJSON.Valid {
			var timeline []models.TimelineEntry
			if json.Unmarshal([]byte(timelineJSON.String), &timeline) == nil {
				msg.Timeline = timeline
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

	// Serialize toolUsage if present
	var toolUsageJSON sql.NullString
	if len(msg.ToolUsage) > 0 {
		data, err := json.Marshal(msg.ToolUsage)
		if err != nil {
			return fmt.Errorf("AddMessageToConversation marshal toolUsage: %w", err)
		}
		toolUsageJSON = sql.NullString{String: string(data), Valid: true}
	}

	// Serialize timeline if present
	var timelineJSON sql.NullString
	if len(msg.Timeline) > 0 {
		data, err := json.Marshal(msg.Timeline)
		if err != nil {
			return fmt.Errorf("AddMessageToConversation marshal timeline: %w", err)
		}
		timelineJSON = sql.NullString{String: string(data), Valid: true}
	}

	// Nullable scalar fields
	thinkingContent := nullString(msg.ThinkingContent)
	var durationMs sql.NullInt64
	if msg.DurationMs > 0 {
		durationMs = sql.NullInt64{Int64: int64(msg.DurationMs), Valid: true}
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
			INSERT INTO messages (id, conversation_id, role, content, setup_info, run_summary,
				tool_usage, thinking_content, duration_ms, timeline,
				timestamp, position)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			msg.ID, convID, msg.Role, msg.Content, setupInfoJSON, runSummaryJSON,
			toolUsageJSON, thinkingContent, durationMs, timelineJSON,
			msg.Timestamp, nextPos)
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
// Streaming Snapshot methods
// ============================================================================

// SetStreamingSnapshot stores a JSON snapshot of the current streaming state for a conversation.
// Used for reconnection recovery — the frontend can fetch this to restore its view.
func (s *SQLiteStore) SetStreamingSnapshot(ctx context.Context, convID string, snapshot []byte) error {
	return RetryDBExec(ctx, "SetStreamingSnapshot", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx,
			`UPDATE conversations SET streaming_snapshot = ? WHERE id = ?`,
			string(snapshot), convID)
		return err
	})
}

// GetStreamingSnapshot retrieves the stored streaming snapshot for a conversation.
// Returns nil if no snapshot exists (empty string in DB).
func (s *SQLiteStore) GetStreamingSnapshot(ctx context.Context, convID string) ([]byte, error) {
	var snapshot string
	err := s.db.QueryRowContext(ctx,
		`SELECT streaming_snapshot FROM conversations WHERE id = ?`,
		convID).Scan(&snapshot)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if snapshot == "" {
		return nil, nil
	}
	return []byte(snapshot), nil
}

// ClearStreamingSnapshot removes the streaming snapshot for a conversation.
func (s *SQLiteStore) ClearStreamingSnapshot(ctx context.Context, convID string) error {
	return RetryDBExec(ctx, "ClearStreamingSnapshot", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx,
			`UPDATE conversations SET streaming_snapshot = '' WHERE id = ?`,
			convID)
		return err
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
		INSERT INTO review_comments (id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		comment.ID, comment.SessionID, comment.FilePath, comment.LineNumber,
		comment.Title, comment.Content, comment.Source, comment.Author, severity,
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

	var title sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolved_at, resolved_by
		FROM review_comments WHERE id = ?`, id).Scan(
		&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
		&title, &comment.Content, &comment.Source, &comment.Author, &severity,
		&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetReviewComment: %w", err)
	}

	comment.Resolved = intToBool(resolved)
	if title.Valid {
		comment.Title = title.String
	}
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
		SELECT id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolved_at, resolved_by
		FROM review_comments WHERE session_id = ?
		ORDER BY file_path, line_number`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("ListReviewComments: %w", err)
	}
	defer rows.Close()

	comments := []*models.ReviewComment{}
	for rows.Next() {
		var comment models.ReviewComment
		var title sql.NullString
		var severity sql.NullString
		var resolved int
		var resolvedAt sql.NullTime
		var resolvedBy sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
			&title, &comment.Content, &comment.Source, &comment.Author, &severity,
			&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy); err != nil {
			return nil, fmt.Errorf("ListReviewComments scan: %w", err)
		}

		comment.Resolved = intToBool(resolved)
		if title.Valid {
			comment.Title = title.String
		}
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
		SELECT id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolved_at, resolved_by
		FROM review_comments WHERE session_id = ? AND file_path = ?
		ORDER BY line_number`, sessionID, filePath)
	if err != nil {
		return nil, fmt.Errorf("ListReviewCommentsForFile: %w", err)
	}
	defer rows.Close()

	comments := []*models.ReviewComment{}
	for rows.Next() {
		var comment models.ReviewComment
		var title sql.NullString
		var severity sql.NullString
		var resolved int
		var resolvedAt sql.NullTime
		var resolvedBy sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
			&title, &comment.Content, &comment.Source, &comment.Author, &severity,
			&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy); err != nil {
			return nil, fmt.Errorf("ListReviewCommentsForFile scan: %w", err)
		}

		comment.Resolved = intToBool(resolved)
		if title.Valid {
			comment.Title = title.String
		}
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
			title = ?, content = ?, severity = ?, resolved = ?, resolved_at = ?, resolved_by = ?
		WHERE id = ?`,
		comment.Title, comment.Content, severity, boolToInt(comment.Resolved), resolvedAt, resolvedBy, id)
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
		SELECT id, type, name, path, mime_type, size, line_count, width, height, preview
		FROM attachments WHERE message_id = ?`, messageID)
	if err != nil {
		return nil, fmt.Errorf("GetAttachmentsByMessageID: %w", err)
	}
	defer rows.Close()

	attachments := []models.Attachment{}
	for rows.Next() {
		var att models.Attachment
		var path, preview sql.NullString
		var lineCount, width, height sql.NullInt64

		if err := rows.Scan(&att.ID, &att.Type, &att.Name, &path, &att.MimeType,
			&att.Size, &lineCount, &width, &height, &preview); err != nil {
			return nil, fmt.Errorf("GetAttachmentsByMessageID scan: %w", err)
		}

		if path.Valid {
			att.Path = path.String
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

// ============================================================================
// Settings methods
// ============================================================================

// GetSetting retrieves a setting value by key.
// Returns (value, true, nil) if found, ("", false, nil) if not found.
// This distinguishes "key not set" from "key set to empty string".
func (s *SQLiteStore) GetSetting(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("GetSetting: %w", err)
	}
	return value, true, nil
}

// SetSetting creates or updates a setting value.
func (s *SQLiteStore) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
		key, value)
	if err != nil {
		return fmt.Errorf("SetSetting: %w", err)
	}
	return nil
}

// DeleteSetting removes a setting by key. No error if the key doesn't exist.
func (s *SQLiteStore) DeleteSetting(ctx context.Context, key string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, key)
	if err != nil {
		return fmt.Errorf("DeleteSetting: %w", err)
	}
	return nil
}

// GetAttachmentData retrieves the base64 data for a single attachment by ID.
func (s *SQLiteStore) GetAttachmentData(ctx context.Context, attachmentID string) (string, error) {
	var data sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT base64_data FROM attachments WHERE id = ?`, attachmentID).Scan(&data)
	if err == sql.ErrNoRows {
		return "", ErrAttachmentNotFound
	}
	if err != nil {
		return "", fmt.Errorf("GetAttachmentData: %w", err)
	}
	if !data.Valid {
		return "", nil
	}
	return data.String, nil
}

// ============================================================================
// Summary methods
// ============================================================================

// AddSummary inserts a new summary record.
func (s *SQLiteStore) AddSummary(ctx context.Context, summary *models.Summary) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO summaries (id, conversation_id, session_id, content, status, error_message, message_count, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		summary.ID, summary.ConversationID, summary.SessionID,
		summary.Content, summary.Status, summary.ErrorMessage,
		summary.MessageCount, summary.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("AddSummary: %w", err)
	}
	return nil
}

// GetSummaryByConversation returns the summary for a conversation, or nil if none exists.
func (s *SQLiteStore) GetSummaryByConversation(ctx context.Context, conversationID string) (*models.Summary, error) {
	var summary models.Summary
	var errorMsg sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, conversation_id, session_id, content, status, error_message, message_count, created_at
		FROM summaries WHERE conversation_id = ?
		ORDER BY created_at DESC LIMIT 1`,
		conversationID,
	).Scan(
		&summary.ID, &summary.ConversationID, &summary.SessionID,
		&summary.Content, &summary.Status, &errorMsg,
		&summary.MessageCount, &summary.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSummaryByConversation: %w", err)
	}
	if errorMsg.Valid {
		summary.ErrorMessage = errorMsg.String
	}
	return &summary, nil
}

// GetSummary returns a summary by ID.
func (s *SQLiteStore) GetSummary(ctx context.Context, id string) (*models.Summary, error) {
	var summary models.Summary
	var errorMsg sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, conversation_id, session_id, content, status, error_message, message_count, created_at
		FROM summaries WHERE id = ?`,
		id,
	).Scan(
		&summary.ID, &summary.ConversationID, &summary.SessionID,
		&summary.Content, &summary.Status, &errorMsg,
		&summary.MessageCount, &summary.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("GetSummary: %w", err)
	}
	if errorMsg.Valid {
		summary.ErrorMessage = errorMsg.String
	}
	return &summary, nil
}

// ListSummariesBySession returns all completed summaries for a session.
func (s *SQLiteStore) ListSummariesBySession(ctx context.Context, sessionID string) ([]*models.Summary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.conversation_id, s.session_id, s.content, s.status, s.error_message, s.message_count, s.created_at,
		       COALESCE(c.name, '')
		FROM summaries s
		LEFT JOIN conversations c ON c.id = s.conversation_id
		WHERE s.session_id = ? AND s.status = ?
		ORDER BY s.created_at DESC`,
		sessionID, models.SummaryStatusCompleted,
	)
	if err != nil {
		return nil, fmt.Errorf("ListSummariesBySession: %w", err)
	}
	defer rows.Close()

	var summaries []*models.Summary
	for rows.Next() {
		var summary models.Summary
		var errorMsg sql.NullString
		if err := rows.Scan(
			&summary.ID, &summary.ConversationID, &summary.SessionID,
			&summary.Content, &summary.Status, &errorMsg,
			&summary.MessageCount, &summary.CreatedAt,
			&summary.ConversationName,
		); err != nil {
			return nil, fmt.Errorf("ListSummariesBySession scan: %w", err)
		}
		if errorMsg.Valid {
			summary.ErrorMessage = errorMsg.String
		}
		summaries = append(summaries, &summary)
	}
	return summaries, rows.Err()
}

// UpdateSummary updates the status, content, and error message of a summary.
func (s *SQLiteStore) UpdateSummary(ctx context.Context, id, status, content, errorMessage string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE summaries SET status = ?, content = ?, error_message = ?
		WHERE id = ?`,
		status, content, errorMessage, id,
	)
	if err != nil {
		return fmt.Errorf("UpdateSummary: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("UpdateSummary rows: %w", err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteSummary deletes a summary by ID.
func (s *SQLiteStore) DeleteSummary(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM summaries WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteSummary: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("DeleteSummary rows: %w", err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// ParseEnvVars parses a newline-separated KEY=VALUE string into a map.
// Supports optional "export " prefix on each line. Blank lines and
// lines starting with "#" are skipped. Surrounding double or single
// quotes on values are stripped to match .env file conventions.
func ParseEnvVars(raw string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Strip optional "export " prefix
		line = strings.TrimPrefix(line, "export ")
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			// Strip surrounding quotes (double or single)
			if len(val) >= 2 {
				if (val[0] == '"' && val[len(val)-1] == '"') ||
					(val[0] == '\'' && val[len(val)-1] == '\'') {
					val = val[1 : len(val)-1]
				}
			}
			result[key] = val
		}
	}
	return result
}
