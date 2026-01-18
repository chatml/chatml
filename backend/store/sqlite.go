package store

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/chatml/chatml-backend/models"
	_ "modernc.org/sqlite"
)

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

func (s *SQLiteStore) AddRepo(repo *models.Repo) {
	_, err := s.db.Exec(`
		INSERT INTO repos (id, name, path, branch, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, branch=excluded.branch`,
		repo.ID, repo.Name, repo.Path, repo.Branch, repo.CreatedAt)
	if err != nil {
		log.Printf("[sqlite] AddRepo error: %v", err)
	}
}

func (s *SQLiteStore) GetRepo(id string) *models.Repo {
	var repo models.Repo
	err := s.db.QueryRow(`
		SELECT id, name, path, branch, created_at
		FROM repos WHERE id = ?`, id).Scan(
		&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.CreatedAt)
	if err != nil {
		return nil
	}
	return &repo
}

func (s *SQLiteStore) ListRepos() []*models.Repo {
	rows, err := s.db.Query(`SELECT id, name, path, branch, created_at FROM repos`)
	if err != nil {
		log.Printf("[sqlite] ListRepos error: %v", err)
		return []*models.Repo{}
	}
	defer rows.Close()

	repos := []*models.Repo{}
	for rows.Next() {
		var repo models.Repo
		if err := rows.Scan(&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.CreatedAt); err != nil {
			log.Printf("[sqlite] ListRepos scan error: %v", err)
			continue
		}
		repos = append(repos, &repo)
	}
	return repos
}

func (s *SQLiteStore) GetRepoByPath(path string) *models.Repo {
	var repo models.Repo
	err := s.db.QueryRow(`
		SELECT id, name, path, branch, created_at
		FROM repos WHERE path = ?`, path).Scan(
		&repo.ID, &repo.Name, &repo.Path, &repo.Branch, &repo.CreatedAt)
	if err != nil {
		return nil
	}
	return &repo
}

func (s *SQLiteStore) DeleteRepo(id string) {
	_, err := s.db.Exec(`DELETE FROM repos WHERE id = ?`, id)
	if err != nil {
		log.Printf("[sqlite] DeleteRepo error: %v", err)
	}
}

// ============================================================================
// Session methods
// ============================================================================

