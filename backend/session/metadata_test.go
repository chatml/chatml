package session

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteAndReadMetadata(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create metadata
	now := time.Now().Truncate(time.Second) // Truncate for comparison
	meta := &Metadata{
		ID:            "test-session-id",
		Name:          "tokyo",
		WorkspaceID:   "workspace-123",
		WorkspacePath: "/path/to/repo",
		Branch:        "session/tokyo",
		BaseCommitSHA: "abc123def456",
		CreatedAt:     now,
		Task:          "Fix the bug",
	}

	// Write metadata
	if err := WriteMetadata(tmpDir, meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	// Verify file exists with correct name (hidden)
	filePath := filepath.Join(tmpDir, MetadataFileName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		t.Errorf("metadata file not created at %s", filePath)
	}

	// Read metadata back
	readMeta, err := ReadMetadata(tmpDir)
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

	// Create metadata without version
	meta := &Metadata{
		ID:   "test-id",
		Name: "london",
	}

	if err := WriteMetadata(tmpDir, meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	readMeta, err := ReadMetadata(tmpDir)
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

	_, err = ReadMetadata(tmpDir)
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

	// Write corrupt JSON
	filePath := filepath.Join(tmpDir, MetadataFileName)
	if err := os.WriteFile(filePath, []byte("not valid json{"), 0644); err != nil {
		t.Fatalf("failed to write corrupt file: %v", err)
	}

	_, err = ReadMetadata(tmpDir)
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

	// Write metadata first
	meta := &Metadata{ID: "test", Name: "paris"}
	if err := WriteMetadata(tmpDir, meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	// Delete it
	if err := DeleteMetadata(tmpDir); err != nil {
		t.Fatalf("DeleteMetadata failed: %v", err)
	}

	// Verify file is gone
	filePath := filepath.Join(tmpDir, MetadataFileName)
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

	// Should not error when file doesn't exist
	if err := DeleteMetadata(tmpDir); err != nil {
		t.Errorf("DeleteMetadata should not error for missing file: %v", err)
	}
}

func TestMetadataExists(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Should not exist initially
	if MetadataExists(tmpDir) {
		t.Error("MetadataExists should return false for missing file")
	}

	// Write metadata
	meta := &Metadata{ID: "test", Name: "berlin"}
	if err := WriteMetadata(tmpDir, meta); err != nil {
		t.Fatalf("WriteMetadata failed: %v", err)
	}

	// Should exist now
	if !MetadataExists(tmpDir) {
		t.Error("MetadataExists should return true after writing")
	}
}

func TestMetadataFileName_IsHidden(t *testing.T) {
	// Verify the filename starts with a dot (hidden file)
	if MetadataFileName[0] != '.' {
		t.Errorf("MetadataFileName should be a hidden file (start with dot), got %q", MetadataFileName)
	}
}
