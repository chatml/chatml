package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	// MetadataVersion is the current version of the metadata format
	MetadataVersion = 1
)

// Metadata contains session information stored in ~/.chatml/sessions/ for portability.
// This supplements the SQLite database - the database is authoritative for queries,
// but this file allows session recovery and provides portable session context.
type Metadata struct {
	Version       int       `json:"version"`
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	WorkspaceID   string    `json:"workspaceId"`
	WorkspacePath string    `json:"workspacePath"` // Original repo path
	WorktreePath  string    `json:"worktreePath"`  // Worktree path
	Branch        string    `json:"branch"`
	BaseCommitSHA string    `json:"baseCommitSha"`
	CreatedAt     time.Time `json:"createdAt"`
	Task          string    `json:"task,omitempty"`
}

// SessionsDir returns the directory where session metadata files are stored.
// Returns ~/.chatml/sessions
func SessionsDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".chatml", "sessions"), nil
}

// getMetadataPath returns the full path to a session's metadata file.
func getMetadataPath(sessionID string) (string, error) {
	sessionsDir, err := SessionsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(sessionsDir, sessionID+".json"), nil
}

// WriteMetadata writes session metadata to a JSON file in ~/.chatml/sessions/{sessionID}.json
func WriteMetadata(meta *Metadata) error {
	if meta.Version == 0 {
		meta.Version = MetadataVersion
	}

	if meta.ID == "" {
		return fmt.Errorf("session ID is required")
	}

	filePath, err := getMetadataPath(meta.ID)
	if err != nil {
		return err
	}

	// Ensure sessions directory exists
	sessionsDir, err := SessionsDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		return fmt.Errorf("failed to create sessions directory: %w", err)
	}

	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session metadata: %w", err)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write session metadata to %s: %w", filePath, err)
	}

	return nil
}

// ReadMetadata reads session metadata from ~/.chatml/sessions/{sessionID}.json
func ReadMetadata(sessionID string) (*Metadata, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("session ID is required")
	}

	filePath, err := getMetadataPath(sessionID)
	if err != nil {
		return nil, err
	}

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

// DeleteMetadata removes the session metadata file from ~/.chatml/sessions/
func DeleteMetadata(sessionID string) error {
	if sessionID == "" {
		return nil // Nothing to delete
	}

	filePath, err := getMetadataPath(sessionID)
	if err != nil {
		return err
	}

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete session metadata at %s: %w", filePath, err)
	}

	return nil
}

// MetadataExists checks if a session metadata file exists in ~/.chatml/sessions/
func MetadataExists(sessionID string) bool {
	if sessionID == "" {
		return false
	}

	filePath, err := getMetadataPath(sessionID)
	if err != nil {
		return false
	}

	_, err = os.Stat(filePath)
	return err == nil
}
