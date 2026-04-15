package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/google/uuid"
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
	dbPath := appdir.DBPath()

	logger.SQLite.Infof("Opening database at %s", dbPath)

	// Open database with optimized settings.
	// - synchronous(NORMAL): safe with WAL, avoids extra fsyncs on every write
	// - cache_size(-20000): ~20 MB page cache (negative value = KiB)
	// - mmap_size(268435456): 256 MB memory-mapped I/O for large read queries
	// - temp_store(MEMORY): keep temporary tables/indices in RAM
	db, err := sql.Open("sqlite", dbPath+
		"?_pragma=foreign_keys(1)"+
		"&_pragma=journal_mode(WAL)"+
		"&_pragma=busy_timeout(5000)"+
		"&_pragma=synchronous(NORMAL)"+
		"&_pragma=cache_size(-20000)"+
		"&_pragma=mmap_size(268435456)"+
		"&_pragma=temp_store(MEMORY)")
	if err != nil {
		return nil, err
	}

	// Allow multiple connections for nested queries (reading conversations with messages).
	// SQLite with WAL mode handles concurrent readers well; desktop app has no
	// connection-exhaustion risk so we use higher limits for better parallelism.
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
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

// Ping checks that the database is reachable.
func (s *SQLiteStore) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
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
		remote TEXT NOT NULL DEFAULT '',
		branch_prefix TEXT NOT NULL DEFAULT '',
		custom_prefix TEXT NOT NULL DEFAULT '',
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
		base_commit_sha TEXT NOT NULL DEFAULT '',
		target_branch TEXT DEFAULT NULL,
		task TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'idle',
		agent_id TEXT DEFAULT NULL,
		pr_status TEXT NOT NULL DEFAULT 'none',
		pr_url TEXT NOT NULL DEFAULT '',
		pr_number INTEGER NOT NULL DEFAULT 0,
		pr_title TEXT NOT NULL DEFAULT '',
		has_merge_conflict INTEGER NOT NULL DEFAULT 0,
		has_check_failures INTEGER NOT NULL DEFAULT 0,
		stats_additions INTEGER NOT NULL DEFAULT 0,
		stats_deletions INTEGER NOT NULL DEFAULT 0,
		pinned INTEGER NOT NULL DEFAULT 0,
		archived INTEGER NOT NULL DEFAULT 0,
		priority INTEGER NOT NULL DEFAULT 0,
		task_status TEXT NOT NULL DEFAULT 'backlog',
		archive_summary TEXT NOT NULL DEFAULT '',
		archive_summary_status TEXT NOT NULL DEFAULT '',
		auto_named INTEGER NOT NULL DEFAULT 0,
		check_status TEXT NOT NULL DEFAULT 'none',
		session_type TEXT NOT NULL DEFAULT 'worktree',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (workspace_id) REFERENCES repos(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_workspace_name ON sessions(workspace_id, name);

	-- Agents (legacy, still actively used by agent/manager.go)
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
		model TEXT NOT NULL DEFAULT '',
		streaming_snapshot TEXT NOT NULL DEFAULT '',
		agent_session_id TEXT NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);

	-- Messages
	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		setup_info TEXT DEFAULT NULL,
		run_summary TEXT DEFAULT NULL,
		tool_usage TEXT DEFAULT NULL,
		thinking_content TEXT DEFAULT NULL,
		duration_ms INTEGER DEFAULT NULL,
		timeline TEXT DEFAULT NULL,
		plan_content TEXT DEFAULT NULL,
		checkpoint_uuid TEXT DEFAULT NULL,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		position INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
	CREATE INDEX IF NOT EXISTS idx_messages_conversation_position ON messages(conversation_id, position);

	-- Tool Actions
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

	-- File Tabs
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
	);
	CREATE INDEX IF NOT EXISTS idx_file_tabs_workspace ON file_tabs(workspace_id);
	CREATE INDEX IF NOT EXISTS idx_file_tabs_workspace_position ON file_tabs(workspace_id, position);

	-- Review Comments
	CREATE TABLE IF NOT EXISTS review_comments (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		file_path TEXT NOT NULL,
		line_number INTEGER NOT NULL,
		title TEXT,
		content TEXT NOT NULL,
		source TEXT NOT NULL,
		author TEXT NOT NULL,
		severity TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		resolved INTEGER NOT NULL DEFAULT 0,
		resolved_at DATETIME,
		resolved_by TEXT,
		FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_review_comments_session ON review_comments(session_id);
	CREATE INDEX IF NOT EXISTS idx_review_comments_file ON review_comments(session_id, file_path);

	-- Attachments
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
	);
	CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);

	-- Summaries
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
	);
	CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON summaries(conversation_id);
	CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
	CREATE INDEX IF NOT EXISTS idx_summaries_session_status ON summaries(session_id, status);

	-- Checkpoints (file state snapshots from Agent SDK)
	CREATE TABLE IF NOT EXISTS checkpoints (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		uuid TEXT NOT NULL,
		message_index INTEGER NOT NULL DEFAULT 0,
		is_result INTEGER NOT NULL DEFAULT 0,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
		FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_checkpoints_conversation ON checkpoints(conversation_id);

	-- Settings (key-value store)
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- User Skill Preferences
	CREATE TABLE IF NOT EXISTS user_skill_preferences (
		id TEXT PRIMARY KEY,
		skill_id TEXT NOT NULL UNIQUE,
		installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_user_skill_preferences_skill_id ON user_skill_preferences(skill_id);
	`

	_, err := s.db.Exec(schema)
	if err != nil {
		return err
	}

	// Run versioned migrations for incremental schema changes.
	if err := RunMigrations(context.Background(), s.db); err != nil {
		return err
	}

	logger.SQLite.Infof("Schema initialized")
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

// GetReposByIDs returns repos for the given IDs as a map keyed by repo ID.
// Returns an empty map when ids is empty (no query executed).
// IDs are queried in batches to stay within SQLite's parameter limit.
func (s *SQLiteStore) GetReposByIDs(ctx context.Context, ids []string) (map[string]*models.Repo, error) {
	result := make(map[string]*models.Repo, len(ids))
	if len(ids) == 0 {
		return result, nil
	}

	const batchSize = 500 // well under SQLite's default 999 parameter limit
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]

		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			placeholders[j] = "?"
			args[j] = id
		}

		query := `SELECT id, name, path, branch, remote, branch_prefix, custom_prefix, created_at
			FROM repos WHERE id IN (` + strings.Join(placeholders, ",") + `)`
		rows, err := s.db.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("GetReposByIDs: %w", err)
		}

		for rows.Next() {
			var repo models.Repo
			if err := rows.Scan(&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.Remote, &repo.BranchPrefix, &repo.CustomPrefix, &repo.CreatedAt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("GetReposByIDs scan: %w", err)
			}
			result[repo.ID] = &repo
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("GetReposByIDs rows: %w", err)
		}
		rows.Close()
	}
	return result, nil
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

		sessionType := session.SessionType
		if sessionType == "" {
			sessionType = models.SessionTypeWorktree
		}

		_, err := s.db.ExecContext(ctx, `
			INSERT INTO sessions (id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
				task, status, agent_id, pr_status, pr_url, pr_number, pr_title, has_merge_conflict,
				has_check_failures, check_status, stats_additions, stats_deletions, pinned, archived,
				priority, task_status, archive_summary, archive_summary_status, auto_named,
				session_type, scheduled_task_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			session.ID, session.WorkspaceID, session.Name, session.Branch,
			session.WorktreePath, session.BaseCommitSHA, nullString(session.TargetBranch),
			session.Task, session.Status, session.AgentID,
			session.PRStatus, session.PRUrl, session.PRNumber, session.PRTitle,
			boolToInt(session.HasMergeConflict), boolToInt(session.HasCheckFailures),
			session.CheckStatus,
			statsAdditions, statsDeletions, boolToInt(session.Pinned), boolToInt(session.Archived),
			session.Priority, session.TaskStatus,
			session.ArchiveSummary, session.ArchiveSummaryStatus,
			boolToInt(session.AutoNamed),
			sessionType, nullString(session.ScheduledTaskID), session.CreatedAt, session.UpdatedAt)
		return err
	})
}

