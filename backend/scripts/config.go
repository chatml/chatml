package scripts

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	// ConfigDir is the directory name within a workspace root
	ConfigDir = ".chatml"
	// ConfigFile is the config file name
	ConfigFile = "config.json"
)

// ChatMLConfig represents the .chatml/config.json file
type ChatMLConfig struct {
	SetupScripts []ScriptDef          `json:"setupScripts,omitempty"`
	RunScripts   map[string]ScriptDef `json:"runScripts,omitempty"`
	Hooks        map[string]string    `json:"hooks,omitempty"`
	AutoSetup    bool                 `json:"autoSetup"`
}

// ScriptDef defines a named script command
type ScriptDef struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

// ConfigPath returns the full path to .chatml/config.json for a given workspace
func ConfigPath(workspacePath string) string {
	return filepath.Join(workspacePath, ConfigDir, ConfigFile)
}

// LoadConfig reads and parses .chatml/config.json from the workspace path.
// Returns nil config with no error if the file doesn't exist.
func LoadConfig(workspacePath string) (*ChatMLConfig, error) {
	path := ConfigPath(workspacePath)

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}

	var config ChatMLConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if err := ValidateConfig(&config); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return &config, nil
}

// WriteConfig writes the config to .chatml/config.json, creating the directory if needed.
func WriteConfig(workspacePath string, config *ChatMLConfig) error {
	if err := ValidateConfig(config); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	dir := filepath.Join(workspacePath, ConfigDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	// Add trailing newline
	data = append(data, '\n')

	path := ConfigPath(workspacePath)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write config: %w", err)
	}

	return nil
}

// ValidateConfig checks a config for errors
func ValidateConfig(config *ChatMLConfig) error {
	if config == nil {
		return errors.New("config is nil")
	}

	var errs []string

	for i, s := range config.SetupScripts {
		if strings.TrimSpace(s.Command) == "" {
			errs = append(errs, fmt.Sprintf("setupScripts[%d]: command is empty", i))
		}
		if strings.TrimSpace(s.Name) == "" {
			errs = append(errs, fmt.Sprintf("setupScripts[%d]: name is empty", i))
		}
	}

	for key, s := range config.RunScripts {
		if strings.TrimSpace(s.Command) == "" {
			errs = append(errs, fmt.Sprintf("runScripts[%q]: command is empty", key))
		}
		if strings.TrimSpace(s.Name) == "" {
			errs = append(errs, fmt.Sprintf("runScripts[%q]: name is empty", key))
		}
	}

	for hookName, cmd := range config.Hooks {
		if strings.TrimSpace(cmd) == "" {
			errs = append(errs, fmt.Sprintf("hooks[%q]: command is empty", hookName))
		}
		// Only allow known hook names
		switch hookName {
		case "pre-session", "post-session", "post-merge":
			// valid
		default:
			errs = append(errs, fmt.Sprintf("hooks[%q]: unknown hook name", hookName))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}

	return nil
}
