package relay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/chatml/chatml-backend/logger"
)

// JSON-RPC 2.0 server error codes for HTTP proxy errors.
// The spec reserves -32000 to -32099 for implementation-defined server errors.
const (
	rpcErrHTTPClient = -32001 // HTTP 4xx — client error
	rpcErrHTTPServer = -32002 // HTTP 5xx — server error

	maxRequestBodySize  = 1 * 1024 * 1024  // 1MB — max request body from mobile
	maxResponseBodySize = 10 * 1024 * 1024 // 10MB — max response body from router
)

// allowedHTTPMethods is the set of HTTP methods permitted for proxied requests.
// This prevents unexpected behavior from methods like CONNECT or TRACE.
var allowedHTTPMethods = map[string]bool{
	"GET":    true,
	"POST":   true,
	"PUT":    true,
	"PATCH":  true,
	"DELETE": true,
}

// dispatchHTTPRequest takes a JSON-RPC request, constructs an internal HTTP
// request, routes it through the existing chi router, and returns the response
// as a JSON-RPC response. This is the core of the HTTP-over-WebSocket proxy.
//
// The router already handles all routing, middleware (auth, rate limiting),
// parameter extraction, and response serialization — we just construct a
// synthetic request and capture the output.
//
// SECURITY: The auth token injected below grants the mobile client the same
// access level as the Tauri desktop shell. Anyone who pairs via QR code (or
// obtains the pairing token) gets full API access. There is intentionally no
// per-request capability scoping — the pairing token IS the trust boundary.
func dispatchHTTPRequest(router http.Handler, authToken string, req *JSONRPCRequest) *JSONRPCResponse {
	if req.Params == nil || req.Params.Path == "" {
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32602, Message: "params.path is required"},
		}
	}

	// Validate HTTP method to prevent unexpected behavior (e.g., CONNECT, TRACE)
	method := strings.ToUpper(req.Method)
	if !allowedHTTPMethods[method] {
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32602, Message: "unsupported HTTP method"},
		}
	}

	// Validate and build HTTP request body
	if len(req.Params.Body) > maxRequestBodySize {
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32602, Message: "request body too large"},
		}
	}
	var body io.Reader
	if req.Params.Body != nil {
		body = bytes.NewReader(req.Params.Body)
	}

	httpReq := httptest.NewRequest(method, req.Params.Path, body)
	httpReq.Header.Set("Content-Type", "application/json")

	// Inject auth token so the request passes TokenAuthMiddleware.
	// This grants the paired mobile device full API access (see doc comment above).
	if authToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+authToken)
	}

	// Add query parameters
	if len(req.Params.Query) > 0 {
		q := httpReq.URL.Query()
		for k, v := range req.Params.Query {
			q.Set(k, v)
		}
		httpReq.URL.RawQuery = q.Encode()
	}

	// Route through the chi router
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httpReq)

	result := recorder.Result()
	respBody, err := io.ReadAll(io.LimitReader(result.Body, maxResponseBodySize+1))
	result.Body.Close()
	if err == nil && len(respBody) > maxResponseBodySize {
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32603, Message: "response too large for relay"},
		}
	}
	if err != nil {
		logger.Relay.Errorf("Failed to read proxy response body: %v", err)
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32603, Message: "internal error reading response"},
		}
	}

	// Map HTTP errors to JSON-RPC errors using spec-compliant codes.
	// The HTTP status is included in the message for debugging.
	if result.StatusCode >= 400 {
		code := rpcErrHTTPClient
		if result.StatusCode >= 500 {
			code = rpcErrHTTPServer
		}
		return &JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error: &JSONRPCError{
				Code:    code,
				Message: fmt.Sprintf("HTTP %d: %s", result.StatusCode, string(respBody)),
			},
		}
	}

	// Ensure the response body is valid JSON for the result field.
	// If the handler returned non-JSON (e.g., plain text "OK"), wrap it.
	if len(respBody) == 0 {
		respBody = []byte("null")
	} else if !json.Valid(respBody) {
		// Wrap non-JSON response as a JSON string
		wrapped, _ := json.Marshal(string(respBody))
		respBody = wrapped
	}

	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result:  json.RawMessage(respBody),
	}
}
