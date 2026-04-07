package permission

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Suggestion holds a human-readable label and the wildcard specifier to persist.
type Suggestion struct {
	Label     string // Human-readable label, e.g. "Yes, allow git commands from this project"
	Specifier string // Wildcard pattern for the rule, e.g. "git *"
}

// SuggestWildcard computes a smart wildcard approval suggestion for a tool call.
// Returns nil if no meaningful wildcard can be derived (caller should fall back
// to a generic "Always allow" label).
func SuggestWildcard(toolName, specifier string) *Suggestion {
	if specifier == "" {
		return nil
	}

	switch toolName {
	case "Bash":
		return suggestBashWildcard(specifier)
	case "Write":
		return suggestFileWildcard("writing to", specifier)
	case "Edit":
		return suggestFileWildcard("editing in", specifier)
	case "NotebookEdit":
		return suggestFileWildcard("editing in", specifier)
	case "WebFetch":
		// specifier is "domain:example.com" — keep as-is
		if strings.HasPrefix(specifier, "domain:") {
			domain := specifier[len("domain:"):]
			return &Suggestion{
				Label:     fmt.Sprintf("Yes, allow fetching from %s", domain),
				Specifier: specifier,
			}
		}
		return nil
	default:
		return nil
	}
}

// suggestBashWildcard extracts the first command word and builds a wildcard.
func suggestBashWildcard(command string) *Suggestion {
	// Extract the effective command (skip env vars, wrappers like env/command/nohup)
	cmd := extractCommand(command)
	if cmd == "" {
		return nil
	}

	// Only suggest wildcard if there's more after the command name
	// (otherwise the exact specifier IS the command).
	// NOTE: extractCommand strips path prefixes (/usr/bin/git → git), so
	// a bare "/usr/bin/git" won't match here and gets "git *" — acceptable
	// since the wildcard still matches the bare command.
	trimmed := strings.TrimSpace(command)
	if trimmed == cmd {
		return &Suggestion{
			Label:     fmt.Sprintf("Yes, allow %s commands", cmd),
			Specifier: cmd,
		}
	}

	return &Suggestion{
		Label:     fmt.Sprintf("Yes, allow all %s commands", cmd),
		Specifier: cmd + " *",
	}
}

// suggestFileWildcard builds a directory-based wildcard for file tools.
func suggestFileWildcard(verb, filePath string) *Suggestion {
	if filePath == "" {
		return nil
	}

	dir := filepath.Dir(filePath)
	if dir == "" || dir == "." {
		// File is in current directory — suggest by extension
		ext := filepath.Ext(filePath)
		if ext != "" {
			return &Suggestion{
				Label:     fmt.Sprintf("Yes, allow %s *%s files", verb, ext),
				Specifier: "*" + ext,
			}
		}
		return nil
	}

	// Use the parent directory as the wildcard base
	dirName := filepath.Base(dir)
	return &Suggestion{
		Label:     fmt.Sprintf("Yes, allow %s %s/", verb, dirName),
		Specifier: dir + "/*",
	}
}
