// Package tool defines the tool system for the native Go agentic loop.
// Tools are executable capabilities that the LLM can invoke during conversations.
// Each tool has an input schema (JSON Schema), an execution function, and
// concurrency metadata used by the executor for parallel/serial scheduling.
package tool

import (
	"context"
	"encoding/json"

	"github.com/chatml/chatml-core/provider"
)

// Tool defines a single executable tool that the LLM can invoke.
type Tool interface {
	// Name returns the tool's unique identifier (e.g., "Bash", "Read", "Write").
	Name() string

	// Description returns the tool description shown to the LLM in the system prompt.
	Description() string

	// InputSchema returns the JSON Schema for the tool's input parameters.
	InputSchema() json.RawMessage

	// Execute runs the tool with the given validated input and returns a result.
	// The context carries cancellation and the workdir.
	Execute(ctx context.Context, input json.RawMessage) (*Result, error)

	// IsConcurrentSafe returns true if this tool can run in parallel with other
	// concurrent-safe tools. Read-only tools (Read, Glob, Grep) return true.
	// Write tools (Write, Edit, Bash) return false.
	IsConcurrentSafe() bool
}

// Result is the output of a tool execution.
type Result struct {
	// Content is the text output returned to the LLM as a tool_result.
	Content string

	// IsError indicates the tool execution failed. The LLM sees the content
	// as an error message and can decide how to proceed.
	IsError bool

	// ImageData holds base64-encoded image data for image tool results.
	// When set, the runner converts this into an image content block in the
	// tool_result message so the LLM can see the image visually.
	ImageData *ImageResultData

	// Metadata contains optional structured data for the frontend (e.g., file
	// paths modified, lines changed). Not sent to the LLM.
	Metadata map[string]interface{}
}

// ImageResultData holds the data needed to construct an image content block.
type ImageResultData struct {
	MediaType string // e.g., "image/png", "image/jpeg"
	Base64    string // Base64-encoded image data
}

// ToolDef converts a Tool to a provider.ToolDef for inclusion in API requests.
func ToolDef(t Tool) provider.ToolDef {
	return provider.ToolDef{
		Name:        t.Name(),
		Description: t.Description(),
		InputSchema: t.InputSchema(),
	}
}

// PromptProvider is an optional interface that tools can implement to inject
// additional instructions into the system prompt. The prompt builder calls
// Prompt() on each registered tool and appends non-empty results.
type PromptProvider interface {
	Prompt() string
}

// Cleanable is an optional interface for tools that hold resources requiring
// explicit cleanup on session teardown (e.g., background processes, temp files).
// The runner calls Cleanup() on all tools implementing this interface when stopping.
type Cleanable interface {
	Cleanup()
}

// Deferrable is an optional interface for tools that should be deferred —
// not sent upfront in the tools array but discoverable via ToolSearch.
// This reduces context window usage when many tools are registered.
type Deferrable interface {
	// DeferLoading returns true if this tool should be deferred.
	DeferLoading() bool
}

// ErrorResult creates a Result with IsError=true.
func ErrorResult(msg string) *Result {
	return &Result{Content: msg, IsError: true}
}

// TextResult creates a successful text Result.
func TextResult(content string) *Result {
	return &Result{Content: content}
}
