package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Client manages a connection to a single MCP server.
type Client struct {
	mu sync.Mutex

	name      string // Server name (e.g., "github", "postgres")
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	stderr    io.ReadCloser
	scanner   *bufio.Scanner
	nextID    atomic.Int64
	pending   sync.Map // id -> chan *Response
	tools     []ToolDef
	resources []ResourceDef
	info      *InitializeResult

	connected bool
	done      chan struct{}
}

// ServerConfig defines how to connect to an MCP server.
type ServerConfig struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"`    // "stdio" (default), "sse", "http"
	Command string            `json:"command"` // For stdio: command to run
	Args    []string          `json:"args"`    // For stdio: command arguments
	URL     string            `json:"url"`     // For sse/http
	Env     map[string]string `json:"env"`     // Extra environment variables
	Enabled bool              `json:"enabled"` // Default true
}

// NewClient creates a new MCP client for the given server config.
func NewClient(name string) *Client {
	return &Client{
		name: name,
		done: make(chan struct{}),
	}
}

// ConnectStdio starts the MCP server as a subprocess and connects via stdin/stdout.
func (c *Client) ConnectStdio(ctx context.Context, command string, args []string, env map[string]string) error {
	c.mu.Lock()

	if c.connected {
		c.mu.Unlock()
		return fmt.Errorf("already connected")
	}

	cmd := exec.CommandContext(ctx, command, args...)

	// Build environment
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	// Create pipes with cleanup on partial failure. Each pipe must be closed
	// if a later step fails, to avoid leaking OS file descriptors.
	var err error
	c.stdin, err = cmd.StdinPipe()
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("stdin pipe: %w", err)
	}

	c.stdout, err = cmd.StdoutPipe()
	if err != nil {
		c.stdin.Close()
		c.mu.Unlock()
		return fmt.Errorf("stdout pipe: %w", err)
	}

	c.stderr, err = cmd.StderrPipe()
	if err != nil {
		c.stdin.Close()
		c.stdout.Close()
		c.mu.Unlock()
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		c.stdin.Close()
		c.stdout.Close()
		c.stderr.Close()
		c.mu.Unlock()
		return fmt.Errorf("start MCP server %q: %w", c.name, err)
	}

	c.cmd = cmd
	c.scanner = bufio.NewScanner(c.stdout)
	c.scanner.Buffer(make([]byte, 0, 1<<20), 10<<20) // 10MB max line
	c.connected = true

	// Read stderr in background (for logging).
	// NOTE: This goroutine exits when the pipe is closed (after process death).
	// There is no explicit shutdown signal via c.done — process kill in Close() closes the pipes.
	go func() {
		s := bufio.NewScanner(c.stderr)
		for s.Scan() {
			log.Printf("[mcp:%s:stderr] %s", c.name, s.Text())
		}
	}()

	// Read stdout responses in background
	go c.readLoop()

	// Release lock BEFORE initialize, since initialize() calls call() which also takes c.mu.
	c.mu.Unlock()

	// Initialize the connection
	return c.initialize(ctx)
}

// initialize performs the MCP initialize handshake.
func (c *Client) initialize(ctx context.Context) error {
	params, _ := json.Marshal(map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]interface{}{},
		"clientInfo": map[string]string{
			"name":    "chatml",
			"version": "1.0.0",
		},
	})

	resp, err := c.call(ctx, "initialize", params)
	if err != nil {
		return fmt.Errorf("initialize: %w", err)
	}

	var result InitializeResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return fmt.Errorf("parse initialize result: %w", err)
	}
	c.info = &result

	// Send initialized notification
	c.notify("notifications/initialized", nil)

	return nil
}

// ListTools fetches the available tools from the server.
func (c *Client) ListTools(ctx context.Context) ([]ToolDef, error) {
	resp, err := c.call(ctx, "tools/list", nil)
	if err != nil {
		return nil, fmt.Errorf("tools/list: %w", err)
	}

	var result ToolsListResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse tools/list: %w", err)
	}

	c.mu.Lock()
	c.tools = result.Tools
	c.mu.Unlock()

	return result.Tools, nil
}

// CallTool invokes a tool on the MCP server.
func (c *Client) CallTool(ctx context.Context, name string, arguments map[string]interface{}) (*ToolCallResult, error) {
	params, err := json.Marshal(ToolCallParams{
		Name:      name,
		Arguments: arguments,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal tool call params: %w", err)
	}

	resp, err := c.call(ctx, "tools/call", params)
	if err != nil {
		return nil, fmt.Errorf("tools/call %q: %w", name, err)
	}

	var result ToolCallResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse tools/call result: %w", err)
	}

	return &result, nil
}

