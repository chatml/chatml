package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
)

// getReviewPrompts reads review prompt overrides from the given settings key.
func (h *Handlers) getReviewPrompts(w http.ResponseWriter, ctx context.Context, key string) {
	value, found, err := h.store.GetSetting(ctx, key)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		writeJSON(w, map[string]any{"prompts": map[string]string{}})
		return
	}

	var prompts map[string]string
	if err := json.Unmarshal([]byte(value), &prompts); err != nil {
		writeError(w, http.StatusInternalServerError, ErrCodeInternal, "corrupted review prompts data", err)
		return
	}

	writeJSON(w, map[string]any{"prompts": prompts})
}

// setReviewPrompts writes review prompt overrides to the given settings key.
func (h *Handlers) setReviewPrompts(w http.ResponseWriter, r *http.Request, key string) {
	ctx := r.Context()

	var req struct {
		Prompts map[string]string `json:"prompts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if len(req.Prompts) == 0 {
		if err := h.store.DeleteSetting(ctx, key); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		data, err := json.Marshal(req.Prompts)
		if err != nil {
			writeValidationError(w, "failed to encode prompts")
			return
		}
		if err := h.store.SetSetting(ctx, key, string(data)); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// GetReviewPrompts returns the global custom review prompt overrides
func (h *Handlers) GetReviewPrompts(w http.ResponseWriter, r *http.Request) {
	h.getReviewPrompts(w, r.Context(), "review-prompts")
}

// SetReviewPrompts updates the global custom review prompt overrides
func (h *Handlers) SetReviewPrompts(w http.ResponseWriter, r *http.Request) {
	h.setReviewPrompts(w, r, "review-prompts")
}

// GetWorkspaceReviewPrompts returns the per-workspace custom review prompt overrides
func (h *Handlers) GetWorkspaceReviewPrompts(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	h.getReviewPrompts(w, r.Context(), fmt.Sprintf("review-prompts:%s", workspaceID))
}

// SetWorkspaceReviewPrompts updates the per-workspace custom review prompt overrides
func (h *Handlers) SetWorkspaceReviewPrompts(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	h.setReviewPrompts(w, r, fmt.Sprintf("review-prompts:%s", workspaceID))
}

// getActionTemplates reads action template overrides from the given settings key.
func (h *Handlers) getActionTemplates(w http.ResponseWriter, ctx context.Context, key string) {
	value, found, err := h.store.GetSetting(ctx, key)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		writeJSON(w, map[string]any{"templates": map[string]string{}})
		return
	}

	var templates map[string]string
	if err := json.Unmarshal([]byte(value), &templates); err != nil {
		writeError(w, http.StatusInternalServerError, ErrCodeInternal, "corrupted action templates data", err)
		return
	}

	writeJSON(w, map[string]any{"templates": templates})
}

// setActionTemplates writes action template overrides to the given settings key.
func (h *Handlers) setActionTemplates(w http.ResponseWriter, r *http.Request, key string) {
	ctx := r.Context()

	var req struct {
		Templates map[string]string `json:"templates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if len(req.Templates) == 0 {
		if err := h.store.DeleteSetting(ctx, key); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		data, err := json.Marshal(req.Templates)
		if err != nil {
			writeValidationError(w, "failed to encode templates")
			return
		}
		if err := h.store.SetSetting(ctx, key, string(data)); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// GetActionTemplates returns the global custom action template overrides
func (h *Handlers) GetActionTemplates(w http.ResponseWriter, r *http.Request) {
	h.getActionTemplates(w, r.Context(), "action-templates")
}

// SetActionTemplates updates the global custom action template overrides
func (h *Handlers) SetActionTemplates(w http.ResponseWriter, r *http.Request) {
	h.setActionTemplates(w, r, "action-templates")
}

// GetWorkspaceActionTemplates returns per-workspace custom action template overrides
func (h *Handlers) GetWorkspaceActionTemplates(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	h.getActionTemplates(w, r.Context(), fmt.Sprintf("action-templates:%s", workspaceID))
}

// SetWorkspaceActionTemplates updates per-workspace custom action template overrides
func (h *Handlers) SetWorkspaceActionTemplates(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	h.setActionTemplates(w, r, fmt.Sprintf("action-templates:%s", workspaceID))
}

// GetCustomInstructions returns the global custom instructions for agent system prompts
func (h *Handlers) GetCustomInstructions(w http.ResponseWriter, r *http.Request) {
	value, found, err := h.store.GetSetting(r.Context(), "custom-instructions")
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		writeJSON(w, map[string]string{"instructions": ""})
		return
	}
	writeJSON(w, map[string]string{"instructions": value})
}

// SetCustomInstructions updates the global custom instructions for agent system prompts
func (h *Handlers) SetCustomInstructions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		Instructions string `json:"instructions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	trimmed := strings.TrimSpace(req.Instructions)
	if trimmed == "" {
		if err := h.store.DeleteSetting(ctx, "custom-instructions"); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		if err := h.store.SetSetting(ctx, "custom-instructions", trimmed); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// ============================================================================
// Settings endpoints
// ============================================================================

// GetWorkspacesBaseDir returns the configured workspaces base directory
func (h *Handlers) GetWorkspacesBaseDir(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	dir, err := h.getWorkspacesBaseDir(ctx)
	if err != nil {
		writeInternalError(w, "failed to get workspaces base dir", err)
		return
	}
	writeJSON(w, map[string]string{"path": dir})
}

// SetWorkspacesBaseDir updates the configured workspaces base directory
func (h *Handlers) SetWorkspacesBaseDir(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if req.Path == "" {
		// Empty path means reset to default — delete the setting row entirely
		if err := h.store.DeleteSetting(ctx, settingKeyWorkspacesBaseDir); err != nil {
			writeInternalError(w, "failed to delete setting", err)
			return
		}
	} else {
		// Validate that path exists and is a directory
		info, err := os.Stat(req.Path)
		if err != nil {
			writeValidationError(w, fmt.Sprintf("path does not exist: %s", req.Path))
			return
		}
		if !info.IsDir() {
			writeValidationError(w, fmt.Sprintf("path is not a directory: %s", req.Path))
			return
		}
		// Verify the directory is writable by creating and removing a temp file
		testFile, err := os.CreateTemp(req.Path, ".chatml-write-test-*")
		if err != nil {
			writeValidationError(w, fmt.Sprintf("directory is not writable: %s", req.Path))
			return
		}
		testFile.Close()
		os.Remove(testFile.Name())

		if err := h.store.SetSetting(ctx, settingKeyWorkspacesBaseDir, req.Path); err != nil {
			writeInternalError(w, "failed to save setting", err)
			return
		}
	}

	// Return the effective path after save
	dir, err := h.getWorkspacesBaseDir(ctx)
	if err != nil {
		writeInternalError(w, "failed to get workspaces base dir", err)
		return
	}
	writeJSON(w, map[string]string{"path": dir})
}

// GetEnvSettings returns the saved environment variables string
func (h *Handlers) GetEnvSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	envVars, found, err := h.store.GetSetting(ctx, settingKeyEnvVars)
	if err != nil {
		writeInternalError(w, "failed to get env settings", err)
		return
	}
	if !found {
		envVars = ""
	}
	writeJSON(w, map[string]string{"envVars": envVars})
}

// SetEnvSettings saves environment variables to the settings store
func (h *Handlers) SetEnvSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		EnvVars string `json:"envVars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyEnvVars, req.EnvVars); err != nil {
		writeInternalError(w, "failed to save env settings", err)
		return
	}

	writeJSON(w, map[string]string{"envVars": req.EnvVars})
}

