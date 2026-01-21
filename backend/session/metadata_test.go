package session

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteAndReadMetadata(t *testing.T) {
	// Override SessionsDir to use a temp directory
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	testHome := tmpDir
	t.Setenv("HOME", testHome)

	// Create metadata
	now := time.Now().Truncate(time.Second) // Truncate for comparison
	meta := &Metadata{
		ID:            "test-session-id",
		Name:          "tokyo",
		WorkspaceID:   "workspace-123",
		WorkspacePath: "/path/to/repo",
		WorktreePath:  "/path/to/worktree",
		Branch:        "session/tokyo",
		BaseCommitSHA: "abc123def456",
		CreatedAt:     now,
		Task:          "Fix the bug",
	}

	// Write metadata
	if err := WriteMetadata(meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	// Verify file exists in the correct location
	expectedPath := filepath.Join(testHome, ".chatml", "sessions", "test-session-id.json")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Errorf("metadata file not created at %s", expectedPath)
	}

	// Read metadata back
	readMeta, err := ReadMetadata("test-session-id")
	if err != nil {
		t.Fatalf("ReadMetadata failed: %v", err)
	}

	// Verify all fields
	if readMeta.Version != MetadataVersion {
		t.Errorf("Version mismatch: got %d, want %d", readMeta.Version, MetadataVersion)
	}
	if readMeta.ID != meta.ID {
		t.Errorf("ID mismatch: got %q, want %q", readMeta.ID, meta.ID)
	}
	if readMeta.Name != meta.Name {
		t.Errorf("Name mismatch: got %q, want %q", readMeta.Name, meta.Name)
	}
	if readMeta.WorkspaceID != meta.WorkspaceID {
		t.Errorf("WorkspaceID mismatch: got %q, want %q", readMeta.WorkspaceID, meta.WorkspaceID)
	}
	if readMeta.WorkspacePath != meta.WorkspacePath {
		t.Errorf("WorkspacePath mismatch: got %q, want %q", readMeta.WorkspacePath, meta.WorkspacePath)
	}
	if readMeta.WorktreePath != meta.WorktreePath {
		t.Errorf("WorktreePath mismatch: got %q, want %q", readMeta.WorktreePath, meta.WorktreePath)
	}
	if readMeta.Branch != meta.Branch {
		t.Errorf("Branch mismatch: got %q, want %q", readMeta.Branch, meta.Branch)
	}
	if readMeta.BaseCommitSHA != meta.BaseCommitSHA {
		t.Errorf("BaseCommitSHA mismatch: got %q, want %q", readMeta.BaseCommitSHA, meta.BaseCommitSHA)
	}
	if !readMeta.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt mismatch: got %v, want %v", readMeta.CreatedAt, now)
	}
	if readMeta.Task != meta.Task {
		t.Errorf("Task mismatch: got %q, want %q", readMeta.Task, meta.Task)
	}
}

func TestWriteMetadata_SetsVersion(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	t.Setenv("HOME", tmpDir)

	// Create metadata without version
	meta := &Metadata{
		ID:   "test-id",
		Name: "london",
	}

	if err := WriteMetadata(meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	readMeta, err := ReadMetadata("test-id")
	if err != nil {
		t.Fatalf("ReadMetadata failed: %v", err)
	}

	if readMeta.Version != MetadataVersion {
		t.Errorf("Version should be set to %d, got %d", MetadataVersion, readMeta.Version)
	}
}

func TestReadMetadata_MissingFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	t.Setenv("HOME", tmpDir)

	_, err = ReadMetadata("nonexistent-id")
	if err == nil {
		t.Error("ReadMetadata should fail for missing file")
	}
}

func TestReadMetadata_CorruptFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	t.Setenv("HOME", tmpDir)

	// Create sessions directory and write corrupt JSON
	sessionsDir := filepath.Join(tmpDir, ".chatml", "sessions")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("failed to create sessions dir: %v", err)
	}
	filePath := filepath.Join(sessionsDir, "corrupt-id.json")
	if err := os.WriteFile(filePath, []byte("not valid json{"), 0644); err != nil {
		t.Fatalf("failed to write corrupt file: %v", err)
	}

	_, err = ReadMetadata("corrupt-id")
	if err == nil {
		t.Error("ReadMetadata should fail for corrupt file")
	}
}

func TestDeleteMetadata(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	t.Setenv("HOME", tmpDir)

	// Write metadata first
	meta := &Metadata{ID: "test-delete", Name: "paris"}
	if err := WriteMetadata(meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	// Delete it
	if err := DeleteMetadata("test-delete"); err != nil {
		t.Fatalf("DeleteMetadata failed: %v", err)
	}

	// Verify file is gone
	filePath := filepath.Join(tmpDir, ".chatml", "sessions", "test-delete.json")
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Error("metadata file should be deleted")
	}
}

func TestDeleteMetadata_MissingFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	t.Setenv("HOME", tmpDir)

	// Should not error when file doesn't exist
	if err := DeleteMetadata("nonexistent-id"); err != nil {
		t.Errorf("DeleteMetadata should not error for missing file: %v", err)
	}
}

func TestMetadataExists(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Temporarily override the home directory using t.Setenv (auto-restores after test)
	t.Setenv("HOME", tmpDir)

	// Should not exist initially
	if MetadataExists("test-exists") {
		t.Error("MetadataExists should return false for missing file")
	}

	// Write metadata
	meta := &Metadata{ID: "test-exists", Name: "berlin"}
	if err := WriteMetadata(meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	// Should exist now
	if !MetadataExists("test-exists") {
		t.Error("MetadataExists should return true after writing")
	}
}

func TestValidateSessionID(t *testing.T) {
	tests := []struct {
		name      string
		sessionID string
		wantErr   bool
	}{
		{"valid UUID-like", "abc123-def456-789", false},
		{"valid alphanumeric", "session123", false},
		{"valid with underscores", "test_session_id", false},
		{"valid with hyphens", "test-session-id", false},
		{"valid mixed", "Test_Session-123", false},
		{"empty string", "", true},
		{"contains slash", "session/id", true},
		{"contains backslash", "session\\id", true},
		{"contains dot", "session.id", true},
		{"contains space", "session id", true},
		{"contains colon", "session:id", true},
		{"path traversal attempt", "../etc/passwd", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSessionID(tt.sessionID)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateSessionID(%q) error = %v, wantErr %v", tt.sessionID, err, tt.wantErr)
			}
		})
	}
}

func TestWriteMetadata_InvalidSessionID(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)
	t.Setenv("HOME", tmpDir)

	// Try to write with invalid session ID
	meta := &Metadata{ID: "../malicious", Name: "test"}
	if err := WriteMetadata(meta); err == nil {
		t.Error("WriteMetadata should fail for invalid session ID")
	}
}
