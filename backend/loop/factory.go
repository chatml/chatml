package loop

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/permission"
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

		// Create runner first (needed for callbacks)
		runner := NewRunnerFull(opts, provider.Provider(prov), nil, permEngine)

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

		return runner, nil
	}
}

// createProvider selects and creates the appropriate LLM provider based on model name.
// OpenAI models (gpt-*, o1*, o3*, o4*) use the OpenAI provider.
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

// isOpenAIModel returns true if the model name indicates an OpenAI model.
func isOpenAIModel(model string) bool {
	openAIPrefixes := []string{"gpt-", "o1", "o3", "o4"}
	for _, prefix := range openAIPrefixes {
		if strings.HasPrefix(model, prefix) {
			return true
		}
	}
	return false
}
