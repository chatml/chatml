package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-core/tool"
)

// AgentSpawner is implemented by Runner to create sub-agent runners.
type AgentSpawner interface {
	SpawnSubAgent(ctx context.Context, opts SubAgentOpts) (*SubAgentResult, error)
}

// SubAgentOpts contains options for spawning a sub-agent.
type SubAgentOpts struct {
	Prompt      string
	Model       string
	Tools       []string
	MaxTurns    int
	Description string

	// Fork mode: if true, the sub-agent inherits the parent's full conversation
	// context (message history). This enables prompt cache sharing — the forked
	// agent sends byte-identical API prefixes, getting cache hits on the parent's
	// system prompt and early messages.
	Fork bool

	// RunInBackground: if true, the agent runs asynchronously. The tool returns
	// immediately with the agent ID; use SendMessage to communicate with it later.
	RunInBackground bool

	// Name: addressable name for the agent (for SendMessage targeting).
	Name string

	// Isolation: "worktree" creates a temporary git worktree for the agent.
	Isolation string
}

// SubAgentResult contains the result of a sub-agent execution.
type SubAgentResult struct {
	Output     string
	ToolUses   int
	Tokens     int
	DurationMs int64
	Success    bool
	AgentID    string // Set for background agents
}

// AgentDef defines a built-in agent type with preset tools, model, and turn limit.
type AgentDef struct {
	Description string
	Tools       []string
	Model       string
	MaxTurns    int
}

var builtinAgents = map[string]AgentDef{
	"explore":        {Description: "Fast codebase exploration", Tools: []string{"Read", "Glob", "Grep"}, Model: "haiku", MaxTurns: 15},
	"test-runner":    {Description: "Run tests and fix failures", Tools: []string{"Read", "Glob", "Grep", "Bash", "Edit"}, Model: "sonnet", MaxTurns: 30},
	"self-review":    {Description: "Code review", Tools: []string{"Read", "Glob", "Grep", "WebSearch"}, Model: "opus"},
	"security-audit": {Description: "Security-focused review", Tools: []string{"Read", "Glob", "Grep"}, Model: "opus", MaxTurns: 20},
}

// AgentTool spawns sub-agent runners for delegating complex tasks.
type AgentTool struct {
	mu      sync.Mutex
	spawner AgentSpawner
}

// NewAgentTool creates a new AgentTool. The spawner is typically the Runner.
func NewAgentTool(spawner AgentSpawner) *AgentTool {
	return &AgentTool{spawner: spawner}
}

// SetSpawner sets the AgentSpawner after construction (for deferred wiring).
// Thread-safe: protected by mutex since Execute may read spawner concurrently.
func (t *AgentTool) SetSpawner(spawner AgentSpawner) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.spawner = spawner
}

func (t *AgentTool) Name() string { return "Agent" }

func (t *AgentTool) Description() string {
	return `Spawns a sub-agent to handle a complex task independently. The sub-agent has access to the same tools and works in the same workspace, but operates in its own conversation context. Use for tasks that require exploration, multi-step operations, or parallel workstreams.`
}

