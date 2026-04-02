package loop

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/permission"
	"github.com/chatml/chatml-backend/provider"
	"github.com/chatml/chatml-backend/provider/anthropic"
	"github.com/chatml/chatml-backend/tool"
	"github.com/chatml/chatml-backend/tool/builtin"
)

// NewBackendFactory returns an agent.NativeBackendFactory that creates Runner instances
// with the full built-in tool set. Register with Manager.SetNativeBackendFactory at startup.
func NewBackendFactory() agent.NativeBackendFactory {
	return func(opts agent.ProcessOptions, apiKey, oauthToken string) (agent.ConversationBackend, error) {
		cfg := anthropic.Config{
			APIKey:     apiKey,
			OAuthToken: oauthToken,
			Model:      opts.Model,
		}

		prov, err := anthropic.New(cfg)
		if err != nil {
			return nil, fmt.Errorf("create anthropic provider: %w", err)
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
