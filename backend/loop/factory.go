package loop

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/permission"
	"github.com/chatml/chatml-backend/prompt"
	"github.com/chatml/chatml-backend/provider"
	"github.com/chatml/chatml-backend/provider/anthropic"
	"github.com/chatml/chatml-backend/provider/openai"
	"github.com/chatml/chatml-backend/tool"
	"github.com/chatml/chatml-backend/tool/builtin"
)

// NewBackendFactory returns an agent.NativeBackendFactory that creates Runner instances
// with the full built-in tool set. Register with Manager.SetNativeBackendFactory at startup.
func NewBackendFactory() agent.NativeBackendFactory {
	return func(opts agent.ProcessOptions, apiKey, oauthToken string) (agent.ConversationBackend, error) {
		// Select provider based on model name
		prov, err := createProvider(opts.Model, apiKey, oauthToken)
		if err != nil {
			return nil, fmt.Errorf("create provider: %w", err)
		}

		// Initialize permission engine
		var rules *permission.RuleSet
		if opts.PermissionRulesFile != "" {
			var err error
			rules, err = permission.LoadRulesFromFile(opts.PermissionRulesFile)
			if err != nil {
				log.Printf("warning: failed to load permission rules from %s: %v", opts.PermissionRulesFile, err)
			}
		}
		if rules == nil {
			rules = permission.NewRuleSet(nil)
		}

		mode := opts.PermissionMode
		if mode == "" {
			mode = permission.ModeBypassPermissions
		}
		permEngine := permission.NewEngineWithWorkdir(mode, rules, opts.Workdir)

		// Pre-compute git config for enriched system prompt
		promptCfg := prompt.BuilderConfig{
			Workdir:      opts.Workdir,
			Model:        opts.Model,
			Instructions: opts.Instructions,
			FastMode:     opts.FastMode,
		}
		// Set model marketing name + ID based on model
		promptCfg.ModelMarketingName, promptCfg.ModelID, promptCfg.KnowledgeCutoff = modelInfo(opts.Model)
		prompt.PrecomputeGitConfig(&promptCfg)

		// Create runner first (needed for callbacks)
		runner := NewRunnerFull(opts, provider.Provider(prov), nil, permEngine)
		runner.promptBuilder = prompt.NewBuilderWithConfig(promptCfg)

		// Create tool registry with callbacks wired to the runner
		registry := tool.NewRegistry()
		builtin.RegisterAllWithCallbacks(registry, opts.Workdir, &builtin.Callbacks{
			EmitEvent: func(eventType string, data interface{}) {
				// Convert data to []TodoItem for todo_update events
				if eventType == "todo_update" {
					if raw, err := json.Marshal(data); err == nil {
						var todos []agent.TodoItem
						if json.Unmarshal(raw, &todos) == nil {
							runner.emitter.emit(&agent.AgentEvent{
								Type:  eventType,
								Todos: todos,
							})
							return
						}
					}
				}
				// Fallback: emit generic event
				runner.emitter.emit(&agent.AgentEvent{Type: eventType})
			},
			UserQuestion: runner,
			PlanMode:     runner,
		})

		// Wire the registry into the runner
		runner.toolRegistry = registry
		runner.toolExecutor = tool.NewExecutor(registry, 8)
		runner.streamingToolExecEnabled = true

		// Initialize tool result persister for large outputs.
		// Uses a session-specific temp directory to avoid polluting the workdir
		// and to isolate concurrent sessions from each other.
		if opts.Workdir != "" {
			sessionDir, err := os.MkdirTemp("", "chatml-tool-results-*")
			if err != nil {
				log.Printf("warning: failed to create tool results temp dir: %v (using workdir fallback)", err)
				sessionDir = opts.Workdir
			}
			runner.resultPersister = tool.NewResultPersister(sessionDir)
		}

		// Set fallback model: if primary is Opus, fallback to Sonnet.
		// Both are Anthropic models so reusing runner.provider is safe.
		// If fallback ever crosses provider boundaries, a new provider
		// instance must be created (see createProvider).
		if strings.HasPrefix(opts.Model, "claude-opus") {
			runner.fallbackModel = "claude-sonnet-4-6"
		}

		return runner, nil
	}
}

// createProvider selects and creates the appropriate LLM provider based on model name.
// OpenAI models (gpt-*, o1-/o1.*, o3-/o3.*, o4-/o4.*) use the OpenAI provider.
// Everything else defaults to Anthropic.
func createProvider(model, apiKey, oauthToken string) (provider.Provider, error) {
	if isOpenAIModel(model) {
		// OpenAI models use the API key directly
		cfg := openai.Config{
			APIKey: apiKey,
			Model:  model,
		}
		return openai.New(cfg)
	}

	// Default: Anthropic
	cfg := anthropic.Config{
		APIKey:     apiKey,
		OAuthToken: oauthToken,
		Model:      model,
	}
	return anthropic.New(cfg)
}

// modelInfo returns the marketing name, model ID, and knowledge cutoff for known models.
func modelInfo(model string) (marketingName, modelID, cutoff string) {
	switch {
	case strings.Contains(model, "opus-4-6"):
		return "Opus 4.6 (1M context)", model, "May 2025"
	case strings.Contains(model, "sonnet-4-6"):
		return "Sonnet 4.6", model, "May 2025"
	case strings.Contains(model, "haiku-4-5"):
		return "Haiku 4.5", model, "May 2025"
	case strings.Contains(model, "sonnet-4-5"):
		return "Sonnet 4.5", model, "May 2025"
	case strings.HasPrefix(model, "claude-"):
		return model, model, "May 2025"
	default:
		return model, model, ""
	}
}

// isOpenAIModel returns true if the model name indicates an OpenAI model.
// Uses exact matches for bare names ("o1", "o3", "o4") and prefix matches
// with delimiters for versioned names to avoid matching non-OpenAI models.
func isOpenAIModel(model string) bool {
	// Exact bare model names
	switch model {
	case "o1", "o3", "o4":
		return true
	}
	// Prefixed model names (with delimiter: dash or dot)
	openAIPrefixes := []string{"gpt-", "o1-", "o1.", "o3-", "o3.", "o4-", "o4."}
	for _, prefix := range openAIPrefixes {
		if strings.HasPrefix(model, prefix) {
			return true
		}
	}
	return false
}
