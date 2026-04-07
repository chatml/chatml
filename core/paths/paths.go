// Package paths centralizes all path resolution for ChatML's dual-path system.
// ChatML supports both .chatml (primary) and .claude (fallback) directory
// conventions. When writing, use .chatml paths. When reading, check .chatml
// first then fall back to .claude for backwards compatibility.
package paths

import (
	"os"
	"path/filepath"
	"strings"
)

// Directory and file name constants.
const (
	// Primary (ChatML-branded)
	ConfigDir         = ".chatml"
	InstructionsFile  = "CHATML.md"
	LocalFile         = "CHATML.local.md"

	// Fallback (Claude Code compatibility)
	FallbackConfigDir        = ".claude"
	FallbackInstructionsFile = "CLAUDE.md"
	FallbackLocalFile        = "CLAUDE.local.md"

	// Shared (not branded)
	MemoryIndexFile = "MEMORY.md"
	RulesSubdir     = "rules"
	MemorySubdir    = "memory"
	CommandsSubdir  = "commands"
	SkillsSubdir    = "skills"
	WorktreesSubdir = "worktrees"
	ProjectsSubdir  = "projects"
)

// HomeConfigDir returns the primary home config directory (~/.chatml).
func HomeConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ConfigDir)
}

// HomeFallbackDir returns the fallback home config directory (~/.claude).
func HomeFallbackDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, FallbackConfigDir)
}

// ProjectDir returns the primary project config directory ({workdir}/.chatml).
func ProjectDir(workdir string) string {
	return filepath.Join(workdir, ConfigDir)
}

// ProjectFallbackDir returns the fallback project config directory ({workdir}/.claude).
func ProjectFallbackDir(workdir string) string {
	return filepath.Join(workdir, FallbackConfigDir)
}

// MemoryDir returns the SDK-convention memory directory for writing.
// Uses .chatml as the primary path: ~/.chatml/projects/{encoded-cwd}/memory/
func MemoryDir(workdir string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(workdir, ConfigDir, MemorySubdir)
	}
	encoded := EncodePath(workdir)
	return filepath.Join(home, ConfigDir, ProjectsSubdir, encoded, MemorySubdir)
}

// MemoryDirFallback returns the legacy SDK memory directory.
// ~/.claude/projects/{encoded-cwd}/memory/
func MemoryDirFallback(workdir string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(workdir, FallbackConfigDir, MemorySubdir)
	}
	encoded := EncodePath(workdir)
	return filepath.Join(home, FallbackConfigDir, ProjectsSubdir, encoded, MemorySubdir)
}

// EncodePath encodes a filesystem path using the SDK convention:
// replace path separators and spaces with hyphens.
func EncodePath(p string) string {
	p = strings.ReplaceAll(p, string(os.PathSeparator), "-")
	p = strings.ReplaceAll(p, " ", "-")
	return p
}

// FindFirst returns the first path that exists on disk.
// Returns "" if none exist.
func FindFirst(paths ...string) string {
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// FindAll returns all paths that exist on disk.
func FindAll(paths ...string) []string {
	var result []string
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			result = append(result, p)
		}
	}
	return result
}

// InstructionPaths returns the primary and fallback paths for the instructions
// file in a given directory (e.g., CHATML.md, CLAUDE.md).
func InstructionPaths(dir string) (primary, fallback string) {
	return filepath.Join(dir, InstructionsFile), filepath.Join(dir, FallbackInstructionsFile)
}

// ConfigInstructionPaths returns the primary and fallback paths for the
// config-dir instructions file (e.g., .chatml/CHATML.md, .claude/CLAUDE.md).
func ConfigInstructionPaths(dir string) (primary, fallback string) {
	return filepath.Join(dir, ConfigDir, InstructionsFile),
		filepath.Join(dir, FallbackConfigDir, FallbackInstructionsFile)
}

// LocalInstructionPaths returns the primary and fallback local override paths.
func LocalInstructionPaths(dir string) (primary, fallback string) {
	return filepath.Join(dir, LocalFile), filepath.Join(dir, FallbackLocalFile)
}

// RulesDirPaths returns the primary and fallback rules directory paths.
func RulesDirPaths(dir string) (primary, fallback string) {
	return filepath.Join(dir, ConfigDir, RulesSubdir),
		filepath.Join(dir, FallbackConfigDir, RulesSubdir)
}

// HomeInstructionPaths returns the primary and fallback home-level instruction paths.
func HomeInstructionPaths() (primary, fallback string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	return filepath.Join(home, ConfigDir, InstructionsFile),
		filepath.Join(home, FallbackConfigDir, FallbackInstructionsFile)
}

// HomeMemoryPaths returns the primary and fallback home-level MEMORY.md paths.
func HomeMemoryPaths() (primary, fallback string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	return filepath.Join(home, ConfigDir, MemoryIndexFile),
		filepath.Join(home, FallbackConfigDir, MemoryIndexFile)
}

// SettingsPaths returns the primary and fallback settings.json paths in the home dir.
func SettingsPaths() (primary, fallback string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	return filepath.Join(home, ConfigDir, "settings.json"),
		filepath.Join(home, FallbackConfigDir, "settings.json")
}

// CredentialsPaths returns the primary and fallback .credentials.json paths.
func CredentialsPaths() (primary, fallback string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	return filepath.Join(home, ConfigDir, ".credentials.json"),
		filepath.Join(home, FallbackConfigDir, ".credentials.json")
}

// CommandsDirPaths returns the primary and fallback commands directories.
func CommandsDirPaths(workdir string) (primary, fallback string) {
	return filepath.Join(workdir, ConfigDir, CommandsSubdir),
		filepath.Join(workdir, FallbackConfigDir, CommandsSubdir)
}

// SkillDir returns the primary skills directory for a given skill ID.
func SkillDir(skillID string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ConfigDir, SkillsSubdir, skillID)
}

// SkillDirFallback returns the fallback skills directory for a given skill ID.
func SkillDirFallback(skillID string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, FallbackConfigDir, SkillsSubdir, "chatml-"+skillID)
}

// WorkspaceSettingsPaths returns settings.json paths within the workspace.
func WorkspaceSettingsPaths(workdir string) (primary, fallback string) {
	return filepath.Join(workdir, ConfigDir, "settings.json"),
		filepath.Join(workdir, FallbackConfigDir, "settings.json")
}

// AllConfigDirNames returns both config directory names for safety checks.
func AllConfigDirNames() []string {
	return []string{ConfigDir, FallbackConfigDir}
}
