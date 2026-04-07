package chatml

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chatml/chatml-core/tool"
)

// --- get_workspace_scripts_config ---

type getWorkspaceScriptsConfigTool struct {
	ctx *ToolContext
}

func (t *getWorkspaceScriptsConfigTool) Name() string           { return "mcp__chatml__get_workspace_scripts_config" }
func (t *getWorkspaceScriptsConfigTool) IsConcurrentSafe() bool { return true }
func (t *getWorkspaceScriptsConfigTool) DeferLoading() bool     { return true }
func (t *getWorkspaceScriptsConfigTool) Description() string {
	return "Read the .chatml/config.json file that defines setup scripts, run scripts, and hooks for this project."
}
func (t *getWorkspaceScriptsConfigTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *getWorkspaceScriptsConfigTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	configPath := filepath.Join(t.ctx.Workdir, ".chatml", "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &tool.Result{Content: "No .chatml/config.json found in this workspace. Use propose_scripts_config to create one."}, nil
		}
		return tool.ErrorResult(fmt.Sprintf("failed to read config: %v", err)), nil
	}

	return &tool.Result{Content: string(data)}, nil
}

// --- propose_scripts_config ---

type proposeScriptsConfigTool struct {
	ctx *ToolContext
}

func (t *proposeScriptsConfigTool) Name() string           { return "mcp__chatml__propose_scripts_config" }
func (t *proposeScriptsConfigTool) IsConcurrentSafe() bool { return true }
func (t *proposeScriptsConfigTool) DeferLoading() bool     { return true }
func (t *proposeScriptsConfigTool) Description() string {
	return "Propose a .chatml/config.json configuration for this project."
}
func (t *proposeScriptsConfigTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"setupScripts": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"name": {"type": "string"},
						"command": {"type": "string"}
					},
					"required": ["name", "command"]
				}
			},
			"runScripts": {"type": "object"},
			"hooks": {"type": "object"},
			"autoSetup": {"type": "boolean"}
		}
	}`)
}

func (t *proposeScriptsConfigTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	// Format the input as a pretty-printed config proposal
	var config map[string]interface{}
	if err := json.Unmarshal(input, &config); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}

	formatted, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to format config: %v", err)), nil
	}

	return &tool.Result{Content: fmt.Sprintf("Proposed .chatml/config.json:\n\n```json\n%s\n```\n\nPlease review and approve before writing to disk.", string(formatted))}, nil
}