// GetAnthropicApiKey returns whether an API key is configured and a masked version.
func (h *Handlers) GetAnthropicApiKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	encrypted, found, err := h.store.GetSetting(ctx, settingKeyAnthropicAPIKey)
	if err != nil {
		writeInternalError(w, "failed to get API key setting", err)
		return
	}
	if !found || encrypted == "" {
		writeJSON(w, map[string]interface{}{"configured": false, "maskedKey": ""})
		return
	}

	// Decrypt to produce a masked version
	decrypted, err := crypto.Decrypt(encrypted)
	if err != nil {
		writeInternalError(w, "failed to decrypt API key", err)
		return
	}

	masked := maskAPIKey(decrypted)
	writeJSON(w, map[string]interface{}{"configured": true, "maskedKey": masked})
}

// SetAnthropicApiKey encrypts and stores (or removes) the Anthropic API key.
func (h *Handlers) SetAnthropicApiKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Empty key = remove
	if req.APIKey == "" {
		if err := h.store.DeleteSetting(ctx, settingKeyAnthropicAPIKey); err != nil {
			writeInternalError(w, "failed to remove API key", err)
			return
		}
		writeJSON(w, map[string]interface{}{"configured": false, "maskedKey": ""})
		return
	}

	encrypted, err := crypto.Encrypt(req.APIKey)
	if err != nil {
		writeInternalError(w, "failed to encrypt API key", err)
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyAnthropicAPIKey, encrypted); err != nil {
		writeInternalError(w, "failed to save API key", err)
		return
	}

	writeJSON(w, map[string]interface{}{"configured": true, "maskedKey": maskAPIKey(req.APIKey)})
}

