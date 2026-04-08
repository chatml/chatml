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
	".chatml.json":  true,
}

// Dangerous directory prefixes that should NEVER be auto-approved for modification.
var dangerousDirs = []string{
	".git/",
	".vscode/",
	".idea/",
	".claude/",
	".chatml/",
}

// Safe subdirectories within otherwise dangerous directories.
// These are application-managed data directories, not shell configs or IDE settings.
var safeDirExceptions = []string{
	".claude/worktrees/",
	".claude/projects/",
	".claude/plans/",
	".claude/memory/",
	".chatml/worktrees/",
	".chatml/projects/",
	".chatml/plans/",
	".chatml/memory/",
}

// IsDangerousPath returns true if the given file path targets a dangerous
// location that should require explicit user approval even in bypass mode.
// The path should be relative to the workspace root or absolute.
// NOTE: Checks basename only, so any file named .bashrc (even templates) is flagged.
// This is intentional fail-safe behavior.
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

// Dangerous command patterns — programs that can execute arbitrary code,
// escalate privileges, or make network requests. These require explicit
// user approval even in bypass mode. Ported from Claude Code's dangerousPatterns.ts.
var dangerousCommands = map[string]bool{
	// Interpreters / code execution
	"python": true, "python3": true, "python2": true,
	"node": true, "deno": true, "bun": true,
	"ruby": true, "perl": true, "php": true,
	"lua": true, "julia": true, "Rscript": true,
	// Package script runners (execute arbitrary project scripts)
	"npx": true, "tsx": true, "bunx": true,
	// Shell execution
	"bash": true, "sh": true, "zsh": true, "fish": true,
	"eval": true, "exec": true, "source": true,
	// Privilege escalation
	"sudo": true, "su": true, "doas": true,
	// Network tools
	"curl": true, "wget": true, "ssh": true, "scp": true,
	"rsync": true, "nc": true, "ncat": true, "netcat": true,
	// Package managers (can install/run arbitrary code)
	"npm": true, "yarn": true, "pnpm": true, "pip": true, "pip3": true,
	"gem": true, "cargo": true, "go": true,
	// Version control (can push/modify remote)
	"git": true,
	// Cloud / infra
	"kubectl": true, "docker": true, "podman": true,
	"aws": true, "gcloud": true, "az": true, "terraform": true,
	// Zsh-specific dangerous builtins (from Claude Code's bashSecurity.ts)
	// These can execute code, access files, or exfiltrate data via Zsh modules
	"zmodload": true,  // Load arbitrary Zsh modules (gateway to many attacks)
	"emulate": true,   // Eval-equivalent with -c flag
	"sysopen": true, "sysread": true, "syswrite": true, "sysseek": true, // zsh/system builtins
	"zpty": true,      // Pseudo-terminal execution
	"ztcp": true, "zsocket": true, // Network exfiltration via Zsh
	"mapfile": true,   // Invisible file I/O via array assignment
	// Zsh file builtins (bypass normal command auditing)
	"zf_rm": true, "zf_mv": true, "zf_ln": true,
	"zf_chmod": true, "zf_chown": true, "zf_chgrp": true,
	"zf_mkdir": true, "zf_rmdir": true,
}

// IsDangerousCommand returns true if a Bash command invokes a dangerous program.
// Handles pipes (|), chaining (&&, ;, ||), and subshells.
func IsDangerousCommand(command string) bool {
	if command == "" {
		return false
	}

	// Legacy string-based splitting. Not quote-aware — prefer IsDangerousCommandAST
	// for primary security checks. This function is kept for backward compatibility
	// and defense-in-depth but can be bypassed with quoted shell operators.
	normalized := command
	for _, sep := range []string{"&&", "||", "|", ";"} {
		normalized = strings.ReplaceAll(normalized, sep, "\x00")
	}

	for _, segment := range strings.Split(normalized, "\x00") {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}

		// Extract the first token (the command being run)
		// Handle: env VAR=val cmd, command cmd, xargs cmd
		cmd := extractCommand(segment)
		if cmd == "" {
			continue
		}

		if dangerousCommands[cmd] {
			return true
		}
	}

	return false
}

// extractCommand extracts the effective command from a shell segment.
// Handles prefixes like env, command, xargs, nohup, and VAR=val assignments.
func extractCommand(segment string) string {
	fields := strings.Fields(segment)
	if len(fields) == 0 {
		return ""
	}

	i := 0
	for i < len(fields) {
		token := fields[i]

		// Skip env variable assignments (KEY=VALUE)
		if strings.Contains(token, "=") && !strings.HasPrefix(token, "-") && !strings.Contains(token, "/") {
			i++
			continue
		}

		// Skip command wrappers that pass through to the next arg
		switch token {
		case "env", "command", "xargs", "nohup", "time", "nice", "ionice", "strace":
			i++
			// Skip any flags after the wrapper
			for i < len(fields) && strings.HasPrefix(fields[i], "-") {
				i++
			}
			continue
		}

		// Return the base name (strip path)
		base := token
		if idx := strings.LastIndex(base, "/"); idx >= 0 {
			base = base[idx+1:]
		}
		return base
	}

	return ""
}

// IsWithinDirectory checks if a file path is within the given directory.
// Both paths are cleaned and compared. Returns false if filePath is outside dir.
// For existing paths, symlinks are resolved to prevent escape via symlinked directories.
func IsWithinDirectory(filePath, dir string) bool {
	if filePath == "" || dir == "" {
		return false
	}

	// Try to resolve symlinks for existing paths
	absFile, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		// File doesn't exist yet (e.g., Write tool creating new file) — fall back to Abs
		absFile, err = filepath.Abs(filePath)
		if err != nil {
			return false
		}
	}

	absDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		absDir, err = filepath.Abs(dir)
		if err != nil {
			return false
		}
	}

	// Ensure dir ends with separator for prefix matching
	if !strings.HasSuffix(absDir, string(filepath.Separator)) {
		absDir += string(filepath.Separator)
	}

	return strings.HasPrefix(absFile, absDir) || absFile == strings.TrimSuffix(absDir, string(filepath.Separator))
}
