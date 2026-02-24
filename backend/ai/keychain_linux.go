//go:build linux

package ai

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ReadClaudeCodeOAuthToken reads the Claude Code OAuth access token from the
// Linux Secret Service (GNOME Keyring / KWallet) via the secret-tool CLI.
func ReadClaudeCodeOAuthToken() (string, error) {
	// secret-tool is the standard CLI for libsecret (same backend as keytar)
	cmd := exec.Command("secret-tool", "lookup",
		"service", "Claude Code-credentials",
		"account", "Claude Code-credentials",
	)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("reading secret service: %w (is secret-tool installed?)", err)
	}

	password := strings.TrimSpace(string(output))
	if password == "" {
		return "", fmt.Errorf("no credential found in secret service")
	}

	var creds claudeCodeCredentials
	if err := json.Unmarshal([]byte(password), &creds); err != nil {
		return "", fmt.Errorf("parsing credentials JSON: %w", err)
	}

	if creds.ClaudeAiOAuth == nil {
		return "", fmt.Errorf("no claudeAiOauth field in credentials")
	}

	if creds.ClaudeAiOAuth.AccessToken == "" {
		return "", fmt.Errorf("empty access token in credentials")
	}

	if creds.ClaudeAiOAuth.ExpiresAt > 0 {
		expiresAt := time.UnixMilli(creds.ClaudeAiOAuth.ExpiresAt)
		if time.Now().After(expiresAt) {
			return "", fmt.Errorf("OAuth token expired at %s", expiresAt.Format(time.RFC3339))
		}
	}

	return creds.ClaudeAiOAuth.AccessToken, nil
}