// maskAPIKey returns a masked version of an API key, showing a recognizable
// prefix and the last 4 characters. The prefix is determined dynamically by
// finding the boundary after the third hyphen (e.g. "sk-ant-api03-" → 13 chars)
// or falling back to the first 7 characters.
func maskAPIKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}

	// Find prefix boundary: up to the 3rd hyphen (inclusive)
	prefixEnd := 0
	hyphens := 0
	for i, ch := range key {
		if ch == '-' {
			hyphens++
			if hyphens == 3 {
				prefixEnd = i + 1 // include the hyphen
				break
			}
		}
	}
	if prefixEnd == 0 || prefixEnd >= len(key)-4 {
		prefixEnd = 7 // fallback for keys without hyphens
		if prefixEnd >= len(key)-4 {
			return "****"
		}
	}

	suffix := key[len(key)-4:]
	return key[:prefixEnd] + "..." + suffix
}

// GetClaudeAuthStatus checks all possible sources of Claude/Anthropic credentials
// and returns which ones are available. Sources checked:
//   - Settings-stored encrypted API key
//   - ANTHROPIC_API_KEY environment variable
//   - Claude Code CLI credentials (macOS Keychain or ~/.claude/.credentials.json)
//   - AWS Bedrock via Claude Code settings.json or ChatML env vars
func (h *Handlers) GetClaudeAuthStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Read external config sources once (reused across multiple checks below).
	claudeSettings, _ := ai.ReadClaudeCodeSettings()

	var chatmlEnvVars map[string]string
	if raw, found, err := h.store.GetSetting(ctx, "env-vars"); err == nil && found && raw != "" {
		chatmlEnvVars = store.ParseEnvVars(raw)
	}

	// Check 1: Settings-stored API key
	hasStoredKey := false
	encrypted, found, err := h.store.GetSetting(ctx, settingKeyAnthropicAPIKey)
	if err == nil && found && encrypted != "" {
		if _, decErr := crypto.Decrypt(encrypted); decErr == nil {
			hasStoredKey = true
		}
	}

	// Check 2: ANTHROPIC_API_KEY environment variable
	hasEnvKey := os.Getenv("ANTHROPIC_API_KEY") != ""

	// Auto-import: if no stored key, discover ANTHROPIC_API_KEY from external
	// sources and persist it into ChatML's encrypted settings store so the
	// banner resolves and the key is available for non-agent tasks (e.g. title
	// generation). This runs once — subsequent calls find the stored key above.
	if !hasStoredKey {
		discoveredKey := ""
		if k := os.Getenv("ANTHROPIC_API_KEY"); k != "" {
			discoveredKey = k
		} else if claudeSettings != nil && claudeSettings.Env["ANTHROPIC_API_KEY"] != "" {
			discoveredKey = claudeSettings.Env["ANTHROPIC_API_KEY"]
		} else if chatmlEnvVars["ANTHROPIC_API_KEY"] != "" {
			discoveredKey = chatmlEnvVars["ANTHROPIC_API_KEY"]
		}

		if discoveredKey != "" {
			if enc, encErr := crypto.Encrypt(discoveredKey); encErr != nil {
				log.Printf("WARN: auto-import ANTHROPIC_API_KEY encrypt failed: %v", encErr)
			} else if setErr := h.store.SetSetting(ctx, settingKeyAnthropicAPIKey, enc); setErr != nil {
				log.Printf("WARN: auto-import ANTHROPIC_API_KEY store failed: %v", setErr)
			} else {
				hasStoredKey = true
			}
		}
	}

	// Check 3: Claude Code CLI credentials via OS keychain (validates token contents + expiration)
	_, cliErr := ai.ReadClaudeCodeOAuthToken()
	hasCliCredentials := cliErr == nil

	// Check 4: ~/.claude/.credentials.json file fallback (only if keychain failed)
	if !hasCliCredentials {
		_, fileErr := ai.ReadClaudeCodeCredentialsFile()
		if fileErr == nil {
			hasCliCredentials = true
		}
	}

	// Check 5: AWS Bedrock via Claude Code settings.json
	hasBedrock := false
	if claudeSettings != nil && ai.IsBedRockConfigured(claudeSettings) {
		hasBedrock = true
	}

	// Check 6: AWS Bedrock via ChatML env vars (Settings → Advanced)
	if !hasBedrock {
		if chatmlEnvVars["CLAUDE_CODE_USE_BEDROCK"] == "true" {
			hasBedrock = true
		}
	}

	configured := hasStoredKey || hasEnvKey || hasCliCredentials || hasBedrock

	// Determine the primary credential source for UI display.
	// Order must match newAIClient() priority: Bedrock > stored key > env key > CLI credentials.
	credentialSource := ""
	if hasBedrock {
		credentialSource = "aws_bedrock"
	} else if hasStoredKey {
		credentialSource = "api_key"
	} else if hasEnvKey {
		credentialSource = "env_var"
	} else if hasCliCredentials {
		credentialSource = "claude_subscription"
	}

	writeJSON(w, map[string]interface{}{
		"configured":        configured,
		"hasStoredKey":      hasStoredKey,
		"hasEnvKey":         hasEnvKey,
		"hasCliCredentials": hasCliCredentials,
		"hasBedrock":        hasBedrock,
		"credentialSource":  credentialSource,
	})
}

