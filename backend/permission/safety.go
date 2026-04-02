package permission

import (
	"path/filepath"
	"strings"
)

// Dangerous files that should NEVER be auto-approved for editing, even in bypass mode.
// These are shell configs, git configs, and IDE configs that could be weaponized.
var dangerousFiles = map[string]bool{
	".gitconfig":    true,
	".gitmodules":   true,
	".bashrc":       true,
	".bash_profile": true,
	".zshrc":        true,
	".zprofile":     true,
	".profile":      true,
	".ripgreprc":    true,
	".mcp.json":     true,
	".claude.json":  true,
}

// Dangerous directory prefixes that should NEVER be auto-approved for modification.
var dangerousDirs = []string{
	".git/",
	".vscode/",
	".idea/",
	".claude/",
}

// Safe subdirectories within otherwise dangerous directories.
var safeDirExceptions = []string{
	".claude/worktrees/",
}

// IsDangerousPath returns true if the given file path targets a dangerous
// location that should require explicit user approval even in bypass mode.
// The path should be relative to the workspace root or absolute.
func IsDangerousPath(filePath string) bool {
	if filePath == "" {
		return false
	}

	// Normalize path
	cleaned := filepath.Clean(filePath)
	base := filepath.Base(cleaned)

	// Check dangerous files by basename
	if dangerousFiles[base] {
		return true
	}

	// Normalize to forward slashes for prefix matching
	normalized := filepath.ToSlash(cleaned)
	// Strip leading ./ if present
	normalized = strings.TrimPrefix(normalized, "./")

	// Check if path is in a safe exception directory first
	for _, safe := range safeDirExceptions {
		if strings.HasPrefix(normalized, safe) {
			return false
		}
	}

	// Check dangerous directory prefixes
	for _, dir := range dangerousDirs {
		if strings.HasPrefix(normalized, dir) || normalized == strings.TrimSuffix(dir, "/") {
			return true
		}
	}

	// Also check if any path component matches a dangerous directory
	// This handles absolute paths like /home/user/project/.git/config
	parts := strings.Split(normalized, "/")
	for i, part := range parts {
		for _, dir := range dangerousDirs {
			dirName := strings.TrimSuffix(dir, "/")
			if part == dirName {
				// Check if the remaining path is a safe exception
				remaining := strings.Join(parts[i:], "/") + "/"
				isSafe := false
				for _, safe := range safeDirExceptions {
					if strings.HasPrefix(remaining, safe) {
						isSafe = true
						break
					}
				}
				if !isSafe {
					return true
				}
			}
		}
	}

	return false
}

// IsWithinDirectory checks if a file path is within the given directory.
// Both paths are cleaned and compared. Returns false if filePath is outside dir.
func IsWithinDirectory(filePath, dir string) bool {
	if filePath == "" || dir == "" {
		return false
	}

	absFile, err := filepath.Abs(filePath)
	if err != nil {
		return false
	}

	absDir, err := filepath.Abs(dir)
	if err != nil {
		return false
	}

	// Ensure dir ends with separator for prefix matching
	if !strings.HasSuffix(absDir, string(filepath.Separator)) {
		absDir += string(filepath.Separator)
	}

	return strings.HasPrefix(absFile, absDir) || absFile == strings.TrimSuffix(absDir, string(filepath.Separator))
}
