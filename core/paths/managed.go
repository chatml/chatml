// Package paths provides platform-specific path resolution for managed settings,
// user configuration, and other system directories.
package paths

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

// ManagedSettingsDir returns the platform-specific directory for organization-managed settings.
// These are deployed by IT/MDM and have highest priority.
//
//	macOS:   /Library/Application Support/ClaudeCode/
//	Linux:   /etc/claude-code/
//	Windows: C:\Program Files\ClaudeCode\
func ManagedSettingsDir() string {
	switch runtime.GOOS {
	case "darwin":
		return "/Library/Application Support/ClaudeCode"
	case "windows":
		return `C:\Program Files\ClaudeCode`
	default: // linux, freebsd, etc.
		return "/etc/claude-code"
	}
}

// ManagedSettingsDropInDir returns the directory for drop-in managed settings files.
// Files in this directory are merged alphabetically on top of the base managed-settings.json.
func ManagedSettingsDropInDir() string {
	return filepath.Join(ManagedSettingsDir(), "managed-settings.d")
}

// LoadManagedSettings loads and merges all managed settings.
// Returns nil if no managed settings exist (typical for non-enterprise installs).
func LoadManagedSettings() map[string]interface{} {
	baseDir := ManagedSettingsDir()

	// Load base managed-settings.json
	basePath := filepath.Join(baseDir, "managed-settings.json")
	base := loadJSONFile(basePath)

	// Load drop-in files and merge alphabetically
	dropInDir := ManagedSettingsDropInDir()
	entries, err := os.ReadDir(dropInDir)
	if err != nil {
		return base // No drop-in directory
	}

	// Sort alphabetically
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		dropIn := loadJSONFile(filepath.Join(dropInDir, entry.Name()))
		if dropIn != nil {
			base = mergeSettings(base, dropIn)
		}
	}

	return base
}

// UserSettingsDir returns the user-level settings directory.
func UserSettingsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".claude")
}

// ProjectSettingsDir returns the project-level settings directory for a workspace.
func ProjectSettingsDir(workdir string) string {
	if workdir == "" {
		return ""
	}
	return filepath.Join(workdir, ".claude")
}

// DangerousEnvVars are environment variables that could redirect traffic,
// bypass TLS, or exfiltrate credentials if set by a malicious .mcp.json or settings file.
var DangerousEnvVars = map[string]bool{
	"ANTHROPIC_BASE_URL":            true,
	"HTTP_PROXY":                    true,
	"HTTPS_PROXY":                   true,
	"NO_PROXY":                      true,
	"NODE_TLS_REJECT_UNAUTHORIZED":  true,
	"NODE_EXTRA_CA_CERTS":           true,
	"OTEL_EXPORTER_OTLP_ENDPOINT":   true,
	"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT":    true,
	"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": true,
}

// SafeEnvVarPrefixes are environment variable prefixes that are safe to set
// from settings files without user confirmation.
var SafeEnvVarPrefixes = []string{
	"ANTHROPIC_CUSTOM_",
	"ANTHROPIC_DEFAULT_",
	"AWS_",
	"BASH_",
	"CLAUDE_CODE_",
	"OTEL_RESOURCE_",
	"VERTEX_REGION_",
}

// IsEnvVarInAllowlist returns true if the environment variable is in the allowlist for settings.
func IsEnvVarInAllowlist(name string) bool {
	if DangerousEnvVars[name] {
		return false
	}
	for _, prefix := range SafeEnvVarPrefixes {
		if len(name) >= len(prefix) && name[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}

// --- Helpers ---

func loadJSONFile(path string) map[string]interface{} {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var result map[string]interface{}
	if json.Unmarshal(data, &result) != nil {
		return nil
	}
	return result
}

// mergeSettings deep-merges src into dst (src values override dst).
func mergeSettings(dst, src map[string]interface{}) map[string]interface{} {
	if dst == nil {
		dst = make(map[string]interface{})
	}
	for k, v := range src {
		if srcMap, ok := v.(map[string]interface{}); ok {
			if dstMap, ok := dst[k].(map[string]interface{}); ok {
				dst[k] = mergeSettings(dstMap, srcMap)
				continue
			}
		}
		dst[k] = v
	}
	return dst
}