// GetClaudeEnv reads ~/.claude/settings.json and returns the env vars defined there.
// Returns an empty map if the file does not exist.
func (h *Handlers) GetClaudeEnv(w http.ResponseWriter, r *http.Request) {
	settings, err := ai.ReadClaudeCodeSettings()
	if err != nil {
		writeInternalError(w, "failed to read Claude settings", err)
		return
	}

	env := map[string]string{}
	if settings != nil && settings.Env != nil {
		env = settings.Env
	}

	writeJSON(w, map[string]interface{}{
		"env": env,
	})
}

// settingKeyMcpServers returns the settings key for MCP servers in a workspace
func settingKeyMcpServers(workspaceID string) string {
	return "mcp-servers:" + workspaceID
}

// GetMcpServers returns the configured MCP servers for a workspace
func (h *Handlers) GetMcpServers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	raw, found, err := h.store.GetSetting(ctx, settingKeyMcpServers(repoID))
	if err != nil {
		writeInternalError(w, "failed to get MCP servers", err)
		return
	}

	if !found || raw == "" {
		writeJSON(w, []models.McpServerConfig{})
		return
	}

	var servers []models.McpServerConfig
	if err := json.Unmarshal([]byte(raw), &servers); err != nil {
		writeInternalError(w, "failed to parse MCP server config", err)
		return
	}

	writeJSON(w, servers)
}