func (s *SQLiteStore) AddSession(session *models.Session) {
	statsAdditions, statsDeletions := 0, 0
	if session.Stats != nil {
		statsAdditions = session.Stats.Additions
		statsDeletions = session.Stats.Deletions
	}

	_, err := s.db.Exec(`
		INSERT INTO sessions (id, workspace_id, name, branch, worktree_path, task,
			status, agent_id, pr_status, pr_url, pr_number, has_merge_conflict,
			has_check_failures, stats_additions, stats_deletions, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		session.ID, session.WorkspaceID, session.Name, session.Branch,
		session.WorktreePath, session.Task, session.Status, session.AgentID,
		session.PRStatus, session.PRUrl, session.PRNumber,
		boolToInt(session.HasMergeConflict), boolToInt(session.HasCheckFailures),
		statsAdditions, statsDeletions, session.CreatedAt, session.UpdatedAt)
	if err != nil {
		log.Printf("[sqlite] AddSession error: %v", err)
	}
}

func (s *SQLiteStore) GetSession(id string) *models.Session {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions int
	var agentID sql.NullString

	err := s.db.QueryRow(`
		SELECT id, workspace_id, name, branch, worktree_path, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		return nil
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	if agentID.Valid {
		session.AgentID = agentID.String
	}
	if statsAdditions > 0 || statsDeletions > 0 {
		session.Stats = &models.SessionStats{
			Additions: statsAdditions,
			Deletions: statsDeletions,
		}
	}

	return &session
}

func (s *SQLiteStore) ListSessions(workspaceID string) []*models.Session {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, branch, worktree_path, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, created_at, updated_at
		FROM sessions WHERE workspace_id = ?`, workspaceID)
	if err != nil {
		log.Printf("[sqlite] ListSessions error: %v", err)
		return []*models.Session{}
	}
	defer rows.Close()

	sessions := []*models.Session{}
	for rows.Next() {
		var session models.Session
		var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions int
		var agentID sql.NullString

		if err := rows.Scan(
			&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
			&session.WorktreePath, &session.Task, &session.Status, &agentID,
			&session.PRStatus, &session.PRUrl, &session.PRNumber,
			&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
			&session.CreatedAt, &session.UpdatedAt); err != nil {
			log.Printf("[sqlite] ListSessions scan error: %v", err)
			continue
		}

		session.HasMergeConflict = intToBool(hasMergeConflict)
		session.HasCheckFailures = intToBool(hasCheckFailures)
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
	return sessions
}

func (s *SQLiteStore) UpdateSession(id string, updates func(*models.Session)) {
	// Read current state
	session := s.getSessionNoLock(id)
	if session == nil {
		return
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

	_, err := s.db.Exec(`
		UPDATE sessions SET
			name = ?, branch = ?, worktree_path = ?, task = ?,
			status = ?, agent_id = ?, pr_status = ?, pr_url = ?,
			pr_number = ?, has_merge_conflict = ?, has_check_failures = ?,
			stats_additions = ?, stats_deletions = ?, updated_at = ?
		WHERE id = ?`,
		session.Name, session.Branch, session.WorktreePath, session.Task,
		session.Status, session.AgentID, session.PRStatus, session.PRUrl,
		session.PRNumber, boolToInt(session.HasMergeConflict),
		boolToInt(session.HasCheckFailures),
		statsAdditions, statsDeletions, session.UpdatedAt, id)
	if err != nil {
		log.Printf("[sqlite] UpdateSession error: %v", err)
	}
}

func (s *SQLiteStore) getSessionNoLock(id string) *models.Session {
	var session models.Session
	var hasMergeConflict, hasCheckFailures, statsAdditions, statsDeletions int
	var agentID sql.NullString

	err := s.db.QueryRow(`
		SELECT id, workspace_id, name, branch, worktree_path, task, status, agent_id,
			pr_status, pr_url, pr_number, has_merge_conflict, has_check_failures,
			stats_additions, stats_deletions, created_at, updated_at
		FROM sessions WHERE id = ?`, id).Scan(
		&session.ID, &session.WorkspaceID, &session.Name, &session.Branch,
		&session.WorktreePath, &session.Task, &session.Status, &agentID,
		&session.PRStatus, &session.PRUrl, &session.PRNumber,
		&hasMergeConflict, &hasCheckFailures, &statsAdditions, &statsDeletions,
		&session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		return nil
	}

	session.HasMergeConflict = intToBool(hasMergeConflict)
	session.HasCheckFailures = intToBool(hasCheckFailures)
	if agentID.Valid {
		session.AgentID = agentID.String
	}
	if statsAdditions > 0 || statsDeletions > 0 {
		session.Stats = &models.SessionStats{
			Additions: statsAdditions,
			Deletions: statsDeletions,
		}
	}

	return &session
}

func (s *SQLiteStore) DeleteSession(id string) {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	if err != nil {
		log.Printf("[sqlite] DeleteSession error: %v", err)
	}
}

// ============================================================================
// Agent methods
// ============================================================================

func (s *SQLiteStore) AddAgent(agent *models.Agent) {
	_, err := s.db.Exec(`
		INSERT INTO agents (id, repo_id, task, status, worktree, branch, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		agent.ID, agent.RepoID, agent.Task, agent.Status,
		agent.Worktree, agent.Branch, agent.CreatedAt)
	if err != nil {
		log.Printf("[sqlite] AddAgent error: %v", err)
	}
}

func (s *SQLiteStore) GetAgent(id string) *models.Agent {
	var agent models.Agent
	err := s.db.QueryRow(`
		SELECT id, repo_id, task, status, worktree, branch, created_at
		FROM agents WHERE id = ?`, id).Scan(
		&agent.ID, &agent.RepoID, &agent.Task, &agent.Status,
		&agent.Worktree, &agent.Branch, &agent.CreatedAt)
	if err != nil {
		return nil
	}
	return &agent
}

func (s *SQLiteStore) ListAgents(repoID string) []*models.Agent {
	rows, err := s.db.Query(`
		SELECT id, repo_id, task, status, worktree, branch, created_at
		FROM agents WHERE repo_id = ?`, repoID)
	if err != nil {
		log.Printf("[sqlite] ListAgents error: %v", err)
		return []*models.Agent{}
	}
	defer rows.Close()

	agents := []*models.Agent{}
	for rows.Next() {
		var agent models.Agent
		if err := rows.Scan(&agent.ID, &agent.RepoID, &agent.Task, &agent.Status,
			&agent.Worktree, &agent.Branch, &agent.CreatedAt); err != nil {
			log.Printf("[sqlite] ListAgents scan error: %v", err)
			continue
		}
		agents = append(agents, &agent)
	}
	return agents
}

func (s *SQLiteStore) UpdateAgentStatus(id string, status models.AgentStatus) {
	_, err := s.db.Exec(`UPDATE agents SET status = ? WHERE id = ?`, string(status), id)
	if err != nil {
		log.Printf("[sqlite] UpdateAgentStatus error: %v", err)
	}
}

func (s *SQLiteStore) DeleteAgent(id string) {
	_, err := s.db.Exec(`DELETE FROM agents WHERE id = ?`, id)
	if err != nil {
		log.Printf("[sqlite] DeleteAgent error: %v", err)
	}
}

// ============================================================================
// Conversation methods
// ============================================================================

func (s *SQLiteStore) AddConversation(conv *models.Conversation) {
	_, err := s.db.Exec(`
		INSERT INTO conversations (id, session_id, type, name, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		conv.ID, conv.SessionID, conv.Type, conv.Name,
		conv.Status, conv.CreatedAt, conv.UpdatedAt)
	if err != nil {
		log.Printf("[sqlite] AddConversation error: %v", err)
	}
}

func (s *SQLiteStore) GetConversation(id string) *models.Conversation {
	var conv models.Conversation
	err := s.db.QueryRow(`
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.CreatedAt, &conv.UpdatedAt)
	if err != nil {
		return nil
	}

	// Initialize slices to empty (not nil) so JSON serializes as [] not null
	conv.Messages = []models.Message{}
	conv.ToolSummary = []models.ToolAction{}

	// Load messages
	rows, err := s.db.Query(`
		SELECT id, role, content, setup_info, timestamp
		FROM messages
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var msg models.Message
			var setupInfoJSON sql.NullString
			if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &msg.Timestamp); err == nil {
				if setupInfoJSON.Valid {
					var setupInfo models.SetupInfo
					if json.Unmarshal([]byte(setupInfoJSON.String), &setupInfo) == nil {
						msg.SetupInfo = &setupInfo
					}
				}
				conv.Messages = append(conv.Messages, msg)
			}
		}
	}

	// Load tool actions
	rows, err = s.db.Query(`
		SELECT id, tool, target, success
		FROM tool_actions
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var action models.ToolAction
			var success int
			if err := rows.Scan(&action.ID, &action.Tool, &action.Target, &success); err == nil {
				action.Success = intToBool(success)
				conv.ToolSummary = append(conv.ToolSummary, action)
			}
		}
	}

	return &conv
}

