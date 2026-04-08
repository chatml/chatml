package store

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(1)")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return db
}

func TestRunMigrations_FreshDB(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// Create the baseline schema first (simulates initSchema).
	// On a fresh install, RunMigrations should seed the version to latest
	// without running any individual migrations.
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		branch TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'idle'
	)`)
	require.NoError(t, err)

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL
	)`)
	require.NoError(t, err)

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS review_comments (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		content TEXT NOT NULL
	)`)
	require.NoError(t, err)

	err = RunMigrations(ctx, db)
	require.NoError(t, err)

	// Verify schema_version was created and set to latest
	var version int
	err = db.QueryRow(`SELECT version FROM schema_version`).Scan(&version)
	require.NoError(t, err)
	assert.Equal(t, migrations[len(migrations)-1].Version, version)
}

func TestRunMigrations_Idempotent(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// Minimal schema for migrations to work against
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, branch TEXT DEFAULT '', status TEXT DEFAULT 'idle')`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT)`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS review_comments (id TEXT PRIMARY KEY, session_id TEXT, content TEXT)`)

	// Run migrations twice — should not error
	require.NoError(t, RunMigrations(ctx, db))
	require.NoError(t, RunMigrations(ctx, db))

	// Version should be at latest
	var version int
	require.NoError(t, db.QueryRow(`SELECT version FROM schema_version`).Scan(&version))
	assert.Equal(t, len(migrations), version)
}

func TestRunMigrations_PartialRun(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// Minimal schema
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, branch TEXT DEFAULT '', status TEXT DEFAULT 'idle')`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT)`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS review_comments (id TEXT PRIMARY KEY, session_id TEXT, content TEXT)`)

	// Simulate already being at version 3
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`)
	_, _ = db.Exec(`INSERT INTO schema_version (version) VALUES (3)`)

	// Run — should only apply migrations 4+
	require.NoError(t, RunMigrations(ctx, db))

	var version int
	require.NoError(t, db.QueryRow(`SELECT version FROM schema_version`).Scan(&version))
	assert.Equal(t, len(migrations), version)
}

func TestRunMigrations_VersionTrackingConsistent(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, branch TEXT DEFAULT '', status TEXT DEFAULT 'idle')`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT)`)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS review_comments (id TEXT PRIMARY KEY, session_id TEXT, content TEXT)`)

	require.NoError(t, RunMigrations(ctx, db))

	// Verify only one row in schema_version
	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM schema_version`).Scan(&count))
	assert.Equal(t, 1, count)
}