// SetMcpServers saves the MCP server configuration for a workspace
func (h *Handlers) SetMcpServers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	var servers []models.McpServerConfig
	if err := json.NewDecoder(r.Body).Decode(&servers); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Validate each server config
	for i, s := range servers {
		if s.Name == "" {
			writeValidationError(w, fmt.Sprintf("server at index %d is missing a name", i))
			return
		}
		switch s.Type {
		case "stdio":
			if s.Command == "" {
				writeValidationError(w, fmt.Sprintf("stdio server %q is missing a command", s.Name))
				return
			}
		case "sse", "http":
			if s.URL == "" {
				writeValidationError(w, fmt.Sprintf("%s server %q is missing a URL", s.Type, s.Name))
				return
			}
		default:
			writeValidationError(w, fmt.Sprintf("server %q has invalid type %q (must be stdio, sse, or http)", s.Name, s.Type))
			return
		}
	}

	data, err := json.Marshal(servers)
	if err != nil {
		writeInternalError(w, "failed to serialize MCP server config", err)
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyMcpServers(repoID), string(data)); err != nil {
		writeInternalError(w, "failed to save MCP servers", err)
		return
	}

	writeJSON(w, servers)
}

// settingKeyEnabledAgents returns the settings key for enabled agents in a workspace.
func settingKeyEnabledAgents(workspaceID string) string {
	return "enabled-agents:" + workspaceID
}

// GetEnabledAgents returns the list of enabled agent names for a workspace.
func (h *Handlers) GetEnabledAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	raw, found, err := h.store.GetSetting(ctx, settingKeyEnabledAgents(workspaceID))
	if err != nil {
		writeInternalError(w, "failed to get enabled agents", err)
		return
	}

	if !found || raw == "" {
		writeJSON(w, agent.DefaultEnabledAgents)
		return
	}

	var agents []string
	if err := json.Unmarshal([]byte(raw), &agents); err != nil {
		writeInternalError(w, "failed to parse enabled agents", err)
		return
	}

	writeJSON(w, agents)
}

// SetEnabledAgents updates the list of enabled agent names for a workspace.
func (h *Handlers) SetEnabledAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	var agents []string
	if err := json.NewDecoder(r.Body).Decode(&agents); err != nil {
		writeValidationError(w, "invalid request body: expected JSON array of strings")
		return
	}

	data, err := json.Marshal(agents)
	if err != nil {
		writeInternalError(w, "failed to serialize enabled agents", err)
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyEnabledAgents(workspaceID), string(data)); err != nil {
		writeInternalError(w, "failed to save enabled agents", err)
		return
	}

	writeJSON(w, agents)
}

// GetAvailableAgents returns metadata about all built-in agents for the settings UI.
func (h *Handlers) GetAvailableAgents(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, agent.AvailableAgents())
}

// GetNeverLoadDotMcp returns the global "never load .mcp.json" setting.
func (h *Handlers) GetNeverLoadDotMcp(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw, _, err := h.store.GetSetting(ctx, "never-load-dot-mcp")
	if err != nil {
		writeInternalError(w, "failed to get never-load-dot-mcp setting", err)
		return
	}
	writeJSON(w, map[string]bool{"enabled": raw == "true"})
}

// SetNeverLoadDotMcp updates the global "never load .mcp.json" setting.
func (h *Handlers) SetNeverLoadDotMcp(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	value := "false"
	if body.Enabled {
		value = "true"
	}
	if err := h.store.SetSetting(ctx, "never-load-dot-mcp", value); err != nil {
		writeInternalError(w, "failed to save never-load-dot-mcp setting", err)
		return
	}
	writeJSON(w, map[string]bool{"enabled": body.Enabled})
}

// settingKeyDotMcpTrust returns the settings key for .mcp.json trust status in a workspace.
func settingKeyDotMcpTrust(workspaceID string) string {
	return "dot-mcp-trust:" + workspaceID
}

