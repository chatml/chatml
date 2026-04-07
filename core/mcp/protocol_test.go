package mcp

import (
	"encoding/json"
	"testing"
)

func TestRequestMarshal(t *testing.T) {
	req := Request{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/list",
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	if string(data) == "" {
		t.Fatal("empty output")
	}
	var decoded Request
	json.Unmarshal(data, &decoded)
	if decoded.Method != "tools/list" {
		t.Errorf("expected method 'tools/list', got %q", decoded.Method)
	}
}

func TestResponseWithError(t *testing.T) {
	data := `{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request"}}`
	var resp Response
	if err := json.Unmarshal([]byte(data), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if resp.Error == nil {
		t.Fatal("expected error")
	}
	if resp.Error.Code != -32600 {
		t.Errorf("expected code -32600, got %d", resp.Error.Code)
	}
	if resp.Error.Error() != "Invalid Request" {
		t.Errorf("expected 'Invalid Request', got %q", resp.Error.Error())
	}
}

func TestToolDefParsing(t *testing.T) {
	data := `{
		"tools": [
			{
				"name": "search",
				"description": "Search for things",
				"inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}
			}
		]
	}`
	var result ToolsListResult
	if err := json.Unmarshal([]byte(data), &result); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if len(result.Tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(result.Tools))
	}
	if result.Tools[0].Name != "search" {
		t.Errorf("expected tool name 'search', got %q", result.Tools[0].Name)
	}
}

func TestToolCallResultParsing(t *testing.T) {
	data := `{
		"content": [
			{"type": "text", "text": "Found 3 results"},
			{"type": "image", "mimeType": "image/png", "data": "base64data"}
		],
		"isError": false
	}`
	var result ToolCallResult
	if err := json.Unmarshal([]byte(data), &result); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if len(result.Content) != 2 {
		t.Fatalf("expected 2 content items, got %d", len(result.Content))
	}
	if result.Content[0].Text != "Found 3 results" {
		t.Errorf("unexpected text: %q", result.Content[0].Text)
	}
}

func TestSanitizeName(t *testing.T) {
	tests := []struct {
		input, expected string
	}{
		{"github", "github"},
		{"my-server", "my-server"}, // Hyphens preserved to avoid collisions
		{"test.tool", "test_tool"},
		{"MixedCase123", "MixedCase123"},
		{"special@chars!", "special_chars_"},
	}
	for _, tt := range tests {
		got := sanitizeName(tt.input)
		if got != tt.expected {
			t.Errorf("sanitizeName(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestLoadMCPConfigFile(t *testing.T) {
	// Test parsing format
	data := `{
		"mcpServers": {
			"github": {
				"command": "npx",
				"args": ["-y", "@modelcontextprotocol/server-github"],
				"env": {"GITHUB_TOKEN": "xxx"}
			},
			"disabled": {
				"command": "echo",
				"enabled": false
			}
		}
	}`

	var mcpFile struct {
		MCPServers map[string]json.RawMessage `json:"mcpServers"`
	}
	json.Unmarshal([]byte(data), &mcpFile)
	configs, err := parseMCPServerMap(mcpFile.MCPServers)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}

	if len(configs) != 2 {
		t.Fatalf("expected 2 configs, got %d", len(configs))
	}

	// Find github config
	var githubCfg *ServerConfig
	for i := range configs {
		if configs[i].Name == "github" {
			githubCfg = &configs[i]
			break
		}
	}
	if githubCfg == nil {
		t.Fatal("expected github config")
	}
	if githubCfg.Command != "npx" {
		t.Errorf("expected command 'npx', got %q", githubCfg.Command)
	}
	if githubCfg.Env["GITHUB_TOKEN"] != "xxx" {
		t.Errorf("expected GITHUB_TOKEN env var")
	}

	// Check disabled config
	for _, cfg := range configs {
		if cfg.Name == "disabled" && cfg.Enabled {
			t.Error("expected disabled server to have Enabled=false")
		}
	}
}
