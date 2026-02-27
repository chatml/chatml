package ai

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ReadClaudeCodeOAuthToken reads the Claude Code OAuth access token from the macOS Keychain.
// Returns the token string or an error. Returns an error if no token is found or it has expired.
func ReadClaudeCodeOAuthToken() (string, error) {
	// Read the credential from macOS Keychain
	cmd := exec.Command("security", "find-generic-password",
		"-s", "Claude Code-credentials",
		"-g",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("reading keychain: %w", err)
	}

	// Parse the password field from security output
	// Format: password: "{ ... json ... }"
	password := extractKeychainPassword(string(output))
	if password == "" {
		return "", fmt.Errorf("no password found in keychain entry")
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

	// Check expiration (expiresAt is in milliseconds)
	if creds.ClaudeAiOAuth.ExpiresAt > 0 {
		expiresAt := time.UnixMilli(creds.ClaudeAiOAuth.ExpiresAt)
		if time.Now().After(expiresAt) {
			return "", fmt.Errorf("OAuth token expired at %s", expiresAt.Format(time.RFC3339))
		}
	}

	return creds.ClaudeAiOAuth.AccessToken, nil
}

// extractKeychainPassword parses the "password: ..." line from `security` command output.
func extractKeychainPassword(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "password: ") {
			value := strings.TrimPrefix(line, "password: ")
			// Remove surrounding quotes
			if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
				value = value[1 : len(value)-1]
			}
			// Handle hex-encoded passwords (e.g., 0x7B22636C...)
			if strings.HasPrefix(value, "0x") || strings.HasPrefix(value, "0X") {
				decoded, err := hex.DecodeString(value[2:])
				if err == nil {
					return string(decoded)
				}
				// If hex decode fails, return the raw value and let JSON parsing catch it
			}
			return value
		}
	}
	return ""
}
