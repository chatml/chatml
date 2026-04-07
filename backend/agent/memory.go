package agent

import (
	"github.com/chatml/chatml-core/paths"
)

// ClaudeMemoryDir returns the path to the auto-memory directory for the given
// working directory. Uses the ChatML primary path (~/.chatml/projects/<encoded>/memory/).
// Kept for backwards compatibility — callers should prefer paths.MemoryDir().
func ClaudeMemoryDir(cwd string) (string, error) {
	return paths.MemoryDir(cwd), nil
}