func (s *SQLiteStore) ListConversations(sessionID string) []*models.Conversation {
	rows, err := s.db.Query(`
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE session_id = ?`, sessionID)
	if err != nil {
		log.Printf("[sqlite] ListConversations error: %v", err)
		return []*models.Conversation{}
	}
	defer rows.Close()

	convs := []*models.Conversation{}
	for rows.Next() {
		var conv models.Conversation
		if err := rows.Scan(&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
			&conv.Status, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
			log.Printf("[sqlite] ListConversations scan error: %v", err)
			continue
		}

		// Initialize slices to empty (not nil) so JSON serializes as [] not null
		conv.Messages = []models.Message{}
		conv.ToolSummary = []models.ToolAction{}

		// Load messages for this conversation
		msgRows, err := s.db.Query(`
			SELECT id, role, content, setup_info, timestamp
			FROM messages
			WHERE conversation_id = ?
			ORDER BY position`, conv.ID)
		if err == nil {
			for msgRows.Next() {
				var msg models.Message
				var setupInfoJSON sql.NullString
				if err := msgRows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &msg.Timestamp); err == nil {
					if setupInfoJSON.Valid {
						var setupInfo models.SetupInfo
						if json.Unmarshal([]byte(setupInfoJSON.String), &setupInfo) == nil {
							msg.SetupInfo = &setupInfo
						}
					}
					conv.Messages = append(conv.Messages, msg)
				}
			}
			msgRows.Close()
		}

		// Load tool actions for this conversation
		toolRows, err := s.db.Query(`
			SELECT id, tool, target, success
			FROM tool_actions
			WHERE conversation_id = ?
			ORDER BY position`, conv.ID)
		if err == nil {
			for toolRows.Next() {
				var action models.ToolAction
				var success int
				if err := toolRows.Scan(&action.ID, &action.Tool, &action.Target, &success); err == nil {
					action.Success = intToBool(success)
					conv.ToolSummary = append(conv.ToolSummary, action)
				}
			}
			toolRows.Close()
		}

		convs = append(convs, &conv)
	}
	return convs
}