// GetDotMcpTrust returns the .mcp.json trust status for a workspace.
func (h *Handlers) GetDotMcpTrust(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	raw, found, err := h.store.GetSetting(ctx, settingKeyDotMcpTrust(repoID))
	if err != nil {
		writeInternalError(w, "failed to get dot-mcp trust status", err)
		return
	}

	status := "unknown"
	if found && (raw == "trusted" || raw == "denied") {
		status = raw
	}

	writeJSON(w, map[string]string{"status": status})
}

// SetDotMcpTrust updates the .mcp.json trust status for a workspace.
func (h *Handlers) SetDotMcpTrust(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	if body.Status != "trusted" && body.Status != "denied" {
		writeValidationError(w, "status must be \"trusted\" or \"denied\"")
		return
	}

	if err := h.store.SetSetting(ctx, settingKeyDotMcpTrust(repoID), body.Status); err != nil {
		writeInternalError(w, "failed to save dot-mcp trust status", err)
		return
	}

	writeJSON(w, map[string]string{"status": body.Status})
}

// DotMcpServerInfo describes a single server entry from a project-level MCP config file.
type DotMcpServerInfo struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Command string `json:"command,omitempty"`
	Source  string `json:"source,omitempty"` // "dot-mcp" or "claude-cli-project"
}

// GetDotMcpInfo checks whether project-level MCP config files exist in the workspace
// and returns their combined server list. Checks both .mcp.json and .claude/settings.json.
func (h *Handlers) GetDotMcpInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "id")

	repo, err := h.store.GetRepo(ctx, repoID)
	if err != nil {
		writeInternalError(w, "failed to get repo", err)
		return
	}
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	// Use a map to dedup — later sources (claude-cli-project) override earlier (dot-mcp),
	// matching the agent-runner merge priority.
	serverMap := make(map[string]DotMcpServerInfo)
	anyExists := false

	// Check .mcp.json
	dotMcpPath := repo.Path + "/.mcp.json"
	if data, err := os.ReadFile(dotMcpPath); err == nil {
		anyExists = true
		var config struct {
			McpServers map[string]struct {
				Type    string `json:"type"`
				Command string `json:"command"`
			} `json:"mcpServers"`
		}
		if err := json.Unmarshal(data, &config); err == nil {
			for name, s := range config.McpServers {
				serverType := s.Type
				if serverType == "" {
					serverType = "stdio"
				}
				serverMap[name] = DotMcpServerInfo{
					Name:    name,
					Type:    serverType,
					Command: s.Command,
					Source:  "dot-mcp",
				}
			}
		}
	}

	// Check .claude/settings.json for mcpServers
	claudeSettingsPath := repo.Path + "/.claude/settings.json"
	if data, err := os.ReadFile(claudeSettingsPath); err == nil {
		var config struct {
			McpServers map[string]struct {
				Type    string `json:"type"`
				Command string `json:"command"`
			} `json:"mcpServers"`
		}
		if err := json.Unmarshal(data, &config); err == nil && len(config.McpServers) > 0 {
			anyExists = true
			for name, s := range config.McpServers {
				serverType := s.Type
				if serverType == "" {
					serverType = "stdio"
				}
				serverMap[name] = DotMcpServerInfo{
					Name:    name,
					Type:    serverType,
					Command: s.Command,
					Source:  "claude-cli-project",
				}
			}
		}
	}

	if !anyExists {
		writeJSON(w, map[string]interface{}{"exists": false, "servers": []DotMcpServerInfo{}})
		return
	}

	servers := make([]DotMcpServerInfo, 0, len(serverMap))
	for _, s := range serverMap {
		servers = append(servers, s)
	}

	slices.SortFunc(servers, func(a, b DotMcpServerInfo) int {
		return strings.Compare(a.Name, b.Name)
	})

	writeJSON(w, map[string]interface{}{"exists": true, "servers": servers})
}
