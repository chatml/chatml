//go:build !darwin && !linux && !windows

package ai

import "fmt"

// ReadClaudeCodeOAuthToken is not supported on this platform.
func ReadClaudeCodeOAuthToken() (string, error) {
	return "", fmt.Errorf("keychain credential reading is not supported on this platform")
}