func (s *SQLiteStore) GetSession(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived, autoNamed int
	var agentID, targetBranch, scheduledTaskID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
			task, status, agent_id,
			pr_status, pr_url, pr_number, pr_title, has_merge_conflict, has_check_failures, check_status,
			stats_additions, stats_deletions, pinned, archived, priority, task_status,
			archive_summary, archive_summary_status, auto_named, session_type,
			scheduled_task_id, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
		&session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber, &session.PRTitle,
		&hasMergeConflict, &hasCheckFailures, &session.CheckStatus, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.Priority, &session.TaskStatus,
		&session.ArchiveSummary, &session.ArchiveSummaryStatus,
		&autoNamed, &session.SessionType,
		&scheduledTaskID, &session.CreatedAt, &session.UpdatedAt)
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
	session.AutoNamed = intToBool(autoNamed)
	if agentID.Valid {
		session.AgentID = agentID.String
	}
	if targetBranch.Valid {
		session.TargetBranch = targetBranch.String
	}
	if scheduledTaskID.Valid {
		session.ScheduledTaskID = scheduledTaskID.String
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
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived, autoNamed int
	var agentID, targetBranch, scheduledTaskID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.workspace_id, s.name, s.branch, s.worktree_path, s.base_commit_sha,
			s.target_branch, s.task, s.status, s.agent_id, s.pr_status, s.pr_url, s.pr_number, s.pr_title,
			s.has_merge_conflict, s.has_check_failures, s.check_status, s.stats_additions, s.stats_deletions,
			s.pinned, s.archived, s.priority, s.task_status, s.archive_summary, s.archive_summary_status,
			s.auto_named, s.session_type, s.scheduled_task_id,
			s.created_at, s.updated_at,
			r.path, r.branch, r.remote
		FROM sessions s
		JOIN repos r ON s.workspace_id = r.id
		WHERE s.id = ?`, id).Scan(
		&result.ID, &result.WorkspaceID, &result.Name, &result.Branch,
		&result.WorktreePath, &result.BaseCommitSHA, &targetBranch,
		&result.Task, &result.Status, &agentID,
		&result.PRStatus, &result.PRUrl, &result.PRNumber, &result.PRTitle,
		&hasMergeConflict, &hasCheckFailures, &result.CheckStatus, &statsAdditions, &statsDeletions,
		&pinned, &archived, &result.Priority, &result.TaskStatus, &result.ArchiveSummary, &result.ArchiveSummaryStatus,
		&autoNamed, &result.SessionType, &scheduledTaskID,
		&result.CreatedAt, &result.UpdatedAt,
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
	result.AutoNamed = intToBool(autoNamed)
	if agentID.Valid {
		result.AgentID = agentID.String
	}
	if targetBranch.Valid {
		result.TargetBranch = targetBranch.String
	}
	if scheduledTaskID.Valid {
		result.ScheduledTaskID = scheduledTaskID.String
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
		pr_status, pr_url, pr_number, pr_title, has_merge_conflict, has_check_failures, check_status,
		stats_additions, stats_deletions, pinned, archived, priority, task_status,
		archive_summary, archive_summary_status, auto_named, session_type,
		scheduled_task_id, created_at, updated_at
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
		var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived, autoNamed int
		var agentID, targetBranch, scheduledTaskID sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
			&session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber, &session.PRTitle,
			&hasMergeConflict, &hasCheckFailures, &session.CheckStatus, &statsAdditions, &statsDeletions,
			&pinned, &archived, &session.Priority, &session.TaskStatus,
			&session.ArchiveSummary, &session.ArchiveSummaryStatus,
			&autoNamed, &session.SessionType,
			&scheduledTaskID, &session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
		session.Archived = intToBool(archived)
		session.AutoNamed = intToBool(autoNamed)
		if agentID.Valid {
			session.AgentID = agentID.String
		}
		if targetBranch.Valid {
			session.TargetBranch = targetBranch.String
		}
		if scheduledTaskID.Valid {
			session.ScheduledTaskID = scheduledTaskID.String
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
		pr_status, pr_url, pr_number, pr_title, has_merge_conflict, has_check_failures, check_status,
		stats_additions, stats_deletions, pinned, archived, priority, task_status,
		archive_summary, archive_summary_status, auto_named, session_type,
		scheduled_task_id, created_at, updated_at
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
		var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived, autoNamed int
		var agentID, targetBranch, scheduledTaskID sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
			&session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber, &session.PRTitle,
			&hasMergeConflict, &hasCheckFailures, &session.CheckStatus, &statsAdditions, &statsDeletions,
			&pinned, &archived, &session.Priority, &session.TaskStatus,
			&session.ArchiveSummary, &session.ArchiveSummaryStatus,
			&autoNamed, &session.SessionType,
			&scheduledTaskID, &session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListAllSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
		session.Archived = intToBool(archived)
		session.AutoNamed = intToBool(autoNamed)
		if agentID.Valid {
			session.AgentID = agentID.String
		}
		if targetBranch.Valid {
			session.TargetBranch = targetBranch.String
		}
		if scheduledTaskID.Valid {
			session.ScheduledTaskID = scheduledTaskID.String
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
				name = ?, branch = ?, worktree_path = ?, base_commit_sha = ?, target_branch = ?,
				task = ?, status = ?, agent_id = ?, pr_status = ?, pr_url = ?,
				pr_number = ?, pr_title = ?, has_merge_conflict = ?, has_check_failures = ?, check_status = ?,
				stats_additions = ?, stats_deletions = ?, pinned = ?, archived = ?,
				priority = ?, task_status = ?, archive_summary = ?, archive_summary_status = ?,
				auto_named = ?, session_type = ?, scheduled_task_id = ?, updated_at = ?
			WHERE id = ?`,
			session.Name, session.Branch, session.WorktreePath, session.BaseCommitSHA,
			nullString(session.TargetBranch),
			session.Task, session.Status, session.AgentID, session.PRStatus, session.PRUrl,
			session.PRNumber, session.PRTitle, boolToInt(session.HasMergeConflict),
			boolToInt(session.HasCheckFailures), session.CheckStatus,
			statsAdditions, statsDeletions, boolToInt(session.Pinned), boolToInt(session.Archived),
			session.Priority, session.TaskStatus,
			session.ArchiveSummary, session.ArchiveSummaryStatus,
			boolToInt(session.AutoNamed), session.SessionType,
			nullString(session.ScheduledTaskID), session.UpdatedAt, id)
		return err
	})
}

