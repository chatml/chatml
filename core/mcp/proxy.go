package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chatml/chatml-core/tool"
)

// ProxyTool wraps an MCP server tool as a native tool.Tool, allowing it to be
// registered in the tool registry and called by the agentic loop.
type ProxyTool struct {
	serverName string
	toolDef    ToolDef
	client     *Client
	prefix     string // e.g., "mcp__github__" for namespacing
}

// NewProxyTool creates a tool proxy for an MCP tool.
func NewProxyTool(serverName string, def ToolDef, client *Client) *ProxyTool {
	return &ProxyTool{
		serverName: serverName,
		toolDef:    def,
		client:     client,
		prefix:     "mcp__" + sanitizeName(serverName) + "__",
	}
}

func (t *ProxyTool) Name() string {
	return t.prefix + sanitizeName(t.toolDef.Name)
}

func (t *ProxyTool) Description() string {
	desc := t.toolDef.Description
	if desc == "" {
		desc = fmt.Sprintf("MCP tool from %s server", t.serverName)
	}
	return desc
}

func (t *ProxyTool) InputSchema() json.RawMessage {
	if t.toolDef.InputSchema != nil {
		return t.toolDef.InputSchema
	}
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *ProxyTool) IsConcurrentSafe() bool { return true }

func (t *ProxyTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	// Parse input as map for MCP call
	var args map[string]interface{}
	if len(input) > 0 {
		if err := json.Unmarshal(input, &args); err != nil {
			return tool.ErrorResult(fmt.Sprintf("invalid input JSON: %v", err)), nil
		}
	}

	result, err := t.client.CallTool(ctx, t.toolDef.Name, args)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("MCP tool %q error: %v", t.toolDef.Name, err)), nil
	}

	// Convert MCP content items to text result
	var sb strings.Builder
	for _, item := range result.Content {
		switch item.Type {
		case "text":
			sb.WriteString(item.Text)
		case "image":
			sb.WriteString(fmt.Sprintf("[Image: %s]", item.MimeType))
		case "resource":
			sb.WriteString(fmt.Sprintf("[Resource: %s]", item.MimeType))
		default:
			if item.Text != "" {
				sb.WriteString(item.Text)
			}
		}
	}

	content := sb.String()

	// Truncate large results
	const maxResultSize = 512 * 1024 // 512KB
	if len(content) > maxResultSize {
		content = content[:maxResultSize] + "\n... (MCP result truncated)"
	}

	return &tool.Result{
		Content: content,
		IsError: result.IsError,
	}, nil
}

// ServerName returns the originating MCP server name.
func (t *ProxyTool) ServerName() string { return t.serverName }

// OriginalName returns the original tool name on the MCP server (without prefix).
func (t *ProxyTool) OriginalName() string { return t.toolDef.Name }

// DeferLoading marks MCP tools as deferred (discovered via ToolSearch).
func (t *ProxyTool) DeferLoading() bool { return true }

// sanitizeName replaces characters not valid in tool names.
// Hyphens are preserved (converted to underscore would cause collisions between
// e.g., "my-server" and "my.server"). Instead, hyphens are kept as-is since
// they are valid in most tool name contexts and preserve uniqueness.
func sanitizeName(name string) string {
	var sb strings.Builder
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			sb.WriteRune(c)
		} else {
			sb.WriteRune('_')
		}
	}
	return sb.String()
}
