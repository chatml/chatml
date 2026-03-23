// Package relay implements the WebSocket relay client for mobile remote control.
// It connects to a cloud relay server, registers as a Hub client to receive
// broadcast events, and proxies JSON-RPC requests through the existing HTTP
// router via httptest.
package relay

import "encoding/json"

// JSONRPCRequest is the envelope for HTTP-over-WebSocket requests from mobile.
// The Method field contains the HTTP method (GET, POST, PATCH, DELETE) and
// Params.Path mirrors the existing REST API routes.
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"` // int or string per JSON-RPC 2.0
	Method  string          `json:"method"`
	Params  *RequestParams  `json:"params,omitempty"`
}

// RequestParams describes the HTTP request to proxy.
type RequestParams struct {
	Path  string            `json:"path"`
	Body  json.RawMessage   `json:"body,omitempty"`
	Query map[string]string `json:"query,omitempty"`
}

// JSONRPCResponse wraps the HTTP response back to mobile.
type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

// JSONRPCError represents a JSON-RPC error object.
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// JSONRPCNotification wraps Hub events forwarded to mobile (no ID field).
type JSONRPCNotification struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"` // always "event"
	Params  json.RawMessage `json:"params"` // serialized server.Event
}
