package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	// MetadataFileName is the name of the session metadata file stored in each worktree.
	// Uses a hidden filename (dot prefix) to avoid accidental git commits.
	MetadataFileName = ".session.json"
	// MetadataVersion is the current version of the metadata format
	MetadataVersion = 1
)

// Metadata contains session information stored alongside the worktree for portability.
// This supplements the SQLite database - the database is authoritative for queries,
// but this file allows session recovery and provides portable session context.
type Metadata struct {
	Version       int       `json:"version"`
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	WorkspaceID   string    `json:"workspaceId"`
	WorkspacePath string    `json:"workspacePath"` // Original repo path
	Branch        string    `json:"branch"`
	BaseCommitSHA string    `json:"baseCommitSha"`
	CreatedAt     time.Time `json:"createdAt"`
	Task          string    `json:"task,omitempty"`
}

// WriteMetadata writes session metadata to a JSON file in the worktree directory.
func WriteMetadata(worktreePath string, meta *Metadata) error {
	if meta.Version == 0 {
		meta.Version = MetadataVersion
	}

	filePath := filepath.Join(worktreePath, MetadataFileName)

	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session metadata: %w", err)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write session metadata to %s: %w", filePath, err)
	}

	return nil
}

// ReadMetadata reads session metadata from a JSON file in the worktree directory.
func ReadMetadata(worktreePath string) (*Metadata, error) {
	filePath := filepath.Join(worktreePath, MetadataFileName)

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read session metadata from %s: %w", filePath, err)
	}

	var meta Metadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session metadata: %w", err)
	}

	return &meta, nil
}

// DeleteMetadata removes the session metadata file from the worktree directory.
func DeleteMetadata(worktreePath string) error {
	filePath := filepath.Join(worktreePath, MetadataFileName)

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete session metadata at %s: %w", filePath, err)
	}

	return nil
}

// MetadataExists checks if a session metadata file exists in the worktree directory.
func MetadataExists(worktreePath string) bool {
	filePath := filepath.Join(worktreePath, MetadataFileName)
	_, err := os.Stat(filePath)
	return err == nil
}