func (s *SQLiteStore) getSessionNoLock(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived, autoNamed int
	var agentID, targetBranch, scheduledTaskID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
			task, status, agent_id,
			pr_status, pr_url, pr_number, pr_title, has_merge_conflict, has_check_failures, check_status,
			stats_additions, stats_deletions, pinned, archived, priority, task_status,
			archive_summary, archive_summary_status, auto_named, session_type,
			scheduled_task_id, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
		&session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber, &session.PRTitle,
		&hasMergeConflict, &hasCheckFailures, &session.CheckStatus, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.Priority, &session.TaskStatus,
		&session.ArchiveSummary, &session.ArchiveSummaryStatus,
		&autoNamed, &session.SessionType,
		&scheduledTaskID, &session.CreatedAt, &session.UpdatedAt)
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
	session.AutoNamed = intToBool(autoNamed)
	if agentID.Valid {
		session.AgentID = agentID.String
	}
	if targetBranch.Valid {
		session.TargetBranch = targetBranch.String
	}
	if scheduledTaskID.Valid {
		session.ScheduledTaskID = scheduledTaskID.String
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

// GetBaseSessionForWorkspace returns the base session for a workspace, or nil if none exists.
func (s *SQLiteStore) GetBaseSessionForWorkspace(ctx context.Context, workspaceID string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned, archived, autoNamed int
	var agentID, targetBranch sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, target_branch,
			task, status, agent_id,
			pr_status, pr_url, pr_number, pr_title, has_merge_conflict, has_check_failures, check_status,
			stats_additions, stats_deletions, pinned, archived, priority, task_status,
			archive_summary, archive_summary_status, auto_named, session_type,
			created_at, updated_at
		FROM sessions WHERE workspace_id = ? AND session_type = 'base'`, workspaceID).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &targetBranch,
		&session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber, &session.PRTitle,
		&hasMergeConflict, &hasCheckFailures, &session.CheckStatus, &statsAdditions, &statsDeletions,
		&pinned, &archived, &session.Priority, &session.TaskStatus,
		&session.ArchiveSummary, &session.ArchiveSummaryStatus,
		&autoNamed, &session.SessionType,
		&session.CreatedAt, &session.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetBaseSessionForWorkspace: %w", err)
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	session.Pinned = intToBool(pinned)
	session.Archived = intToBool(archived)
	session.AutoNamed = intToBool(autoNamed)
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

// ListConversationsByWorkspace returns all conversations across all non-archived sessions
// in a workspace. Uses 3 queries total (conversations JOIN sessions + message counts + tool actions).
func (s *SQLiteStore) ListConversationsByWorkspace(ctx context.Context, workspaceID string) ([]*models.Conversation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.session_id, c.type, c.name, c.status, c.model, c.agent_session_id, c.created_at, c.updated_at
		FROM conversations c
		JOIN sessions s ON c.session_id = s.id
		WHERE s.workspace_id = ? AND s.archived = 0`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("ListConversationsByWorkspace: %w", err)
	}

	convs := []*models.Conversation{}
	convMap := make(map[string]*models.Conversation)
	convIDs := []string{}

	for rows.Next() {
		var conv models.Conversation
		if err := rows.Scan(&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
			&conv.Status, &conv.Model, &conv.AgentSessionID, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("ListConversationsByWorkspace scan: %w", err)
		}
		conv.Messages = []models.Message{}
		conv.ToolSummary = []models.ToolAction{}
		convs = append(convs, &conv)
		convMap[conv.ID] = &conv
		convIDs = append(convIDs, conv.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListConversationsByWorkspace rows: %w", err)
	}

	if len(convIDs) == 0 {
		return convs, nil
	}

	if err := s.loadMessageCountsForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	if err := s.loadToolActionsForConversations(ctx, convMap, convIDs); err != nil {
		return nil, err
	}

	return convs, nil
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

// compactToolParams truncates long string values in tool params to reduce response size.
// Keeps keys like file_path, command, pattern readable for collapsed tool headers.
func compactToolParams(params map[string]interface{}) map[string]interface{} {
	if params == nil {
		return nil
	}
	compact := make(map[string]interface{}, len(params))
	for k, v := range params {
		if s, ok := v.(string); ok && len(s) > 200 {
			compact[k] = s[:200] + "…"
		} else {
			compact[k] = v
		}
	}
	return compact
}

// GetConversationMessages returns a paginated page of messages for a conversation.
// Uses cursor-based pagination on the position column.
// If beforePosition is nil, returns the most recent messages.
// Messages are returned in ascending position order.
func (s *SQLiteStore) GetConversationMessages(ctx context.Context, convID string, beforePosition *int, limit int, compact bool) (*models.MessagePage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	// Fetch limit+1 rows to determine hasMore.
	// The scalar subquery gets total count in the same round-trip.
	fetchLimit := limit + 1
	var rows *sql.Rows
	var err error
	if beforePosition != nil {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, role, content, setup_info, run_summary,
				tool_usage, thinking_content, duration_ms, timeline,
				plan_content, checkpoint_uuid, timestamp, position,
				(SELECT COUNT(*) FROM messages WHERE conversation_id = ?) as total_count
			FROM messages
			WHERE conversation_id = ? AND position < ?
			ORDER BY position DESC
			LIMIT ?`, convID, convID, *beforePosition, fetchLimit)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, role, content, setup_info, run_summary,
				tool_usage, thinking_content, duration_ms, timeline,
				plan_content, checkpoint_uuid, timestamp, position,
				(SELECT COUNT(*) FROM messages WHERE conversation_id = ?) as total_count
			FROM messages
			WHERE conversation_id = ?
			ORDER BY position DESC
			LIMIT ?`, convID, convID, fetchLimit)
	}
	if err != nil {
		return nil, fmt.Errorf("GetConversationMessages query: %w", err)
	}
	defer rows.Close()

	type messageWithPos struct {
		msg      models.Message
		position int
	}

	var totalCount int
	var items []messageWithPos
	for rows.Next() {
		var msg models.Message
		var setupInfoJSON, runSummaryJSON sql.NullString
		var toolUsageJSON, thinkingContentNull, timelineJSON sql.NullString
		var planContentNull, checkpointUuidNull sql.NullString
		var durationMsNull sql.NullInt64
		var position int
		if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &runSummaryJSON,
			&toolUsageJSON, &thinkingContentNull, &durationMsNull, &timelineJSON,
			&planContentNull, &checkpointUuidNull, &msg.Timestamp, &position, &totalCount); err != nil {
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
		if planContentNull.Valid {
			msg.PlanContent = planContentNull.String
		}
		if checkpointUuidNull.Valid {
			msg.CheckpointUuid = checkpointUuidNull.String
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

	// In compact mode, strip heavy fields to reduce JSON response size
	if compact {
		for i := range messages {
			messages[i].ThinkingContent = ""
			for j := range messages[i].ToolUsage {
				messages[i].ToolUsage[j].Stdout = ""
				messages[i].ToolUsage[j].Stderr = ""
				messages[i].ToolUsage[j].Params = compactToolParams(messages[i].ToolUsage[j].Params)
			}
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

// GetMessage returns a single message by ID with all fields (no compact stripping).
// Used for on-demand hydration when the frontend needs full tool details.
func (s *SQLiteStore) GetMessage(ctx context.Context, convID string, msgID string) (*models.Message, error) {
	var msg models.Message
	var setupInfoJSON, runSummaryJSON sql.NullString
	var toolUsageJSON, thinkingContentNull, timelineJSON sql.NullString
	var planContentNull, checkpointUuidNull sql.NullString
	var durationMsNull sql.NullInt64

	err := s.db.QueryRowContext(ctx, `
		SELECT id, role, content, setup_info, run_summary,
			tool_usage, thinking_content, duration_ms, timeline,
			plan_content, checkpoint_uuid, timestamp
		FROM messages
		WHERE conversation_id = ? AND id = ?`, convID, msgID).Scan(
		&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &runSummaryJSON,
		&toolUsageJSON, &thinkingContentNull, &durationMsNull, &timelineJSON,
		&planContentNull, &checkpointUuidNull, &msg.Timestamp)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("GetMessage query: %w", err)
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
	if planContentNull.Valid {
		msg.PlanContent = planContentNull.String
	}
	if checkpointUuidNull.Valid {
		msg.CheckpointUuid = checkpointUuidNull.String
	}

	// Load attachments for this single message
	messages := []models.Message{msg}
	msgIndexByID := map[string]int{msg.ID: 0}
	if err := s.loadAttachmentsForMessages(ctx, messages, msgIndexByID); err != nil {
		return nil, err
	}

	return &messages[0], nil
}

// SessionHasMessages returns true if any conversation in the session has at least one message.
func (s *SQLiteStore) SessionHasMessages(ctx context.Context, sessionID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM messages m
		JOIN conversations c ON m.conversation_id = c.id
		WHERE c.session_id = ?`, sessionID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("SessionHasMessages: %w", err)
	}
	return count > 0, nil
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
	planContent := nullString(msg.PlanContent)
	checkpointUuid := nullString(msg.CheckpointUuid)
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
				plan_content, checkpoint_uuid, timestamp, position)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			msg.ID, convID, msg.Role, msg.Content, setupInfoJSON, runSummaryJSON,
			toolUsageJSON, thinkingContent, durationMs, timelineJSON,
			planContent, checkpointUuid, msg.Timestamp, nextPos)
		if err != nil {
			tx.Rollback()
			return err
		}

		return tx.Commit()
	})
}

// preparedMessage holds pre-serialized fields for a message insert.
type preparedMessage struct {
	msg             models.Message
	setupInfoJSON   sql.NullString
	runSummaryJSON  sql.NullString
	toolUsageJSON   sql.NullString
	timelineJSON    sql.NullString
	thinkingContent sql.NullString
	planContent     sql.NullString
	checkpointUuid  sql.NullString
	durationMs      sql.NullInt64
}

func prepareMessage(msg models.Message) (preparedMessage, error) {
	p := preparedMessage{msg: msg}

	if msg.SetupInfo != nil {
		data, err := json.Marshal(msg.SetupInfo)
		if err != nil {
			return p, fmt.Errorf("marshal setupInfo: %w", err)
		}
		p.setupInfoJSON = sql.NullString{String: string(data), Valid: true}
	}
	if msg.RunSummary != nil {
		data, err := json.Marshal(msg.RunSummary)
		if err != nil {
			return p, fmt.Errorf("marshal runSummary: %w", err)
		}
		p.runSummaryJSON = sql.NullString{String: string(data), Valid: true}
	}
	if len(msg.ToolUsage) > 0 {
		data, err := json.Marshal(msg.ToolUsage)
		if err != nil {
			return p, fmt.Errorf("marshal toolUsage: %w", err)
		}
		p.toolUsageJSON = sql.NullString{String: string(data), Valid: true}
	}
	if len(msg.Timeline) > 0 {
		data, err := json.Marshal(msg.Timeline)
		if err != nil {
			return p, fmt.Errorf("marshal timeline: %w", err)
		}
		p.timelineJSON = sql.NullString{String: string(data), Valid: true}
	}

	p.thinkingContent = nullString(msg.ThinkingContent)
	p.planContent = nullString(msg.PlanContent)
	p.checkpointUuid = nullString(msg.CheckpointUuid)
	if msg.DurationMs > 0 {
		p.durationMs = sql.NullInt64{Int64: int64(msg.DurationMs), Valid: true}
	}
	return p, nil
}

func insertPreparedMessage(ctx context.Context, tx *sql.Tx, convID string, p preparedMessage, pos int) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO messages (id, conversation_id, role, content, setup_info, run_summary,
			tool_usage, thinking_content, duration_ms, timeline,
			plan_content, checkpoint_uuid, timestamp, position)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.msg.ID, convID, p.msg.Role, p.msg.Content, p.setupInfoJSON, p.runSummaryJSON,
		p.toolUsageJSON, p.thinkingContent, p.durationMs, p.timelineJSON,
		p.planContent, p.checkpointUuid, p.msg.Timestamp, pos)
	return err
}

// AddMessagesToConversation inserts multiple messages atomically in a single transaction.
// Messages are inserted in slice order with sequential positions.
func (s *SQLiteStore) AddMessagesToConversation(ctx context.Context, convID string, msgs []models.Message) error {
	if len(msgs) == 0 {
		return nil
	}
	// Fast path: single message delegates to existing method
	if len(msgs) == 1 {
		return s.AddMessageToConversation(ctx, convID, msgs[0])
	}

	// Pre-serialize all messages outside the retry loop (deterministic)
	prepared := make([]preparedMessage, len(msgs))
	for i, msg := range msgs {
		p, err := prepareMessage(msg)
		if err != nil {
			return fmt.Errorf("AddMessagesToConversation[%d]: %w", i, err)
		}
		prepared[i] = p
	}

	return RetryDBExec(ctx, "AddMessagesToConversation", DefaultRetryConfig(), func(ctx context.Context) error {
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

		for i, p := range prepared {
			if err := insertPreparedMessage(ctx, tx, convID, p, nextPos+i); err != nil {
				tx.Rollback()
				return err
			}
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

// InterruptedConversation represents a conversation that was interrupted by an app shutdown.
// It has a non-empty streaming snapshot but no running agent process.
type InterruptedConversation struct {
	ID             string `json:"id"`
	SessionID      string `json:"sessionId"`
	AgentSessionID string `json:"agentSessionId"`
	SnapshotJSON   []byte `json:"snapshot"`
}

// GetInterruptedConversations returns conversations that have a non-empty streaming
// snapshot. After an app restart, these conversations were interrupted mid-turn
// (their agent processes were killed during shutdown).
func (s *SQLiteStore) GetInterruptedConversations(ctx context.Context) ([]InterruptedConversation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, agent_session_id, streaming_snapshot
		FROM conversations
		WHERE streaming_snapshot != '' AND streaming_snapshot != '{}'
			AND agent_session_id != ''`)
	if err != nil {
		return nil, fmt.Errorf("GetInterruptedConversations: %w", err)
	}
	defer rows.Close()

	var result []InterruptedConversation
	for rows.Next() {
		var ic InterruptedConversation
		var snapshot string
		if err := rows.Scan(&ic.ID, &ic.SessionID, &ic.AgentSessionID, &snapshot); err != nil {
			return nil, fmt.Errorf("GetInterruptedConversations scan: %w", err)
		}
		ic.SnapshotJSON = []byte(snapshot)
		result = append(result, ic)
	}
	return result, rows.Err()
}

// CleanupStaleConversations resets conversations that were left in 'active' status
// from a previous unclean shutdown. Their agent processes are dead but their
// streaming snapshots are preserved for frontend recovery.
// Only resets conversations that haven't been updated in the last 30 seconds to
// avoid clobbering legitimately active conversations during hot-reloads.
func (s *SQLiteStore) CleanupStaleConversations(ctx context.Context) error {
	return RetryDBExec(ctx, "CleanupStaleConversations", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx,
			`UPDATE conversations SET status = 'idle'
			 WHERE status = 'active' AND updated_at < datetime('now', '-30 seconds')`)
		return err
	})
}

// ConvertSnapshotsToMessages converts orphaned streaming snapshots into persisted
// assistant messages. This recovers partial agent responses that were lost when
// the app was killed mid-turn (e.g., SIGKILL before the output handler could flush).
// Returns the number of conversations whose snapshots were converted.
func (s *SQLiteStore) ConvertSnapshotsToMessages(ctx context.Context) (int, error) {
	interrupted, err := s.GetInterruptedConversations(ctx)
	if err != nil {
		return 0, fmt.Errorf("ConvertSnapshotsToMessages: %w", err)
	}

	// Minimal struct for deserializing snapshot JSON within the store package
	// (cannot import agent package due to circular dependency).
	// Intentionally ignores: activeTools, isThinking, planModeActive, subAgents,
	// pendingPlanApproval, pendingUserQuestion — these are transient UI state
	// that is not meaningful to recover as a persisted message.
	type snapshotTextSegment struct {
		Text      string `json:"text"`
		Timestamp int64  `json:"timestamp"`
	}
	type snapshot struct {
		Text         string                `json:"text"`
		TextSegments []snapshotTextSegment `json:"textSegments"`
		Thinking     string                `json:"thinking"`
	}

	converted := 0
	for _, ic := range interrupted {
		var snap snapshot
		if err := json.Unmarshal(ic.SnapshotJSON, &snap); err != nil {
			logger.Store.Errorf("ConvertSnapshotsToMessages: failed to unmarshal snapshot for conv %s, clearing corrupt snapshot: %v", ic.ID, err)
			// Clear corrupt snapshots to prevent retry on every startup
			if clearErr := s.ClearStreamingSnapshot(ctx, ic.ID); clearErr != nil {
				logger.Store.Errorf("ConvertSnapshotsToMessages: failed to clear corrupt snapshot for conv %s: %v", ic.ID, clearErr)
			}
			continue
		}

		// Skip empty snapshots (agent started but hadn't produced any text or thinking)
		if snap.Text == "" && snap.Thinking == "" {
			// Clear the empty snapshot
			if err := s.ClearStreamingSnapshot(ctx, ic.ID); err != nil {
				logger.Store.Errorf("ConvertSnapshotsToMessages: failed to clear empty snapshot for conv %s: %v", ic.ID, err)
			}
			continue
		}

		// Dedup: check if the last message is already an assistant message with matching content.
		// This handles the case where the output handler successfully flushed (Change 1) but
		// ClearStreamingSnapshot failed (e.g., timeout).
		var lastRole, lastContent sql.NullString
		row := s.db.QueryRowContext(ctx,
			`SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY position DESC LIMIT 1`,
			ic.ID)
		if err := row.Scan(&lastRole, &lastContent); err != nil && err != sql.ErrNoRows {
			logger.Store.Errorf("ConvertSnapshotsToMessages: failed to check last message for conv %s: %v", ic.ID, err)
			continue
		}
		if lastRole.Valid && lastRole.String == "assistant" && lastContent.Valid && lastContent.String == snap.Text {
			// Already persisted — just clear the snapshot
			if err := s.ClearStreamingSnapshot(ctx, ic.ID); err != nil {
				logger.Store.Errorf("ConvertSnapshotsToMessages: failed to clear duplicate snapshot for conv %s: %v", ic.ID, err)
			}
			continue
		}

		// Build timeline from text segments and thinking blocks.
		// Thinking is prepended since it typically precedes text output.
		var timeline []models.TimelineEntry
		if snap.Thinking != "" {
			timeline = append(timeline, models.TimelineEntry{Type: "thinking", Content: snap.Thinking})
		}
		if len(snap.TextSegments) > 0 {
			for _, seg := range snap.TextSegments {
				if seg.Text != "" {
					timeline = append(timeline, models.TimelineEntry{Type: "text", Content: seg.Text})
				}
			}
		} else if snap.Text != "" {
			// Fallback: single text entry if no segments
			timeline = append(timeline, models.TimelineEntry{Type: "text", Content: snap.Text})
		}

		msg := models.Message{
			ID:              uuid.New().String()[:8],
			Role:            "assistant",
			Content:         snap.Text,
			ThinkingContent: snap.Thinking,
			Timeline:        timeline,
			Timestamp:       time.Now(),
		}

		if err := s.AddMessageToConversation(ctx, ic.ID, msg); err != nil {
			logger.Store.Errorf("ConvertSnapshotsToMessages: failed to persist recovered message for conv %s: %v", ic.ID, err)
			continue
		}

		if err := s.ClearStreamingSnapshot(ctx, ic.ID); err != nil {
			logger.Store.Errorf("ConvertSnapshotsToMessages: failed to clear snapshot after conversion for conv %s: %v", ic.ID, err)
		}

		converted++
		logger.Store.Infof("ConvertSnapshotsToMessages: recovered interrupted assistant message for conv %s (%d chars)", ic.ID, len(snap.Text))
	}

	return converted, nil
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
		INSERT INTO review_comments (id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolution_type)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		comment.ID, comment.SessionID, comment.FilePath, comment.LineNumber,
		comment.Title, comment.Content, comment.Source, comment.Author, severity,
		comment.CreatedAt, boolToInt(comment.Resolved), comment.ResolutionType)
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
	var resolutionType sql.NullString

	var title sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolved_at, resolved_by, resolution_type
		FROM review_comments WHERE id = ?`, id).Scan(
		&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
		&title, &comment.Content, &comment.Source, &comment.Author, &severity,
		&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy, &resolutionType)
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
	if resolutionType.Valid {
		comment.ResolutionType = resolutionType.String
	}

	return &comment, nil
}

func (s *SQLiteStore) ListReviewComments(ctx context.Context, sessionID string) ([]*models.ReviewComment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolved_at, resolved_by, resolution_type
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
		var resolutionType sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
			&title, &comment.Content, &comment.Source, &comment.Author, &severity,
			&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy, &resolutionType); err != nil {
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
		if resolutionType.Valid {
			comment.ResolutionType = resolutionType.String
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
		SELECT id, session_id, file_path, line_number, title, content, source, author, severity, created_at, resolved, resolved_at, resolved_by, resolution_type
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
		var resolutionType sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.SessionID, &comment.FilePath, &comment.LineNumber,
			&title, &comment.Content, &comment.Source, &comment.Author, &severity,
			&comment.CreatedAt, &resolved, &resolvedAt, &resolvedBy, &resolutionType); err != nil {
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
		if resolutionType.Valid {
			comment.ResolutionType = resolutionType.String
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
			title = ?, content = ?, severity = ?, resolved = ?, resolved_at = ?, resolved_by = ?, resolution_type = ?
		WHERE id = ?`,
		comment.Title, comment.Content, severity, boolToInt(comment.Resolved), resolvedAt, resolvedBy, comment.ResolutionType, id)
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
// Checkpoint methods
// ============================================================================

func (s *SQLiteStore) AddCheckpoint(ctx context.Context, cp *models.Checkpoint) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO checkpoints (id, conversation_id, session_id, uuid, message_index, is_result, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		cp.ID, cp.ConversationID, cp.SessionID, cp.UUID, cp.MessageIndex, boolToInt(cp.IsResult), cp.Timestamp)
	if err != nil {
		return fmt.Errorf("AddCheckpoint: %w", err)
	}
	return nil
}

func (s *SQLiteStore) ListCheckpointsByConversation(ctx context.Context, conversationID string) ([]*models.Checkpoint, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, conversation_id, session_id, uuid, message_index, is_result, timestamp
		FROM checkpoints WHERE conversation_id = ?
		ORDER BY timestamp ASC`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("ListCheckpointsByConversation: %w", err)
	}
	defer rows.Close()

	checkpoints := []*models.Checkpoint{}
	for rows.Next() {
		var cp models.Checkpoint
		var isResult int
		if err := rows.Scan(&cp.ID, &cp.ConversationID, &cp.SessionID, &cp.UUID, &cp.MessageIndex, &isResult, &cp.Timestamp); err != nil {
			return nil, fmt.Errorf("ListCheckpointsByConversation scan: %w", err)
		}
		cp.IsResult = intToBool(isResult)
		checkpoints = append(checkpoints, &cp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListCheckpointsByConversation rows: %w", err)
	}
	return checkpoints, nil
}

func (s *SQLiteStore) DeleteCheckpointsForConversation(ctx context.Context, conversationID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM checkpoints WHERE conversation_id = ?`, conversationID)
	if err != nil {
		return fmt.Errorf("DeleteCheckpointsForConversation: %w", err)
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

// ============================================================================
// Scheduled Task methods
// ============================================================================

func (s *SQLiteStore) AddScheduledTask(ctx context.Context, task *models.ScheduledTask) error {
	return RetryDBExec(ctx, "AddScheduledTask", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO scheduled_tasks (id, workspace_id, name, description, prompt, model,
				permission_mode, frequency, cron_expression,
				schedule_hour, schedule_minute, schedule_day_of_week, schedule_day_of_month,
				enabled, archived, last_run_at, next_run_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			task.ID, task.WorkspaceID, task.Name, task.Description, task.Prompt, task.Model,
			task.PermissionMode, task.Frequency, task.CronExpression,
			task.ScheduleHour, task.ScheduleMinute, task.ScheduleDayOfWeek, task.ScheduleDayOfMonth,
			boolToInt(task.Enabled), boolToInt(task.Archived), task.LastRunAt, task.NextRunAt, task.CreatedAt, task.UpdatedAt)
		return err
	})
}

func (s *SQLiteStore) GetScheduledTask(ctx context.Context, id string) (*models.ScheduledTask, error) {
	var task models.ScheduledTask
	var enabled, archived int
	var lastRunAt, nextRunAt sql.NullTime

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, description, prompt, model,
			permission_mode, frequency, cron_expression,
			schedule_hour, schedule_minute, schedule_day_of_week, schedule_day_of_month,
			enabled, archived, last_run_at, next_run_at, created_at, updated_at
		FROM scheduled_tasks WHERE id = ?`, id).Scan(
		&task.ID, &task.WorkspaceID, &task.Name, &task.Description, &task.Prompt, &task.Model,
		&task.PermissionMode, &task.Frequency, &task.CronExpression,
		&task.ScheduleHour, &task.ScheduleMinute, &task.ScheduleDayOfWeek, &task.ScheduleDayOfMonth,
		&enabled, &archived, &lastRunAt, &nextRunAt, &task.CreatedAt, &task.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetScheduledTask: %w", err)
	}

	task.Enabled = intToBool(enabled)
	task.Archived = intToBool(archived)
	if lastRunAt.Valid {
		task.LastRunAt = &lastRunAt.Time
	}
	if nextRunAt.Valid {
		task.NextRunAt = &nextRunAt.Time
	}
	return &task, nil
}

func (s *SQLiteStore) ListAllScheduledTasks(ctx context.Context) ([]*models.ScheduledTask, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, name, description, prompt, model,
			permission_mode, frequency, cron_expression,
			schedule_hour, schedule_minute, schedule_day_of_week, schedule_day_of_month,
			enabled, archived, last_run_at, next_run_at, created_at, updated_at
		FROM scheduled_tasks WHERE archived = 0 ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("ListAllScheduledTasks: %w", err)
	}
	defer rows.Close()
	return s.scanScheduledTasks(rows)
}

func (s *SQLiteStore) ListScheduledTasks(ctx context.Context, workspaceID string) ([]*models.ScheduledTask, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, name, description, prompt, model,
			permission_mode, frequency, cron_expression,
			schedule_hour, schedule_minute, schedule_day_of_week, schedule_day_of_month,
			enabled, archived, last_run_at, next_run_at, created_at, updated_at
		FROM scheduled_tasks WHERE workspace_id = ? AND archived = 0 ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("ListScheduledTasks: %w", err)
	}
	defer rows.Close()
	return s.scanScheduledTasks(rows)
}

func (s *SQLiteStore) scanScheduledTasks(rows *sql.Rows) ([]*models.ScheduledTask, error) {
	tasks := []*models.ScheduledTask{}
	for rows.Next() {
		var task models.ScheduledTask
		var enabled, archived int
		var lastRunAt, nextRunAt sql.NullTime

		if err := rows.Scan(
			&task.ID, &task.WorkspaceID, &task.Name, &task.Description, &task.Prompt, &task.Model,
			&task.PermissionMode, &task.Frequency, &task.CronExpression,
			&task.ScheduleHour, &task.ScheduleMinute, &task.ScheduleDayOfWeek, &task.ScheduleDayOfMonth,
			&enabled, &archived, &lastRunAt, &nextRunAt, &task.CreatedAt, &task.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scanScheduledTasks: %w", err)
		}

		task.Enabled = intToBool(enabled)
		task.Archived = intToBool(archived)
		if lastRunAt.Valid {
			task.LastRunAt = &lastRunAt.Time
		}
		if nextRunAt.Valid {
			task.NextRunAt = &nextRunAt.Time
		}
		tasks = append(tasks, &task)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scanScheduledTasks rows: %w", err)
	}
	return tasks, nil
}

func (s *SQLiteStore) UpdateScheduledTask(ctx context.Context, id string, updates func(*models.ScheduledTask)) error {
	task, err := s.GetScheduledTask(ctx, id)
	if err != nil {
		return err
	}
	if task == nil {
		return fmt.Errorf("UpdateScheduledTask: task %s %w", id, ErrNotFound)
	}
	updates(task)
	task.UpdatedAt = time.Now()

	return RetryDBExec(ctx, "UpdateScheduledTask", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			UPDATE scheduled_tasks SET
				name = ?, description = ?, prompt = ?, model = ?,
				permission_mode = ?, frequency = ?, cron_expression = ?,
				schedule_hour = ?, schedule_minute = ?, schedule_day_of_week = ?, schedule_day_of_month = ?,
				enabled = ?, archived = ?, last_run_at = ?, next_run_at = ?, updated_at = ?
			WHERE id = ?`,
			task.Name, task.Description, task.Prompt, task.Model,
			task.PermissionMode, task.Frequency, task.CronExpression,
			task.ScheduleHour, task.ScheduleMinute, task.ScheduleDayOfWeek, task.ScheduleDayOfMonth,
			boolToInt(task.Enabled), boolToInt(task.Archived), task.LastRunAt, task.NextRunAt, task.UpdatedAt, id)
		return err
	})
}

