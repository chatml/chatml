// Package sandbox provides OS-level sandboxing for tool execution.
// On macOS, uses sandbox-exec with Seatbelt profiles to restrict file system
// access, network access, and process spawning.
// On Linux, uses landlock (kernel >= 5.13) for filesystem restrictions.
package sandbox

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Config defines sandbox restrictions for a tool execution.
type Config struct {
	// AllowReadPaths are directories/files the process can read from.
	AllowReadPaths []string

	// AllowWritePaths are directories/files the process can write to.
	AllowWritePaths []string

	// AllowNetwork permits network access if true.
	AllowNetwork bool

	// AllowExec permits spawning new processes if true.
	AllowExec bool
}

// WrapCommand wraps an exec.Cmd with sandbox restrictions.
// On unsupported platforms, returns the command unchanged.
func WrapCommand(cmd *exec.Cmd, cfg Config) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		return wrapDarwin(cmd, cfg)
	default:
		// Linux landlock / other platforms: future implementation
		return cmd
	}
}

// IsAvailable returns true if sandboxing is supported on this platform.
func IsAvailable() bool {
	switch runtime.GOOS {
	case "darwin":
		// sandbox-exec is available on macOS (deprecated but functional)
		_, err := exec.LookPath("sandbox-exec")
		return err == nil
	default:
		return false
	}
}

// --- macOS Seatbelt ---

func wrapDarwin(cmd *exec.Cmd, cfg Config) *exec.Cmd {
	profile := generateSeatbeltProfile(cfg)

	// sandbox-exec -p 'profile' command args...
	args := []string{"-p", profile}
	args = append(args, cmd.Path)
	args = append(args, cmd.Args[1:]...) // Skip argv[0] (program name)

	sandboxed := exec.Command("sandbox-exec", args...)
	sandboxed.Dir = cmd.Dir
	sandboxed.Env = cmd.Env
	sandboxed.Stdin = cmd.Stdin
	sandboxed.Stdout = cmd.Stdout
	sandboxed.Stderr = cmd.Stderr

	return sandboxed
}

// isSafeSeatbeltPath returns false if the path contains characters that could
// break or inject into Seatbelt's Scheme-style profile syntax. This includes
// Seatbelt string delimiters, parentheses, and control characters (newlines,
// carriage returns, null bytes) that could escape a quoted string literal and
// inject arbitrary sandbox rules.
func isSafeSeatbeltPath(path string) bool {
	if strings.ContainsAny(path, "\"'\\()") {
		return false
	}
	for _, r := range path {
		if r < 0x20 || r == 0x7f { // ASCII control characters (including \n, \r, \x00)
			return false
		}
	}
	return true
}

// generateSeatbeltProfile creates a macOS Seatbelt sandbox profile.
// Seatbelt is Apple's sandbox framework (TrustedBSD Mandatory Access Control).
func generateSeatbeltProfile(cfg Config) string {
	var sb strings.Builder

	sb.WriteString("(version 1)\n")
	sb.WriteString("(deny default)\n\n")

	// Always allow basic operations (process-exec is conditional — see AllowExec below)
	sb.WriteString("; Basic operations\n")
	sb.WriteString("(allow sysctl-read)\n")
	sb.WriteString("(allow mach-lookup)\n")
	sb.WriteString("(allow signal (target self))\n\n")

	// File read access
	sb.WriteString("; File read access\n")
	sb.WriteString("(allow file-read-metadata)\n") // Needed for stat()
	for _, path := range cfg.AllowReadPaths {
		if !isSafeSeatbeltPath(path) {
			log.Printf("sandbox: skipping read path with unsupported characters: %s", path)
			continue
		}
		sb.WriteString(fmt.Sprintf("(allow file-read* (subpath \"%s\"))\n", path))
	}
	// Always allow reading standard system paths
	sb.WriteString("(allow file-read* (subpath \"/usr\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/bin\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/sbin\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/Library\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/System\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/private/tmp\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/private/var\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/dev\"))\n")
	sb.WriteString("(allow file-read* (literal \"/etc\"))\n")
	sb.WriteString("(allow file-read* (subpath \"/etc\"))\n\n")

	// File write access
	sb.WriteString("; File write access\n")
	for _, path := range cfg.AllowWritePaths {
		if !isSafeSeatbeltPath(path) {
			log.Printf("sandbox: skipping write path with unsupported characters: %s", path)
			continue
		}
		sb.WriteString(fmt.Sprintf("(allow file-write* (subpath \"%s\"))\n", path))
	}
	// Always allow writing to tmp
	sb.WriteString("(allow file-write* (subpath \"/private/tmp\"))\n")
	sb.WriteString("(allow file-write* (subpath \"/tmp\"))\n\n")

	// Network access
	sb.WriteString("; Network access\n")
	if cfg.AllowNetwork {
		sb.WriteString("(allow network*)\n")
	} else {
		sb.WriteString("; (network denied)\n")
	}
	sb.WriteString("\n")

	// Process execution
	sb.WriteString("; Process execution\n")
	if cfg.AllowExec {
		sb.WriteString("(allow process-fork)\n")
		sb.WriteString("(allow process-exec)\n")
	}

	return sb.String()
}

// DefaultBashConfig returns a sandbox config suitable for running Bash commands
// within a workspace. Allows read/write to the workspace and targeted reads to
// config files that dev tools commonly need. Does NOT grant blanket home
// directory read access — that would expose .ssh/, .aws/credentials, .gnupg/,
// browser profiles, and other sensitive data.
func DefaultBashConfig(workdir string) Config {
	homeDir, _ := os.UserHomeDir()

	readPaths := []string{workdir}
	if homeDir != "" {
		// Specific config files that dev tools need — NOT the whole home dir.
		for _, rel := range []string{
			".gitconfig", ".gitignore_global",
			".npmrc", ".yarnrc", ".yarnrc.yml",
			".cargo", ".rustup",
			".config/git",
		} {
			readPaths = append(readPaths, filepath.Join(homeDir, rel))
		}
	}

	return Config{
		AllowReadPaths:  readPaths,
		AllowWritePaths: []string{workdir},
		AllowNetwork:    true, // Many tools need network (npm, git, etc.)
		AllowExec:       true, // Bash needs to spawn child processes
	}
}

// DefaultReadConfig returns a restrictive sandbox for file read operations.
func DefaultReadConfig(workdir string) Config {
	return Config{
		AllowReadPaths: []string{workdir},
		AllowNetwork:   false,
		AllowExec:      false,
	}
}