func (t *AgentTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"prompt": {
				"type": "string",
				"description": "The task for the sub-agent to complete"
			},
			"description": {
				"type": "string",
				"description": "Short description of what the agent will do (shown to the user)"
			},
			"subagent_type": {
				"type": "string",
				"enum": ["general-purpose", "explore", "test-runner", "self-review", "security-audit"],
				"description": "Agent type — determines available tools and model"
			},
			"model": {
				"type": "string",
				"enum": ["sonnet", "opus", "haiku"],
				"description": "Optional model override for the sub-agent"
			},
			"run_in_background": {
				"type": "boolean",
				"description": "Run agent in background. Returns immediately with agent ID."
			},
			"name": {
				"type": "string",
				"description": "Addressable name for the agent (for SendMessage targeting)"
			},
			"isolation": {
				"type": "string",
				"enum": ["worktree"],
				"description": "Isolation mode. 'worktree' creates a temporary git worktree."
			}
		},
		"required": ["prompt", "description"]
	}`)
}

func (t *AgentTool) IsConcurrentSafe() bool { return false }

type agentInput struct {
	Prompt          string `json:"prompt"`
	Description     string `json:"description"`
	SubagentType    string `json:"subagent_type"`
	Model           string `json:"model"`
	RunInBackground bool   `json:"run_in_background"`
	Name            string `json:"name"`
	Isolation       string `json:"isolation"`
}

func (t *AgentTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	t.mu.Lock()
	spawner := t.spawner
	t.mu.Unlock()
	if spawner == nil {
		return tool.ErrorResult("Agent tool not initialized: no spawner configured"), nil
	}

	var in agentInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if strings.TrimSpace(in.Prompt) == "" {
		return tool.ErrorResult("prompt cannot be empty"), nil
	}
	if strings.TrimSpace(in.Description) == "" {
		return tool.ErrorResult("description cannot be empty"), nil
	}

	opts := SubAgentOpts{
		Prompt:          in.Prompt,
		Model:           in.Model,
		MaxTurns:        30,
		Description:     in.Description,
		RunInBackground: in.RunInBackground,
		Name:            in.Name,
		Isolation:       in.Isolation,
	}

	// Fork mode: when no subagent_type is specified, the agent inherits the
	// parent's full conversation context for prompt cache sharing. This matches
	// Claude Code's fork subagent behavior.
	if in.SubagentType == "" || in.SubagentType == "general-purpose" {
		opts.Fork = true
	}

	// Enrich from built-in agent definition if subagent_type is specified
	if in.SubagentType != "" && in.SubagentType != "general-purpose" {
		if def, ok := builtinAgents[in.SubagentType]; ok {
			if opts.Model == "" {
				opts.Model = def.Model
			}
			if def.MaxTurns > 0 {
				if opts.MaxTurns == 0 || opts.MaxTurns > def.MaxTurns {
					opts.MaxTurns = def.MaxTurns
				}
			}
			opts.Tools = def.Tools
		}
	}

	start := time.Now()
	result, err := spawner.SpawnSubAgent(ctx, opts)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Sub-agent failed: %v", err)), nil
	}

	elapsed := time.Since(start)
	if result.DurationMs == 0 {
		result.DurationMs = elapsed.Milliseconds()
	}

	// Background launch: return immediately with agent ID
	if result.AgentID != "" && in.RunInBackground {
		return tool.TextResult(fmt.Sprintf(
			`{"status": "async_launched", "agentId": %q, "description": %q}`,
			result.AgentID, in.Description,
		)), nil
	}

	// Format token count for display
	tokenStr := fmt.Sprintf("%dk", result.Tokens/1000)
	if result.Tokens < 1000 {
		tokenStr = fmt.Sprintf("%d", result.Tokens)
	}

	// Format duration for display
	durationStr := fmt.Sprintf("%.1fs", float64(result.DurationMs)/1000)

	summary := fmt.Sprintf("Agent completed: %d tool uses, %s tokens, %s", result.ToolUses, tokenStr, durationStr)
	if !result.Success {
		summary = fmt.Sprintf("Agent finished with errors: %d tool uses, %s tokens, %s", result.ToolUses, tokenStr, durationStr)
	}

	content := fmt.Sprintf("%s\n\nOutput:\n%s", summary, result.Output)

	return &tool.Result{
		Content: content,
		IsError: !result.Success,
	}, nil
}

// Prompt implements tool.PromptProvider with instructions on when to use sub-agents.
func (t *AgentTool) Prompt() string {
	return `Launch a new agent that has access to the same tools as you. Use this when a task can benefit from independent exploration or execution without cluttering your own context.

When to use Agent:
- **Exploring**: When you need to search a codebase, read multiple files, or investigate a question without filling your context with exploration artifacts.
- **Multi-step tasks**: When a task requires many tool calls (e.g., modifying several files, running tests, iterating on a fix).
- **Parallel work**: When you have independent subtasks that don't depend on each other.
- **Uncertain tasks**: When you're not sure how to approach something and want to explore without committing context.

When NOT to use Agent:
- Simple, single-tool operations (just do them directly).
- Tasks that require your current conversation context (the sub-agent starts fresh).
- When the user is expecting interactive back-and-forth (the sub-agent runs to completion).

Guidelines:
- Write a clear, detailed prompt for the sub-agent. Include all necessary context since it does not see your conversation history.
- Use the description field to give the user a short summary of what the agent is doing.
- The sub-agent works in the same workspace directory and has the same permissions.
- Choose subagent_type wisely: "Explore" for read-only investigation (15 turn limit), "Plan" for planning tasks (20 turn limit), or leave empty for general work (30 turn limit).`
}

var _ tool.Tool = (*AgentTool)(nil)
var _ tool.PromptProvider = (*AgentTool)(nil)