func (s *SQLiteStore) DeleteScheduledTask(ctx context.Context, id string) error {
	return RetryDBExec(ctx, "DeleteScheduledTask", DefaultRetryConfig(), func(ctx context.Context) error {
		result, err := s.db.ExecContext(ctx, `DELETE FROM scheduled_tasks WHERE id = ?`, id)
		if err != nil {
			return err
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			return fmt.Errorf("DeleteScheduledTask: task %s %w", id, ErrNotFound)
		}
		return nil
	})
}

// ListDueScheduledTasks returns all enabled tasks whose next_run_at is at or before the given time
func (s *SQLiteStore) ListDueScheduledTasks(ctx context.Context, before time.Time) ([]*models.ScheduledTask, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, name, description, prompt, model,
			permission_mode, frequency, cron_expression,
			schedule_hour, schedule_minute, schedule_day_of_week, schedule_day_of_month,
			enabled, archived, last_run_at, next_run_at, created_at, updated_at
		FROM scheduled_tasks
		WHERE enabled = 1 AND archived = 0 AND next_run_at IS NOT NULL AND next_run_at <= ?
		ORDER BY next_run_at ASC`, before)
	if err != nil {
		return nil, fmt.Errorf("ListDueScheduledTasks: %w", err)
	}
	defer rows.Close()
	return s.scanScheduledTasks(rows)
}

// ============================================================================
// Scheduled Task Run methods
// ============================================================================

func (s *SQLiteStore) AddScheduledTaskRun(ctx context.Context, run *models.ScheduledTaskRun) error {
	return RetryDBExec(ctx, "AddScheduledTaskRun", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO scheduled_task_runs (id, scheduled_task_id, session_id, status,
				triggered_at, started_at, completed_at, error_message)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			run.ID, run.ScheduledTaskID, nullString(run.SessionID), run.Status,
			run.TriggeredAt, run.StartedAt, run.CompletedAt, run.ErrorMessage)
		return err
	})
}

func (s *SQLiteStore) ListScheduledTaskRuns(ctx context.Context, taskID string, limit int) ([]*models.ScheduledTaskRun, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, scheduled_task_id, session_id, status,
			triggered_at, started_at, completed_at, error_message
		FROM scheduled_task_runs
		WHERE scheduled_task_id = ?
		ORDER BY triggered_at DESC
		LIMIT ?`, taskID, limit)
	if err != nil {
		return nil, fmt.Errorf("ListScheduledTaskRuns: %w", err)
	}
	defer rows.Close()

	runs := []*models.ScheduledTaskRun{}
	for rows.Next() {
		var run models.ScheduledTaskRun
		var sessionID sql.NullString
		var startedAt, completedAt sql.NullTime

		if err := rows.Scan(
			&run.ID, &run.ScheduledTaskID, &sessionID, &run.Status,
			&run.TriggeredAt, &startedAt, &completedAt, &run.ErrorMessage); err != nil {
			return nil, fmt.Errorf("ListScheduledTaskRuns scan: %w", err)
		}

		if sessionID.Valid {
			run.SessionID = sessionID.String
		}
		if startedAt.Valid {
			run.StartedAt = &startedAt.Time
		}
		if completedAt.Valid {
			run.CompletedAt = &completedAt.Time
		}
		runs = append(runs, &run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ListScheduledTaskRuns rows: %w", err)
	}
	return runs, nil
}