func (s *SQLiteStore) UpdateConversation(id string, updates func(*models.Conversation)) {
	// Read current state
	conv := s.getConversationNoLock(id)
	if conv == nil {
		return
	}

	// Apply updates
	updates(conv)
	conv.UpdatedAt = time.Now()

	// Write back (only conversation table, not messages/tools)
	_, err := s.db.Exec(`
		UPDATE conversations SET
			type = ?, name = ?, status = ?, updated_at = ?
		WHERE id = ?`,
		conv.Type, conv.Name, conv.Status, conv.UpdatedAt, id)
	if err != nil {
		log.Printf("[sqlite] UpdateConversation error: %v", err)
	}
}

func (s *SQLiteStore) getConversationNoLock(id string) *models.Conversation {
	var conv models.Conversation
	err := s.db.QueryRow(`
		SELECT id, session_id, type, name, status, created_at, updated_at
		FROM conversations WHERE id = ?`, id).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.CreatedAt, &conv.UpdatedAt)
	if err != nil {
		return nil
	}

	// Initialize slices to empty (not nil) so JSON serializes as [] not null
	conv.Messages = []models.Message{}
	conv.ToolSummary = []models.ToolAction{}

	// Load messages
	rows, err := s.db.Query(`
		SELECT id, role, content, setup_info, timestamp
		FROM messages
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var msg models.Message
			var setupInfoJSON sql.NullString
			if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &setupInfoJSON, &msg.Timestamp); err == nil {
				if setupInfoJSON.Valid {
					var setupInfo models.SetupInfo
					if json.Unmarshal([]byte(setupInfoJSON.String), &setupInfo) == nil {
						msg.SetupInfo = &setupInfo
					}
				}
				conv.Messages = append(conv.Messages, msg)
			}
		}
	}

	// Load tool actions
	rows, err = s.db.Query(`
		SELECT id, tool, target, success
		FROM tool_actions
		WHERE conversation_id = ?
		ORDER BY position`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var action models.ToolAction
			var success int
			if err := rows.Scan(&action.ID, &action.Tool, &action.Target, &success); err == nil {
				action.Success = intToBool(success)
				conv.ToolSummary = append(conv.ToolSummary, action)
			}
		}
	}

	return &conv
}

func (s *SQLiteStore) DeleteConversation(id string) {
	_, err := s.db.Exec(`DELETE FROM conversations WHERE id = ?`, id)
	if err != nil {
		log.Printf("[sqlite] DeleteConversation error: %v", err)
	}
}

func (s *SQLiteStore) AddMessageToConversation(convID string, msg models.Message) {
	// Get next position
	var maxPos sql.NullInt64
	s.db.QueryRow(`SELECT MAX(position) FROM messages WHERE conversation_id = ?`, convID).Scan(&maxPos)
	nextPos := 0
	if maxPos.Valid {
		nextPos = int(maxPos.Int64) + 1
	}

	// Serialize setupInfo if present
	var setupInfoJSON sql.NullString
	if msg.SetupInfo != nil {
		data, err := json.Marshal(msg.SetupInfo)
		if err == nil {
			setupInfoJSON = sql.NullString{String: string(data), Valid: true}
		}
	}

	_, err := s.db.Exec(`
		INSERT INTO messages (id, conversation_id, role, content, setup_info, timestamp, position)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		msg.ID, convID, msg.Role, msg.Content, setupInfoJSON, msg.Timestamp, nextPos)
	if err != nil {
		log.Printf("[sqlite] AddMessageToConversation error: %v", err)
	}
}

func (s *SQLiteStore) AddToolActionToConversation(convID string, action models.ToolAction) {
	// Get next position
	var maxPos sql.NullInt64
	s.db.QueryRow(`SELECT MAX(position) FROM tool_actions WHERE conversation_id = ?`, convID).Scan(&maxPos)
	nextPos := 0
	if maxPos.Valid {
		nextPos = int(maxPos.Int64) + 1
	}

	_, err := s.db.Exec(`
		INSERT INTO tool_actions (id, conversation_id, tool, target, success, position)
		VALUES (?, ?, ?, ?, ?, ?)`,
		action.ID, convID, action.Tool, action.Target, boolToInt(action.Success), nextPos)
	if err != nil {
		log.Printf("[sqlite] AddToolActionToConversation error: %v", err)
	}
}
