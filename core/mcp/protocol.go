// Package mcp implements the Model Context Protocol client for the native Go loop.
// MCP allows Claude to interact with external tool servers via a standard JSON-RPC 2.0 protocol.
// This implementation supports stdio transport (covering ~90% of MCP servers).
package mcp

import "encoding/json"

// JSON-RPC 2.0 message types

// Request is a JSON-RPC 2.0 request.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Response is a JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError is a JSON-RPC 2.0 error.
type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *RPCError) Error() string { return e.Message }

// Notification is a JSON-RPC 2.0 notification (no ID).
type Notification struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// --- MCP Protocol Types ---

// ServerInfo is returned by the initialize response.
type ServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// InitializeResult is the response to initialize.
type InitializeResult struct {
	ProtocolVersion string          `json:"protocolVersion"`
	ServerInfo      ServerInfo      `json:"serverInfo"`
	Capabilities    json.RawMessage `json:"capabilities,omitempty"`
}

// ToolDef is a tool definition from tools/list.
type ToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// ToolsListResult is the response to tools/list.
type ToolsListResult struct {
	Tools []ToolDef `json:"tools"`
}

// ToolCallParams is the parameters for tools/call.
type ToolCallParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments,omitempty"`
}

// ContentItem is a content block in a tool result.
type ContentItem struct {
	Type     string `json:"type"` // "text", "image", "resource"
	Text     string `json:"text,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Data     string `json:"data,omitempty"` // base64 for images
}

// ToolCallResult is the response to tools/call.
type ToolCallResult struct {
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

// ResourceDef is a resource definition from resources/list.
type ResourceDef struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// ResourcesListResult is the response to resources/list.
type ResourcesListResult struct {
	Resources []ResourceDef `json:"resources"`
}

// ResourceContent is a content block in a resource read result.
type ResourceContent struct {
	URI      string `json:"uri"`
	MimeType string `json:"mimeType,omitempty"`
	Text     string `json:"text,omitempty"`
	Blob     string `json:"blob,omitempty"` // base64
}

// ResourceReadResult is the response to resources/read.
type ResourceReadResult struct {
	Contents []ResourceContent `json:"contents"`
}
