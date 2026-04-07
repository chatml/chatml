package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chatml/chatml-core/agent"
	"github.com/chatml/chatml-core/hook"
	"github.com/chatml/chatml-core/mcp"
	"github.com/chatml/chatml-core/skills"
	"github.com/chatml/chatml-core/permission"
	"github.com/chatml/chatml-core/prompt"
	"github.com/chatml/chatml-core/provider"
	"github.com/chatml/chatml-core/provider/anthropic"
	ollamaprov "github.com/chatml/chatml-core/provider/ollama"
	"github.com/chatml/chatml-core/provider/openai"
	"github.com/chatml/chatml-core/task"
	"github.com/chatml/chatml-core/tool"
	"github.com/chatml/chatml-core/tool/builtin"
)

// NewBackendFactory returns an agent.NativeBackendFactory that creates Runner instances
// with the full built-in tool set. Register with Manager.SetNativeBackendFactory at startup.
func NewBackendFactory() agent.NativeBackendFactory {
	return func(opts agent.ProcessOptions, apiKey, oauthToken string) (agent.ConversationBackend, error) {
		// Select provider based on model name
		prov, err := createProvider(opts.Model, apiKey, oauthToken, opts.OllamaEndpoint)
		if err != nil {
			return nil, fmt.Errorf("create provider: %w", err)
		}

		// Initialize permission engine with multi-source rules.
		// Priority: explicit file > multi-source (policy > user > project > local)
		var rules *permission.RuleSet
		if opts.PermissionRulesFile != "" {
			var err error
			rules, err = permission.LoadRulesFromFile(opts.PermissionRulesFile)
			if err != nil {
				log.Printf("warning: failed to load permission rules from %s: %v", opts.PermissionRulesFile, err)
			}
		}
		if rules == nil {
			// Load from all standard locations (user, project, local settings)
			rules = permission.LoadMultiSourceRules(opts.Workdir)
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

		// Load skills from all standard locations
		skillCatalog := skills.LoadAll(opts.Workdir)

		// Create task manager for Tasks v2
		taskMgr := task.NewManager()

		// Create tool registry with callbacks wired to the runner
		registry := tool.NewRegistry()
		callbacks := &builtin.Callbacks{
			WebSearchAPIKey: os.Getenv("BRAVE_SEARCH_API_KEY"),
			WorkdirSetter:   runner, // Runner implements WorkdirSetter
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
			AgentSpawner: runner,
			TaskManager:  taskMgr,
			SkillCatalog: skillCatalog,
		}
		builtin.RegisterAllWithCallbacks(registry, opts.Workdir, callbacks)

		// Capture the read tracker for post-compact context restoration
		runner.readTracker = callbacks.ReadTrackerOut

		// Wire the registry into the runner
		runner.toolRegistry = registry
		runner.toolExecutor = tool.NewExecutor(registry, 8)
		runner.streamingToolExecEnabled = true

		// Initialize tool result persister for large outputs.
		// Uses a session-specific temp directory to avoid polluting the workdir
		// and to isolate concurrent sessions from each other.
		// NOTE: This temp dir is cleaned up by Runner.cleanup(). If factory initialization
		// is ever changed to return errors after this point, a cleanup-on-error path should be added.
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
		// Local models have no fallback — there's no equivalent cloud model to fall back to.
		if strings.HasPrefix(opts.Model, "claude-opus") && !isLocalModel(opts.Model) {
			runner.fallbackModel = "claude-sonnet-4-6"
		}

		// Connect to external MCP servers and register their tools.
		// Config sources in merge order (earlier name wins on collision):
		// 1. .mcp.json (project-level, if trusted)
		// 2. ~/.claude/settings.json mcpServers (user-level, always trusted)
		// 3. .claude/settings.json mcpServers (project-level, if trusted)
		// 4. opts.McpServersJSON (backend-provided user configs)
		mcpMgr := mcp.NewManager()
		var allConfigs []mcp.ServerConfig
		seen := make(map[string]bool)
		addConfigs := func(configs []mcp.ServerConfig) {
			for _, cfg := range configs {
				if !seen[cfg.Name] {
					seen[cfg.Name] = true
					allConfigs = append(allConfigs, cfg)
				}
			}
		}

		// 1. .mcp.json from workspace (project-level, gated by trust)
		if opts.Workdir != "" && !opts.SkipDotMcp {
			if configs, err := mcp.LoadMCPConfig(opts.Workdir); err != nil {
				log.Printf("warning: failed to load .mcp.json: %v", err)
			} else {
				addConfigs(configs)
			}
		}

		// 2. ~/.claude/settings.json (user-level, always trusted)
		if home, err := os.UserHomeDir(); err == nil {
			if configs, err := mcp.LoadMCPConfigFromSettings(filepath.Join(home, ".claude", "settings.json")); err == nil {
				addConfigs(configs)
			}
		}

		// 3. .claude/settings.json (project-level, gated by trust)
		if opts.Workdir != "" && !opts.SkipDotMcp {
			if configs, err := mcp.LoadMCPConfigFromSettings(filepath.Join(opts.Workdir, ".claude", "settings.json")); err == nil {
				addConfigs(configs)
			}
		}

		// 4. Backend-provided MCP servers from user settings. Trusted because
		//    configs are validated by the backend before storage (the settings
		//    API only accepts well-formed server configs) and only the session
		//    owner can write to their own settings. The Command field is
		//    executed via exec.Command — do not expose this path to untrusted input.
		if opts.McpServersJSON != "" {
			var backendConfigs []mcp.ServerConfig
			if err := json.Unmarshal([]byte(opts.McpServersJSON), &backendConfigs); err != nil {
				log.Printf("warning: failed to parse McpServersJSON: %v", err)
			} else {
				addConfigs(backendConfigs)
			}
		}

		// Connect to each enabled server
		for _, cfg := range allConfigs {
			if !cfg.Enabled {
				continue
			}
			if cfg.Type != "" && cfg.Type != "stdio" {
				log.Printf("warning: skipping MCP server %q (unsupported transport: %s)", cfg.Name, cfg.Type)
				continue
			}
			connCtx, connCancel := context.WithTimeout(context.Background(), 15*time.Second)
			if _, err := mcpMgr.ConnectServer(connCtx, cfg); err != nil {
				log.Printf("warning: failed to connect MCP server %q: %v", cfg.Name, err)
			} else {
				log.Printf("Connected MCP server: %s", cfg.Name)
			}
			connCancel()
		}

		count := mcpMgr.RegisterTools(registry)
		if count > 0 {
			log.Printf("Registered %d MCP tools from %d servers", count, len(mcpMgr.ConnectedServers()))
		}
		runner.mcpManager = mcpMgr

		// Initialize hook engine from multiple sources:
		// 1. User-level hooks (~/.claude/settings.json)
		// 2. Project-level hooks (.claude/hooks.json or .claude/settings.json or .chatml/config.json)
		userHookConfig := hook.LoadUserConfig()
		projectHookConfig := hook.LoadConfig(opts.Workdir)
		mergedHookConfig := hook.MergeConfigs(userHookConfig, projectHookConfig)
		runner.hookEngine = hook.NewEngine(opts.Workdir, mergedHookConfig)

		return runner, nil
	}
}

// createProvider selects and creates the appropriate LLM provider based on model name.
// Local models (gemma-4-*, ollama/*) use the Ollama provider.
// OpenAI models (gpt-*, o1-/o1.*, o3-/o3.*, o4-/o4.*) use the OpenAI provider.
// Everything else defaults to Anthropic.
func createProvider(model, apiKey, oauthToken, ollamaEndpoint string) (provider.Provider, error) {
	if isLocalModel(model) {
		if ollamaEndpoint == "" {
			return nil, fmt.Errorf("ollama endpoint required for local model %q", model)
		}
		cfg := ollamaprov.Config{
			Model:    toOllamaModelName(model),
			Endpoint: ollamaEndpoint,
		}
		return ollamaprov.New(cfg)
	}

	if isOpenAIModel(model) {
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
	// Check local models first via canonical catalog
	if def := ollamaprov.LookupByID(model); def != nil {
		return def.DisplayName, model, def.Cutoff
	}

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

// isLocalModel delegates to the canonical catalog in core/provider/ollama.
func isLocalModel(model string) bool {
	return ollamaprov.IsLocalModel(model)
}

// toOllamaModelName delegates to the canonical catalog in core/provider/ollama.
func toOllamaModelName(model string) string {
	return ollamaprov.ToOllamaName(model)
}

// resolveModelAlias converts short model aliases to full Anthropic model IDs.
// Used by sub-agents whose built-in definitions use "haiku", "sonnet", "opus".
func resolveModelAlias(model string) string {
	switch strings.ToLower(model) {
	case "haiku":
		return "claude-haiku-4-5-20251001"
	case "sonnet":
		return "claude-sonnet-4-6"
	case "opus":
		return "claude-opus-4-6"
	default:
		return model // Already a full model ID
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
