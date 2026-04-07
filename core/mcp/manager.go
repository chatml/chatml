package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/chatml/chatml-core/tool"
)

// Manager manages multiple MCP server connections and registers their tools.
type Manager struct {
	mu      sync.RWMutex
	clients map[string]*Client // serverName -> client
}

// NewManager creates an empty MCP manager.
func NewManager() *Manager {
	return &Manager{
		clients: make(map[string]*Client),
	}
}

// reservedServerNames are MCP server names that cannot be used by user-configured
// servers. The permission engine auto-allows tools from "chatml" (mcp__chatml__*),
// so allowing a user-configured server to use this name would bypass all permission
// checks. See permission.Engine.Check step 6.
var reservedServerNames = map[string]bool{
	"chatml": true,
}

// IsReservedServerName returns true if the given name (after sanitization) would
// collide with a reserved/first-party MCP server prefix.
func IsReservedServerName(name string) bool {
	return reservedServerNames[sanitizeName(name)]
}

// ConnectServer connects to a single MCP server and lists its tools.
func (m *Manager) ConnectServer(ctx context.Context, cfg ServerConfig) (*Client, error) {
	if cfg.Type != "" && cfg.Type != "stdio" {
		return nil, fmt.Errorf("unsupported MCP transport type: %q (only stdio is currently supported)", cfg.Type)
	}

	// Block reserved server names to prevent permission bypass via tool name spoofing.
	if IsReservedServerName(cfg.Name) {
		return nil, fmt.Errorf("MCP server name %q is reserved for first-party tools and cannot be used", cfg.Name)
	}

	client := NewClient(cfg.Name)
	if err := client.ConnectStdio(ctx, cfg.Command, cfg.Args, cfg.Env); err != nil {
		return nil, fmt.Errorf("connect to MCP server %q: %w", cfg.Name, err)
	}

	// List tools
	if _, err := client.ListTools(ctx); err != nil {
		client.Close()
		return nil, fmt.Errorf("list tools from %q: %w", cfg.Name, err)
	}

	m.mu.Lock()
	m.clients[cfg.Name] = client
	m.mu.Unlock()

	return client, nil
}

// RegisterTools registers all MCP tools from all connected servers into the tool registry.
// Tools are namespaced as "mcp__{server}__{tool}" to avoid collisions with built-in tools.
// Existing tools in the registry are not overwritten (built-in tools take priority).
func (m *Manager) RegisterTools(registry *tool.Registry) int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for serverName, client := range m.clients {
		for _, td := range client.Tools() {
			proxy := NewProxyTool(serverName, td, client)

			// NOTE: Get+Register has a TOCTOU race if called concurrently.
			// The recover() below handles the resulting panic gracefully.
			// Skip if a tool with this name already exists (built-in priority)
			if registry.Get(proxy.Name()) != nil {
				continue
			}

			// Register (using TryRegister to avoid panic on collision)
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("warning: MCP tool registration collision: %v", r)
					}
				}()
				registry.Register(proxy)
				count++
			}()
		}
	}

	return count
}

// GetClient returns a connected client by server name.
func (m *Manager) GetClient(name string) *Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[name]
}

// ConnectedServers returns the names of all connected servers.
func (m *Manager) ConnectedServers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	names := make([]string, 0, len(m.clients))
	for name := range m.clients {
		names = append(names, name)
	}
	return names
}

// Close disconnects all MCP servers.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, client := range m.clients {
		if err := client.Close(); err != nil {
			log.Printf("warning: error closing MCP server %q: %v", name, err)
		}
	}
	m.clients = make(map[string]*Client)
}

// --- Config Loading ---

// LoadMCPConfig loads MCP server configurations from .mcp.json in the workdir.
func LoadMCPConfig(workdir string) ([]ServerConfig, error) {
	path := filepath.Join(workdir, ".mcp.json")
	return loadMCPConfigFile(path)
}

// LoadMCPConfigFromSettings loads MCP server configs from the "mcpServers" key in a settings file.
func LoadMCPConfigFromSettings(settingsPath string) ([]ServerConfig, error) {
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var settings struct {
		MCPServers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, nil
	}

	return parseMCPServerMap(settings.MCPServers)
}

func loadMCPConfigFile(path string) ([]ServerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	// .mcp.json format: { "mcpServers": { "name": { "command": "...", "args": [...] } } }
	var mcpFile struct {
		MCPServers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &mcpFile); err != nil {
		return nil, fmt.Errorf("parse .mcp.json: %w", err)
	}

	return parseMCPServerMap(mcpFile.MCPServers)
}

func parseMCPServerMap(servers map[string]json.RawMessage) ([]ServerConfig, error) {
	var configs []ServerConfig
	for name, raw := range servers {
		var cfg struct {
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			URL     string            `json:"url"`
			Type    string            `json:"type"`
			Env     map[string]string `json:"env"`
			Enabled *bool             `json:"enabled"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			log.Printf("warning: invalid MCP server config for %q: %v", name, err)
			continue
		}

		enabled := true
		if cfg.Enabled != nil {
			enabled = *cfg.Enabled
		}

		serverType := cfg.Type
		if serverType == "" {
			if cfg.Command != "" {
				serverType = "stdio"
			} else if cfg.URL != "" {
				serverType = "sse"
			}
		}

		// Block reserved server names at config-parse time (defense-in-depth).
		if IsReservedServerName(name) {
			log.Printf("warning: ignoring MCP server %q — name is reserved for first-party tools", name)
			continue
		}

		configs = append(configs, ServerConfig{
			Name:    name,
			Type:    serverType,
			Command: cfg.Command,
			Args:    cfg.Args,
			URL:     cfg.URL,
			Env:     cfg.Env,
			Enabled: enabled,
		})
	}
	return configs, nil
}
