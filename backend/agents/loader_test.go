package agents

import (
	"path/filepath"
	"testing"
)

func TestLoader_LoadAll(t *testing.T) {
	// Get the agents directory relative to the test
	agentsDir := filepath.Join("..", "..", "agents")

	loader := NewLoader(agentsDir)
	agents, err := loader.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll failed: %v", err)
	}

	if len(agents) < 2 {
		t.Errorf("Expected at least 2 agents, got %d", len(agents))
	}

	// Verify github-monitor loaded correctly
	var githubAgent, linearAgent bool
	for _, agent := range agents {
		if agent.ID == "github-monitor" {
			githubAgent = true
			if agent.Definition == nil {
				t.Error("github-monitor: Definition is nil")
			} else {
				if agent.Definition.Name != "GitHub Monitor" {
					t.Errorf("github-monitor: expected name 'GitHub Monitor', got '%s'", agent.Definition.Name)
				}
				if agent.Definition.Type != "monitor" {
					t.Errorf("github-monitor: expected type 'monitor', got '%s'", agent.Definition.Type)
				}
				if agent.PollingIntervalMs != 60000 {
					t.Errorf("github-monitor: expected polling interval 60000ms, got %d", agent.PollingIntervalMs)
				}
			}
		}
		if agent.ID == "linear-sync" {
			linearAgent = true
			if agent.PollingIntervalMs != 120000 {
				t.Errorf("linear-sync: expected polling interval 120000ms, got %d", agent.PollingIntervalMs)
			}
		}
	}

	if !githubAgent {
		t.Error("github-monitor agent not found")
	}
	if !linearAgent {
		t.Error("linear-sync agent not found")
	}
}

func TestLoader_LoadFile(t *testing.T) {
	agentsDir := filepath.Join("..", "..", "agents")
	loader := NewLoader(agentsDir)

	agent, err := loader.LoadFile(filepath.Join(agentsDir, "github-monitor.yaml"))
	if err != nil {
		t.Fatalf("LoadFile failed: %v", err)
	}

	if agent.ID != "github-monitor" {
		t.Errorf("Expected ID 'github-monitor', got '%s'", agent.ID)
	}

	if agent.Definition == nil {
		t.Fatal("Definition is nil")
	}

	if len(agent.Definition.Capabilities) != 2 {
		t.Errorf("Expected 2 capabilities, got %d", len(agent.Definition.Capabilities))
	}

	if agent.Definition.Polling == nil {
		t.Fatal("Polling config is nil")
	}

	if len(agent.Definition.Polling.Sources) != 1 {
		t.Errorf("Expected 1 polling source, got %d", len(agent.Definition.Polling.Sources))
	}

	if agent.Definition.Polling.Sources[0].Type != "github" {
		t.Errorf("Expected source type 'github', got '%s'", agent.Definition.Polling.Sources[0].Type)
	}
}