func (s *SQLiteStore) UpdateScheduledTaskRun(ctx context.Context, id string, updates func(*models.ScheduledTaskRun)) error {
	// Fetch current run
	var run models.ScheduledTaskRun
	var sessionID sql.NullString
	var startedAt, completedAt sql.NullTime

	err := s.db.QueryRowContext(ctx, `
		SELECT id, scheduled_task_id, session_id, status,
			triggered_at, started_at, completed_at, error_message
		FROM scheduled_task_runs WHERE id = ?`, id).Scan(
		&run.ID, &run.ScheduledTaskID, &sessionID, &run.Status,
		&run.TriggeredAt, &startedAt, &completedAt, &run.ErrorMessage)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return fmt.Errorf("UpdateScheduledTaskRun fetch: %w", err)
	}
	if sessionID.Valid {
		run.SessionID = sessionID.String
	}
	if startedAt.Valid {
		run.StartedAt = &startedAt.Time
	}
	if completedAt.Valid {
		run.CompletedAt = &completedAt.Time
	}

	updates(&run)

	return RetryDBExec(ctx, "UpdateScheduledTaskRun", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			UPDATE scheduled_task_runs SET
				session_id = ?, status = ?, started_at = ?, completed_at = ?, error_message = ?
			WHERE id = ?`,
			nullString(run.SessionID), run.Status, run.StartedAt, run.CompletedAt, run.ErrorMessage, id)
		return err
	})
}

// ==================== Review Scorecards ====================

func (s *SQLiteStore) CreateReviewScorecard(ctx context.Context, scorecard *models.ReviewScorecard) error {
	return RetryDBExec(ctx, "CreateReviewScorecard", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO review_scorecards (id, session_id, review_type, scores, summary, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			scorecard.ID, scorecard.SessionID, scorecard.ReviewType,
			scorecard.Scores, scorecard.Summary, scorecard.CreatedAt)
		return err
	})
}

func (s *SQLiteStore) ListReviewScorecards(ctx context.Context, sessionID string) ([]*models.ReviewScorecard, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, review_type, scores, summary, created_at
		FROM review_scorecards WHERE session_id = ? ORDER BY created_at DESC`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("ListReviewScorecards: %w", err)
	}
	defer rows.Close()

	var scorecards []*models.ReviewScorecard
	for rows.Next() {
		var sc models.ReviewScorecard
		if err := rows.Scan(&sc.ID, &sc.SessionID, &sc.ReviewType, &sc.Scores, &sc.Summary, &sc.CreatedAt); err != nil {
			return nil, fmt.Errorf("ListReviewScorecards scan: %w", err)
		}
		scorecards = append(scorecards, &sc)
	}
	return scorecards, rows.Err()
}

