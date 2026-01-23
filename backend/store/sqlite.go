package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

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

	log.Printf("[sqlite] Opening database at %s", dbPath)

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

	log.Printf("[sqlite] Schema initialized")
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
		log.Printf("[sqlite] Migration: Added setup_info column to messages")
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
		log.Printf("[sqlite] Migration: Added pinned column to sessions")
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
		log.Printf("[sqlite] Migration: Added run_summary column to messages")
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
		log.Printf("[sqlite] Migration: Added base_commit_sha column to sessions")
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
	log.Printf("[sqlite] Migration: file_tabs table ready")

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
	log.Printf("[sqlite] Migration: orchestrator_agents table ready")

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
	log.Printf("[sqlite] Migration: agent_runs table ready")

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
	log.Printf("[sqlite] Migration: review_comments table ready")

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
	statsAdditions, statsDeletions := 0, 0
	if session.Stats != nil {
		statsAdditions = session.Stats.Additions
		statsDeletions = session.Stats.Deletions
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (id, workspace_id, name, branch, worktree_path, base_commit_sha, task,
			status, agent_id, pr_status, pr_url, pr_number, has_merge_conflict,
			has_check_failures, stats_additions, stats_deletions, pinned, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		session.ID, session.WorkspaceID, session.Name, session.Branch,
		session.WorktreePath, session.BaseCommitSHA, session.Task, session.Status, session.AgentID,
		session.PRStatus, session.PRUrl, session.PRNumber,
		boolToInt(session.HasMergeConflict), boolToInt(session.HasCheckFailures),
		statsAdditions, statsDeletions, boolToInt(session.Pinned),
		session.CreatedAt, session.UpdatedAt)
	if err != nil {
		return fmt.Errorf("AddSession: %w", err)
	}
	return nil
}

func (s *SQLiteStore) GetSession(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned int
	var agentID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &session.CreatedAt, &session.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSession: %w", err)
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	session.Pinned = intToBool(pinned)
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

func (s *SQLiteStore) ListSessions(ctx context.Context, workspaceID string) ([]*models.Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, created_at, updated_at
		FROM sessions WHERE workspace_id = ?
		ORDER BY pinned DESC, created_at DESC`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("ListSessions: %w", err)
	}
	defer rows.Close()

	sessions := []*models.Session{}
	for rows.Next() {
		var session models.Session
		var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned int
		var agentID sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber,
			&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
			&pinned, &session.CreatedAt, &session.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListSessions scan: %w", err)
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
		session.Pinned = intToBool(pinned)
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

func (s *SQLiteStore) UpdateSession(ctx context.Context, id string, updates func(*models.Session)) error {
	// Read current state
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

	// Write back
	statsAdditions, statsDeletions := 0, 0
	if session.Stats != nil {
		statsAdditions = session.Stats.Additions
		statsDeletions = session.Stats.Deletions
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE sessions SET
			name = ?, branch = ?, worktree_path = ?, task = ?,
			status = ?, agent_id = ?, pr_status = ?, pr_url = ?,
			pr_number = ?, has_merge_conflict = ?, has_check_failures = ?,
			stats_additions = ?, stats_deletions = ?, pinned = ?, updated_at = ?
		WHERE id = ?`,
		session.Name, session.Branch, session.WorktreePath, session.Task,
		session.Status, session.AgentID, session.PRStatus, session.PRUrl,
		session.PRNumber, boolToInt(session.HasMergeConflict),
		boolToInt(session.HasCheckFailures),
		statsAdditions, statsDeletions, boolToInt(session.Pinned),
		session.UpdatedAt, id)
	if err != nil {
		return fmt.Errorf("UpdateSession: %w", err)
	}
	return nil
}

func (s *SQLiteStore) getSessionNoLock(ctx context.Context, id string) (*models.Session, error) {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions, pinned int
	var agentID sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, name, branch, worktree_path, base_commit_sha, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, pinned, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.BaseCommitSHA, &session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&pinned, &session.CreatedAt, &session.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getSessionNoLock: %w", err)
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	session.Pinned = intToBool(pinned)
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
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO conversations (id, session_id, type, name, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		conv.ID, conv.SessionID, conv.Type, conv.Name,
		conv.Status, conv.CreatedAt, conv.UpdatedAt)
	if err != nil {
		return fmt.Errorf("AddConversation: %w", err)
	}
	return nil
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
		conv.Messages = append(conv.Messages, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetConversation messages rows: %w", err)
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
			conv.Messages = append(conv.Messages, msg)
		}
	}
	return rows.Err()
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
		conv.Messages = append(conv.Messages, msg)
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
	// Get next position
	var maxPos sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT MAX(position) FROM messages WHERE conversation_id = ?`, convID).Scan(&maxPos); err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("AddMessageToConversation get position: %w", err)
	}
	nextPos := 0
	if maxPos.Valid {
		nextPos = int(maxPos.Int64) + 1
	}

	// Serialize setupInfo if present
	var setupInfoJSON sql.NullString
	if msg.SetupInfo != nil {
		data, err := json.Marshal(msg.SetupInfo)
		if err != nil {
			return fmt.Errorf("AddMessageToConversation marshal setupInfo: %w", err)
		}
		setupInfoJSON = sql.NullString{String: string(data), Valid: true}
	}

	// Serialize runSummary if present
	var runSummaryJSON sql.NullString
	if msg.RunSummary != nil {
		data, err := json.Marshal(msg.RunSummary)
		if err != nil {
			return fmt.Errorf("AddMessageToConversation marshal runSummary: %w", err)
		}
		runSummaryJSON = sql.NullString{String: string(data), Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO messages (id, conversation_id, role, content, setup_info, run_summary, timestamp, position)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		msg.ID, convID, msg.Role, msg.Content, setupInfoJSON, runSummaryJSON, msg.Timestamp, nextPos)
	if err != nil {
		return fmt.Errorf("AddMessageToConversation: %w", err)
	}
	return nil
}

func (s *SQLiteStore) AddToolActionToConversation(ctx context.Context, convID string, action models.ToolAction) error {
	// Get next position
	var maxPos sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT MAX(position) FROM tool_actions WHERE conversation_id = ?`, convID).Scan(&maxPos); err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("AddToolActionToConversation get position: %w", err)
	}
	nextPos := 0
	if maxPos.Valid {
		nextPos = int(maxPos.Int64) + 1
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO tool_actions (id, conversation_id, tool, target, success, position)
		VALUES (?, ?, ?, ?, ?, ?)`,
		action.ID, convID, action.Tool, action.Target, boolToInt(action.Success), nextPos)
	if err != nil {
		return fmt.Errorf("AddToolActionToConversation: %w", err)
	}
	return nil
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("SaveFileTabs begin: %w", err)
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
		return fmt.Errorf("SaveFileTabs delete: %w", err)
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
		return fmt.Errorf("SaveFileTabs prepare: %w", err)
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
			return fmt.Errorf("SaveFileTabs upsert: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("SaveFileTabs commit: %w", err)
	}
	return nil
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
