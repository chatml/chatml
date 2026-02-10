//go:build !darwin

package ai

import "fmt"

// ReadClaudeCodeOAuthToken is not supported on non-macOS platforms.
func ReadClaudeCodeOAuthToken() (string, error) {
	return "", fmt.Errorf("keychain credential reading is only supported on macOS")
}