// GetSpendStats aggregates cost data from message run_summaries over the given period.
// It returns totals, daily breakdown, per-model, and per-workspace cost breakdowns.
func (s *SQLiteStore) GetSpendStats(ctx context.Context, days int) (*models.SpendStats, error) {
	if days <= 0 {
		days = 14
	}

	since := time.Now().AddDate(0, 0, -days)

	rows, err := s.db.QueryContext(ctx, `
		SELECT m.run_summary, c.session_id, s.workspace_id, date(m.timestamp) as day
		FROM messages m
		JOIN conversations c ON m.conversation_id = c.id
		JOIN sessions s ON c.session_id = s.id
		WHERE m.run_summary IS NOT NULL
		  AND m.timestamp >= ?
		ORDER BY m.timestamp
	`, since)
	if err != nil {
		return nil, fmt.Errorf("GetSpendStats query: %w", err)
	}
	defer rows.Close()

	now := time.Now()
	todayStr := now.Format("2006-01-02")
	// Week start = 7 days ago at midnight
	weekStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -6)

	stats := &models.SpendStats{
		ByModel:     make(map[string]float64),
		ByWorkspace: make(map[string]float64),
	}
	dailyMap := make(map[string]float64)

	// Track per-workspace cost by ID; resolve names in a single batch after the loop
	costByWorkspaceID := make(map[string]float64)

	for rows.Next() {
		var runSummaryJSON string
		var sessionID, workspaceID, day string
		if err := rows.Scan(&runSummaryJSON, &sessionID, &workspaceID, &day); err != nil {
			return nil, fmt.Errorf("GetSpendStats scan: %w", err)
		}

		var rs models.RunSummary
		if err := json.Unmarshal([]byte(runSummaryJSON), &rs); err != nil {
			continue // skip malformed entries
		}
		if rs.Cost <= 0 {
			continue
		}

		// Daily breakdown
		dailyMap[day] += rs.Cost

		// Today total
		if day == todayStr {
			stats.TodayTotal += rs.Cost
		}

		// Week total (parse day to check)
		if dayTime, err := time.Parse("2006-01-02", day); err == nil {
			if !dayTime.Before(weekStart) {
				stats.WeekTotal += rs.Cost
			}
		}

		// Per-model breakdown from ModelUsage
		if rs.ModelUsage != nil {
			for model, usage := range rs.ModelUsage {
				if usage.CostUSD > 0 {
					stats.ByModel[model] += usage.CostUSD
				}
			}
		} else if rs.Cost > 0 {
			// Fallback: if no model usage breakdown, attribute to "unknown"
			stats.ByModel["unknown"] += rs.Cost
		}

		costByWorkspaceID[workspaceID] += rs.Cost
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetSpendStats rows: %w", err)
	}

	// Batch-fetch workspace names in a single query
	wsIDs := make([]string, 0, len(costByWorkspaceID))
	for id := range costByWorkspaceID {
		wsIDs = append(wsIDs, id)
	}
	repos, _ := s.GetReposByIDs(ctx, wsIDs)
	for id, cost := range costByWorkspaceID {
		name := id[:8] // truncated ID fallback
		if repo, ok := repos[id]; ok {
			name = repo.Name
		}
		stats.ByWorkspace[name] = cost
	}

	// Build sorted daily breakdown (fill in gaps with zero)
	for i := 0; i < days; i++ {
		d := now.AddDate(0, 0, -days+1+i).Format("2006-01-02")
		stats.DailyBreakdown = append(stats.DailyBreakdown, models.DailySpend{
			Date:  d,
			Total: dailyMap[d],
		})
	}

	return stats, nil
}
