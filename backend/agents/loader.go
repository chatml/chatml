package agents

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/chatml/chatml-backend/models"
	"gopkg.in/yaml.v3"
)

// Loader handles loading agent definitions from YAML files
type Loader struct {
	basePath string
}

// NewLoader creates a new agent loader
func NewLoader(basePath string) *Loader {
	return &Loader{basePath: basePath}
}

// LoadAll loads all agent definitions from the base path
func (l *Loader) LoadAll() ([]*models.OrchestratorAgent, error) {
	var agents []*models.OrchestratorAgent

	// Find all YAML files in the agents directory
	pattern := filepath.Join(l.basePath, "*.yaml")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("glob agent files: %w", err)
	}

	// Also check for .yml extension
	ymlPattern := filepath.Join(l.basePath, "*.yml")
	ymlFiles, err := filepath.Glob(ymlPattern)
	if err != nil {
		return nil, fmt.Errorf("glob agent yml files: %w", err)
	}
	files = append(files, ymlFiles...)

	for _, file := range files {
		agent, err := l.LoadFile(file)
		if err != nil {
			return nil, fmt.Errorf("load agent %s: %w", file, err)
		}
		agents = append(agents, agent)
	}

	return agents, nil
}

// LoadFile loads a single agent definition from a YAML file
func (l *Loader) LoadFile(path string) (*models.OrchestratorAgent, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	var def models.AgentDefinition
	if err := yaml.Unmarshal(data, &def); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}

	// Validate required fields
	if def.ID == "" {
		return nil, fmt.Errorf("agent definition missing required field: id")
	}
	if def.Name == "" {
		return nil, fmt.Errorf("agent definition missing required field: name")
	}
	if def.Type == "" {
		return nil, fmt.Errorf("agent definition missing required field: type")
	}

	// Parse polling interval to milliseconds
	pollingIntervalMs := 60000 // Default: 1 minute
	if def.Polling != nil && def.Polling.Interval != "" {
		duration, err := time.ParseDuration(def.Polling.Interval)
		if err != nil {
			return nil, fmt.Errorf("parse polling interval: %w", err)
		}
		pollingIntervalMs = int(duration.Milliseconds())
	}

	// Create the agent with definition attached
	agent := &models.OrchestratorAgent{
		ID:                def.ID,
		YAMLPath:          path,
		Enabled:           true, // Default to enabled
		PollingIntervalMs: pollingIntervalMs,
		TotalRuns:         0,
		TotalCost:         0,
		Definition:        &def,
	}

	return agent, nil
}

// ValidateDefinition validates an agent definition
func ValidateDefinition(def *models.AgentDefinition) error {
	if def.ID == "" {
		return fmt.Errorf("missing required field: id")
	}
	if def.Name == "" {
		return fmt.Errorf("missing required field: name")
	}
	if def.Type == "" {
		return fmt.Errorf("missing required field: type")
	}

	// Validate execution mode
	switch def.Execution.Mode {
	case models.AgentModeReadOnly, models.AgentModeCreatesSession, models.AgentModeUsesSession:
		// Valid
	case "":
		return fmt.Errorf("missing required field: execution.mode")
	default:
		return fmt.Errorf("invalid execution mode: %s", def.Execution.Mode)
	}

	// Validate working directory
	switch def.Execution.WorkingDirectory {
	case "root", "session", "":
		// Valid (empty defaults to root)
	default:
		return fmt.Errorf("invalid working directory: %s", def.Execution.WorkingDirectory)
	}

	// Validate polling sources if polling is configured
	if def.Polling != nil {
		for i, source := range def.Polling.Sources {
			switch source.Type {
			case "github", "linear":
				// Valid
			case "":
				return fmt.Errorf("polling source %d missing type", i)
			default:
				return fmt.Errorf("polling source %d has invalid type: %s", i, source.Type)
			}
		}
	}

	return nil
}

// Reload reloads all agent definitions and returns updated agents
func (l *Loader) Reload() ([]*models.OrchestratorAgent, error) {
	return l.LoadAll()
}

// WatchForChanges returns a channel that receives file paths when they change
// This is a simple implementation - a production version would use fsnotify
func (l *Loader) WatchForChanges() <-chan string {
	// For now, return nil - polling will be used instead
	// A future implementation could use fsnotify for file watching
	return nil
}
