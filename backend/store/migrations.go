package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/chatml/chatml-backend/logger"
)

// Migration represents a single schema migration step.
// Up runs inside a transaction — use the provided *sql.Tx for all operations.
type Migration struct {
	Version     int
	Description string
	Up          func(ctx context.Context, tx *sql.Tx) error
}

// migrations is the ordered list of all schema migrations.
// Migration 0 is the baseline schema (all CREATE TABLE IF NOT EXISTS).
// Subsequent migrations correspond to the incremental ALTER TABLE / CREATE TABLE
// changes that were previously in runMigrations().
//
// Adding a new migration:
//  1. Append a new entry with Version = N+1
//  2. Never modify existing migrations — they may have already run on user databases
var migrations = []Migration{
	{
		Version:     1,
		Description: "Add pr_title column to sessions",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`ALTER TABLE sessions ADD COLUMN pr_title TEXT NOT NULL DEFAULT ''`)
			return ignoreDuplicateColumn(err)
		},
	},
	{
		Version:     2,
		Description: "Add checkpoint_uuid column to messages",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`ALTER TABLE messages ADD COLUMN checkpoint_uuid TEXT DEFAULT NULL`)
			return ignoreDuplicateColumn(err)
		},
	},
	{
		Version:     3,
		Description: "Add resolution_type column to review_comments",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`ALTER TABLE review_comments ADD COLUMN resolution_type TEXT DEFAULT ''`)
			return ignoreDuplicateColumn(err)
		},
	},
	{
		Version:     4,
		Description: "Add session_type column and unique base-session index",
		Up: func(_ context.Context, tx *sql.Tx) error {
			if _, err := tx.Exec(`ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'worktree'`); err != nil {
				if !isDuplicateColumnError(err) {
					return err
				}
			}
			_, err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_base_per_workspace ON sessions(workspace_id) WHERE session_type = 'base'`)
			return err
		},
	},
	{
		Version:     5,
		Description: "Create review_scorecards table",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`CREATE TABLE IF NOT EXISTS review_scorecards (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				review_type TEXT NOT NULL,
				scores TEXT NOT NULL DEFAULT '[]',
				summary TEXT NOT NULL DEFAULT '',
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`)
			return err
		},
	},
	{
		Version:     6,
		Description: "Add scheduled_task_id to sessions and migrate types",
		Up: func(_ context.Context, tx *sql.Tx) error {
			if _, err := tx.Exec(`ALTER TABLE sessions ADD COLUMN scheduled_task_id TEXT DEFAULT NULL`); err != nil {
				if !isDuplicateColumnError(err) {
					return err
				}
			}
			// Migrate existing scheduled-task sessions from 'base' to 'scheduled' type
			_, err := tx.Exec(`UPDATE sessions SET session_type = 'scheduled' WHERE scheduled_task_id IS NOT NULL AND session_type = 'base'`)
			return err
		},
	},
	{
		Version:     7,
		Description: "Create scheduled_tasks and scheduled_task_runs tables",
		Up: func(_ context.Context, tx *sql.Tx) error {
			if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
				id TEXT PRIMARY KEY,
				workspace_id TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				prompt TEXT NOT NULL,
				model TEXT NOT NULL DEFAULT '',
				permission_mode TEXT NOT NULL DEFAULT 'default',
				use_worktree INTEGER NOT NULL DEFAULT 0,
				frequency TEXT NOT NULL DEFAULT 'daily',
				cron_expression TEXT NOT NULL DEFAULT '',
				schedule_hour INTEGER NOT NULL DEFAULT 9,
				schedule_minute INTEGER NOT NULL DEFAULT 0,
				schedule_day_of_week INTEGER NOT NULL DEFAULT 1,
				schedule_day_of_month INTEGER NOT NULL DEFAULT 1,
				enabled INTEGER NOT NULL DEFAULT 1,
				last_run_at DATETIME DEFAULT NULL,
				next_run_at DATETIME DEFAULT NULL,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (workspace_id) REFERENCES repos(id) ON DELETE CASCADE
			)`); err != nil {
				return err
			}
			if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_workspace ON scheduled_tasks(workspace_id)`); err != nil {
				return err
			}
			if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at) WHERE enabled = 1`); err != nil {
				return err
			}
			if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS scheduled_task_runs (
				id TEXT PRIMARY KEY,
				scheduled_task_id TEXT NOT NULL,
				session_id TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				started_at DATETIME DEFAULT NULL,
				completed_at DATETIME DEFAULT NULL,
				error_message TEXT NOT NULL DEFAULT '',
				FOREIGN KEY (scheduled_task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
				FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
			)`); err != nil {
				return err
			}
			if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task ON scheduled_task_runs(scheduled_task_id)`); err != nil {
				return err
			}
			_, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_session ON scheduled_task_runs(session_id)`)
			return err
		},
	},
	{
		Version:     8,
		Description: "Clear deprecated sprint/deploy columns",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE sessions SET sprint_phase = '', sprint_artifacts = '', deploy_status = '' WHERE sprint_phase != '' OR sprint_artifacts != '' OR deploy_status != ''`)
			// Ignore "no such column" errors on fresh installs where these columns
			// were never added. All other errors (disk full, corruption) must propagate.
			if err != nil && !isNoSuchColumnError(err) {
				return err
			}
			return nil
		},
	},
	{
		Version:     9,
		Description: "Default scheduled task permission_mode to bypassPermissions",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE scheduled_tasks SET permission_mode = 'bypassPermissions' WHERE permission_mode IN ('default', '', 'acceptEdits')`)
			return err
		},
	},
	{
		Version:     10,
		Description: "Add archived column to scheduled_tasks",
		Up: func(_ context.Context, tx *sql.Tx) error {
			_, err := tx.Exec(`ALTER TABLE scheduled_tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`)
			return err
		},
	},
}

// RunMigrations ensures the schema_version table exists, applies the baseline
// schema if needed, and then runs any pending migrations in order.
// Each migration runs inside a transaction so partial failures don't leave
// the schema in an inconsistent state (SQLite supports transactional DDL).
func RunMigrations(ctx context.Context, db *sql.DB) error {
	// Create the version tracking table.
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("create schema_version table: %w", err)
	}

	// Read current version.
	currentVersion := 0
	row := db.QueryRowContext(ctx, `SELECT version FROM schema_version LIMIT 1`)
	if err := row.Scan(&currentVersion); err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read schema version: %w", err)
	}

	// Apply pending migrations, each wrapped in a transaction.
	applied := 0
	for _, m := range migrations {
		if m.Version <= currentVersion {
			continue
		}

		logger.SQLite.Infof("Running migration %d: %s", m.Version, m.Description)

		if err := runMigrationInTx(ctx, db, m); err != nil {
			return fmt.Errorf("migration %d (%s) failed: %w", m.Version, m.Description, err)
		}

		applied++
	}

	if applied > 0 {
		logger.SQLite.Infof("Applied %d migration(s), schema at version %d", applied, migrations[len(migrations)-1].Version)
	}

	return nil
}

// runMigrationInTx executes a single migration and its version bump inside a transaction.
func runMigrationInTx(ctx context.Context, db *sql.DB, m Migration) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() // no-op after Commit

	if err := m.Up(ctx, tx); err != nil {
		return err
	}

	// Update version atomically with the migration.
	if _, err := tx.ExecContext(ctx, `DELETE FROM schema_version`); err != nil {
		return fmt.Errorf("clear schema_version: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_version (version) VALUES (?)`, m.Version); err != nil {
		return fmt.Errorf("update schema_version to %d: %w", m.Version, err)
	}

	return tx.Commit()
}

// isDuplicateColumnError returns true if the error is a "duplicate column" SQLite error.
func isDuplicateColumnError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "duplicate column") || strings.Contains(s, "already exists")
}

// isNoSuchColumnError returns true if the error is a "no such column" SQLite error.
func isNoSuchColumnError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such column")
}

// ignoreDuplicateColumn returns nil if the error is a duplicate column error.
func ignoreDuplicateColumn(err error) error {
	if isDuplicateColumnError(err) {
		return nil
	}
	return err
}