// ListResources fetches available resources from the server.
func (c *Client) ListResources(ctx context.Context) ([]ResourceDef, error) {
	resp, err := c.call(ctx, "resources/list", nil)
	if err != nil {
		return nil, fmt.Errorf("resources/list: %w", err)
	}

	var result ResourcesListResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse resources/list: %w", err)
	}

	c.mu.Lock()
	c.resources = result.Resources
	c.mu.Unlock()

	return result.Resources, nil
}

// ReadResource reads a specific resource by URI.
func (c *Client) ReadResource(ctx context.Context, uri string) (*ResourceReadResult, error) {
	params, _ := json.Marshal(map[string]string{"uri": uri})

	resp, err := c.call(ctx, "resources/read", params)
	if err != nil {
		return nil, fmt.Errorf("resources/read: %w", err)
	}

	var result ResourceReadResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse resources/read: %w", err)
	}

	return &result, nil
}

// Name returns the server name.
func (c *Client) Name() string { return c.name }

// ServerInfo returns the server info from initialization.
func (c *Client) ServerInfo() *InitializeResult { return c.info }

// Tools returns the cached tool list (from last ListTools call).
func (c *Client) Tools() []ToolDef {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tools
}

// Close terminates the MCP server connection.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected {
		return nil
	}
	c.connected = false

	// Try graceful shutdown via stdin close
	if c.stdin != nil {
		c.stdin.Close()
	}

	// Wait briefly for process to exit
	done := make(chan error, 1)
	go func() { done <- c.cmd.Wait() }()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		c.cmd.Process.Kill() //nolint:errcheck
		<-done
	}

	// Defensive close — prevent panic if Close is somehow called twice
	select {
	case <-c.done:
		// Already closed
	default:
		close(c.done)
	}
	return nil
}

// --- Internal ---

// call sends a JSON-RPC request and waits for the response.
func (c *Client) call(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	id := int(c.nextID.Add(1))

	req := Request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	ch := make(chan *Response, 1)
	c.pending.Store(id, ch)
	defer c.pending.Delete(id)

	data, _ := json.Marshal(req)
	data = append(data, '\n')

	c.mu.Lock()
	if !c.connected {
		c.mu.Unlock()
		return nil, fmt.Errorf("not connected")
	}
	_, err := c.stdin.Write(data)
	c.mu.Unlock()

	if err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case resp := <-ch:
		if resp == nil {
			// Channel was closed by readLoop — subprocess died
			return nil, fmt.Errorf("MCP server %q: connection lost", c.name)
		}
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp.Result, nil
	case <-c.done:
		return nil, fmt.Errorf("connection closed")
	}
}

// notify sends a JSON-RPC notification (no response expected).
func (c *Client) notify(method string, params json.RawMessage) {
	notif := Notification{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	}
	data, _ := json.Marshal(notif)
	data = append(data, '\n')

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.connected {
		c.stdin.Write(data) //nolint:errcheck
	}
}

// readLoop reads JSON-RPC responses from stdout and dispatches them.
// When the scanner ends (subprocess crash, pipe close), all pending callers
// are unblocked by closing their response channels.
func (c *Client) readLoop() {
	defer func() {
		// Signal all pending callers that the connection is dead.
		// Closing the channel causes the select in call() to receive
		// the zero value, which is handled as an error.
		c.pending.Range(func(key, val any) bool {
			ch := val.(chan *Response)
			c.pending.Delete(key)
			close(ch)
			return true
		})
		// Close c.done to unblock any call() that stored its channel
		// AFTER the Range completed (sync.Map.Range doesn't visit entries
		// added mid-iteration). Those callers select on c.done as a fallback.
		select {
		case <-c.done:
			// Already closed (e.g., Close() was called concurrently)
		default:
			close(c.done)
		}
	}()

	for c.scanner.Scan() {
		line := c.scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Try to parse as response (has "id" field)
		var resp Response
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}

		// If it has an ID, it's a response to a pending request.
		// NOTE: Our IDs start at 1 (via atomic.AddInt64), so ID=0 means either
		// a notification (no ID) or a server response with a string/null ID
		// that unmarshaled to the int zero value. Full JSON-RPC spec compliance
		// would require using json.RawMessage for the ID field.
		if resp.ID > 0 {
			if val, ok := c.pending.Load(resp.ID); ok {
				ch := val.(chan *Response)
				ch <- &resp
			}
			continue
		}

		// Otherwise it might be a notification from the server
		// (log notifications, progress updates, etc.)
		var notif Notification
		if json.Unmarshal([]byte(line), &notif) == nil && notif.Method != "" {
			log.Printf("[mcp:%s:notification] %s", c.name, notif.Method)
		}
	}
}
