package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// ClaudeCodeSettings represents the relevant fields from ~/.claude/settings.json.
// Only Bedrock-related fields are extracted; the rest (permissions, model, plugins, etc.)
// is ignored.
type ClaudeCodeSettings struct {
	AwsAuthRefresh string            `json:"awsAuthRefresh"`
	Env            map[string]string `json:"env"`
}

// ReadClaudeCodeSettings reads Bedrock-related configuration from ~/.claude/settings.json.
// Returns nil with no error if the file does not exist (it is optional).
func ReadClaudeCodeSettings() (*ClaudeCodeSettings, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolving home directory: %w", err)
	}

	path := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading Claude settings file: %w", err)
	}

	var settings ClaudeCodeSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, fmt.Errorf("parsing Claude settings JSON: %w", err)
	}

	return &settings, nil
}

// IsBedRockConfigured returns true if the Claude Code settings indicate Bedrock is enabled.
func IsBedRockConfigured(settings *ClaudeCodeSettings) bool {
	if settings == nil || settings.Env == nil {
		return false
	}
	return settings.Env["CLAUDE_CODE_USE_BEDROCK"] == "true"
}
