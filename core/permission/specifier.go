// Package permission implements the permission system for the native Go agentic loop.
// It evaluates whether tool calls should be allowed, denied, or need user approval
// based on the current permission mode, persistent rules, and session-scoped decisions.
package permission

import (
	"encoding/json"
	"net/url"
	"strings"
)

// BuildSpecifier extracts a human-readable specifier from a tool's input.
// The specifier is used for rule matching and is shown to the user in approval dialogs.
// Returns "" if no meaningful specifier can be derived.
func BuildSpecifier(toolName string, input json.RawMessage) string {
	switch toolName {
	case "Bash":
		return extractStringField(input, "command")

	case "Read", "Write", "Edit":
		return extractStringField(input, "file_path")

	case "NotebookEdit":
		return extractStringField(input, "notebook_path")

	case "WebFetch":
		rawURL := extractStringField(input, "url")
		if rawURL == "" {
			return ""
		}
		parsed, err := url.Parse(rawURL)
		if err != nil {
			return ""
		}
		host := parsed.Hostname()
		if host == "" {
			return ""
		}
		return "domain:" + host

	case "Glob":
		return extractStringField(input, "pattern")

	case "Grep":
		return extractStringField(input, "pattern")

	default:
		// MCP tools: use the tool name itself as the specifier
		if strings.HasPrefix(toolName, "mcp__") {
			return toolName
		}
		return ""
	}
}

// extractStringField unmarshals a JSON object and returns the value of the named field.
func extractStringField(input json.RawMessage, field string) string {
	if len(input) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(input, &m); err != nil {
		return ""
	}
	raw, ok := m[field]
	if !ok {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return ""
	}
	return s
}
