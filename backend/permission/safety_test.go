package permission

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// --- IsDangerousPath tests ---

func TestIsDangerousPath_DangerousFiles(t *testing.T) {
	dangerous := []string{
		".gitconfig",
		".bashrc",
		".bash_profile",
		".zshrc",
		".zprofile",
		".profile",
		".gitmodules",
		".ripgreprc",
		".mcp.json",
		".claude.json",
		"home/user/.bashrc",
		"/home/user/.zshrc",
	}

	for _, path := range dangerous {
		assert.True(t, IsDangerousPath(path), "expected %q to be dangerous", path)
	}
}

func TestIsDangerousPath_DangerousDirs(t *testing.T) {
	dangerous := []string{
		".git/config",
		".git/hooks/pre-commit",
		".vscode/settings.json",
		".idea/workspace.xml",
		".claude/settings.json",
		".git",
	}

	for _, path := range dangerous {
		assert.True(t, IsDangerousPath(path), "expected %q to be dangerous", path)
	}
}

func TestIsDangerousPath_AbsolutePathsWithDangerousDirs(t *testing.T) {
	dangerous := []string{
		"/home/user/project/.git/config",
		"/home/user/project/.vscode/settings.json",
		"/home/user/project/.claude/memory.md",
	}

	for _, path := range dangerous {
		assert.True(t, IsDangerousPath(path), "expected %q to be dangerous", path)
	}
}

func TestIsDangerousPath_SafeExceptions(t *testing.T) {
	safe := []string{
		".claude/worktrees/feature-branch/file.txt",
		".claude/worktrees/main/code.go",
	}

	for _, path := range safe {
		assert.False(t, IsDangerousPath(path), "expected %q to be safe (exception)", path)
	}
}

func TestIsDangerousPath_SafePaths(t *testing.T) {
	safe := []string{
		"src/main.go",
		"backend/agent/manager.go",
		"package.json",
		".env",
		"config/.gitkeep",
		"src/.hidden/file.go",
	}

	for _, path := range safe {
		assert.False(t, IsDangerousPath(path), "expected %q to be safe", path)
	}
}

func TestIsDangerousPath_Empty(t *testing.T) {
	assert.False(t, IsDangerousPath(""))
}

func TestIsDangerousPath_RelativeWithDotSlash(t *testing.T) {
	assert.True(t, IsDangerousPath("./.git/config"))
	assert.True(t, IsDangerousPath("./.bashrc"))
	assert.False(t, IsDangerousPath("./src/main.go"))
}

// --- IsWithinDirectory tests ---

func TestIsWithinDirectory_Inside(t *testing.T) {
	assert.True(t, IsWithinDirectory("/home/user/project/src/main.go", "/home/user/project"))
	assert.True(t, IsWithinDirectory("/home/user/project/deep/nested/file.go", "/home/user/project"))
}

func TestIsWithinDirectory_Outside(t *testing.T) {
	assert.False(t, IsWithinDirectory("/home/user/other/file.go", "/home/user/project"))
	assert.False(t, IsWithinDirectory("/etc/passwd", "/home/user/project"))
}

func TestIsWithinDirectory_ExactMatch(t *testing.T) {
	assert.True(t, IsWithinDirectory("/home/user/project", "/home/user/project"))
}

func TestIsWithinDirectory_Empty(t *testing.T) {
	assert.False(t, IsWithinDirectory("", "/home/user/project"))
	assert.False(t, IsWithinDirectory("/home/user/file.go", ""))
}

func TestIsWithinDirectory_TraversalAttempt(t *testing.T) {
	assert.False(t, IsWithinDirectory("/home/user/project/../other/file.go", "/home/user/project"))
}
