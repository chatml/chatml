package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// ReadClaudeCodeCredentialsFile reads Claude Code OAuth credentials from
// ~/.claude/.credentials.json. This serves as a fallback when keychain/
// secret-service access fails (e.g., due to ACL restrictions in release builds).
func ReadClaudeCodeCredentialsFile() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving home directory: %w", err)
	}

	path := filepath.Join(home, ".claude", ".credentials.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading credentials file: %w", err)
	}

	var creds claudeCodeCredentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return "", fmt.Errorf("parsing credentials JSON: %w", err)
	}

	if creds.ClaudeAiOAuth == nil {
		return "", fmt.Errorf("no claudeAiOauth field in credentials file")
	}

	if creds.ClaudeAiOAuth.AccessToken == "" {
		return "", fmt.Errorf("empty access token in credentials file")
	}

	if creds.ClaudeAiOAuth.ExpiresAt > 0 {
		expiresAt := time.UnixMilli(creds.ClaudeAiOAuth.ExpiresAt)
		if time.Now().After(expiresAt) {
			return "", fmt.Errorf("OAuth token expired at %s", expiresAt.Format(time.RFC3339))
		}
	}

	return creds.ClaudeAiOAuth.AccessToken, nil
}
