package agent

import (
	"os"
	"path/filepath"
	"strings"
)

// ClaudeMemoryDir returns the path to the Claude SDK auto-memory directory
// for the given working directory. The SDK convention is:
//
//	~/.claude/projects/<encoded-cwd>/memory/
//
// where <encoded-cwd> replaces "/" and " " with "-".
func ClaudeMemoryDir(cwd string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	encoded := encodePathForClaude(cwd)
	return filepath.Join(homeDir, ".claude", "projects", encoded, "memory"), nil
}

// encodePathForClaude encodes a filesystem path using the same convention as
// the Claude Agent SDK: replace path separators and spaces with hyphens.
// Example: "/Users/foo/my project" → "-Users-foo-my-project"
func encodePathForClaude(p string) string {
	p = strings.ReplaceAll(p, string(os.PathSeparator), "-")
	p = strings.ReplaceAll(p, " ", "-")
	return p
}
