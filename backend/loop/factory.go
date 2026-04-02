package loop

import (
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

		// Create tool registry with all built-in tools
		registry := tool.NewRegistry()
		builtin.RegisterAll(registry, opts.Workdir)

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

		return NewRunnerFull(opts, provider.Provider(prov), registry, permEngine), nil
	}
}
