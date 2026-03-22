package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
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

// SSOTokenStatus describes the state of cached AWS SSO tokens.
type SSOTokenStatus struct {
	Applicable       bool       // true if Bedrock is configured
	Valid            *bool      // nil if unknown/no tokens found, true/false otherwise
	ExpiresAt        *time.Time // when the best token expires
	ExpiresInMinutes float64
}

// CheckSSOTokenStatus scans ~/.aws/sso/cache/ for valid SSO tokens.
// This is the shared logic used by both the HTTP handler and the agent manager pre-flight check.
func CheckSSOTokenStatus() SSOTokenStatus {
	home, err := os.UserHomeDir()
	if err != nil {
		return SSOTokenStatus{Applicable: true}
	}

	cacheDir := filepath.Join(home, ".aws", "sso", "cache")
	entries, err := filepath.Glob(filepath.Join(cacheDir, "*.json"))
	if err != nil || len(entries) == 0 {
		return SSOTokenStatus{Applicable: true}
	}

	type ssoToken struct {
		AccessToken string `json:"accessToken"`
		ExpiresAt   string `json:"expiresAt"`
	}

	var bestExpiry time.Time
	found := false

	for _, entry := range entries {
		data, readErr := os.ReadFile(entry)
		if readErr != nil {
			continue
		}
		var tok ssoToken
		if jsonErr := json.Unmarshal(data, &tok); jsonErr != nil {
			continue
		}
		if tok.AccessToken == "" || tok.ExpiresAt == "" {
			continue
		}
		expiry, parseErr := time.Parse("2006-01-02T15:04:05UTC", tok.ExpiresAt)
		if parseErr != nil {
			expiry, parseErr = time.Parse(time.RFC3339, tok.ExpiresAt)
		}
		if parseErr != nil {
			continue
		}
		if !found || expiry.After(bestExpiry) {
			bestExpiry = expiry
			found = true
		}
	}

	if !found {
		return SSOTokenStatus{Applicable: true}
	}

	now := time.Now().UTC()
	valid := bestExpiry.After(now)
	minutesLeft := bestExpiry.Sub(now).Minutes()

	return SSOTokenStatus{
		Applicable:       true,
		Valid:            &valid,
		ExpiresAt:        &bestExpiry,
		ExpiresInMinutes: minutesLeft,
	}
}

// RunAuthRefreshCommand executes the given AWS auth refresh command (e.g. "aws sso login --profile core-dev")
// with the given context. Uses sh -c for shell parsing (PATH, quoting, env vars).
//
// SECURITY: authRefreshCmd is passed to a shell — callers must ensure the value comes from a
// trusted, user-controlled source (ChatML settings store or ~/.claude/settings.json), never
// from untrusted input such as agent output or API request bodies.
func RunAuthRefreshCommand(ctx context.Context, authRefreshCmd string) error {
	cmd := exec.CommandContext(ctx, "sh", "-c", authRefreshCmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("auth refresh command failed: %w (output: %s)", err, string(output))
	}
	return nil
}
