package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const (
	// MetadataVersion is the current version of the metadata format
	MetadataVersion = 1
)

// validSessionIDPattern matches valid session IDs (alphanumeric, hyphens, underscores).
// This ensures session IDs are safe to use as filenames across all platforms.
var validSessionIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

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

// validateSessionID checks if a session ID is safe to use as a filename.
func validateSessionID(sessionID string) error {
	if sessionID == "" {
		return fmt.Errorf("session ID is required")
	}
	if !validSessionIDPattern.MatchString(sessionID) {
		return fmt.Errorf("invalid session ID %q: must contain only alphanumeric characters, hyphens, and underscores", sessionID)
	}
	return nil
}

// getMetadataPath returns the full path to a session's metadata file.
func getMetadataPath(sessionID string) (string, error) {
	if err := validateSessionID(sessionID); err != nil {
		return "", err
	}
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

	// Validate before attempting delete (but empty string already handled above)
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
	filePath, err := getMetadataPath(sessionID)
	if err != nil {
		return false // Invalid or empty sessionID
	}

	_, err = os.Stat(filePath)
	return err == nil
}

// ListMetadataFiles returns all session IDs that have metadata files in ~/.chatml/sessions/
func ListMetadataFiles() ([]string, error) {
	sessionsDir, err := SessionsDir()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No sessions directory yet
		}
		return nil, fmt.Errorf("failed to read sessions directory: %w", err)
	}

	var sessionIDs []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if filepath.Ext(name) == ".json" {
			sessionID := name[:len(name)-5] // Remove .json extension
			sessionIDs = append(sessionIDs, sessionID)
		}
	}

	return sessionIDs, nil
}

// CleanupStaleMetadata removes metadata files for sessions that no longer exist in the database.
// The sessionExists function should return true if the session ID exists in the database.
func CleanupStaleMetadata(sessionExists func(sessionID string) bool) (int, error) {
	sessionIDs, err := ListMetadataFiles()
	if err != nil {
		return 0, err
	}

	removed := 0
	for _, sessionID := range sessionIDs {
		if !sessionExists(sessionID) {
			if err := DeleteMetadata(sessionID); err != nil {
				// Log but continue - best effort cleanup
				continue
			}
			removed++
		}
	}

	return removed, nil
}
