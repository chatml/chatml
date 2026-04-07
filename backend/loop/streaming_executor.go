package loop

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/chatml/chatml-core/provider"
	"github.com/chatml/chatml-core/tool"
)

// StreamingToolExecutor starts executing tool calls as they arrive during
// streaming, rather than waiting for the entire response to complete.
// Concurrent-safe tools start immediately; serial tools are queued.
//
// Sibling abort: if a Bash tool returns an error, pending sibling tools
// are cancelled via the shared siblingCtx. This matches Claude Code's
// behavior where Bash errors abort sibling tools (implicit dependency chains).
//
// IMPORTANT: Only concurrent-safe (read-only) tools are auto-executed during
// streaming. Serial tools (Bash, Write, Edit, etc.) are queued and returned
// to the caller for permission checks before execution.
type StreamingToolExecutor struct {
	registry *tool.Registry
	executor *tool.Executor

	mu        sync.Mutex
	pending   []provider.ToolUseBlock        // Serial tools waiting for permission + execution
	results   map[string]tool.ToolCallResult  // Completed concurrent results by tool ID
	running   map[string]struct{}             // Currently executing tool IDs
	wg        sync.WaitGroup

	// Sibling abort: cancel pending tools when a Bash error occurs
	siblingCtx    context.Context
	siblingCancel context.CancelFunc
}

// NewStreamingToolExecutor creates a streaming executor.
// parentCtx is used as the parent for the sibling-abort context so that
// runner cancellation also cancels in-flight concurrent tools.
func NewStreamingToolExecutor(parentCtx context.Context, registry *tool.Registry, executor *tool.Executor) *StreamingToolExecutor {
	ctx, cancel := context.WithCancel(parentCtx)
	return &StreamingToolExecutor{
		registry:      registry,
		executor:      executor,
		results:       make(map[string]tool.ToolCallResult),
		running:       make(map[string]struct{}),
		siblingCtx:    ctx,
		siblingCancel: cancel,
	}
}

// AddTool queues a completed tool_use block for execution.
// If the tool is concurrent-safe, execution starts immediately in a goroutine.
// Serial tools are queued and returned by Collect for permission checks.
func (se *StreamingToolExecutor) AddTool(ctx context.Context, block provider.ToolUseBlock) {
	t := se.registry.Get(block.Name)

	if t != nil && t.IsConcurrentSafe() {
		// Start concurrent-safe tools immediately — these are read-only
		// and always allowed by the permission engine.
		se.mu.Lock()
		se.running[block.ID] = struct{}{}
		se.mu.Unlock()

		se.wg.Add(1)
		go func() {
			defer se.wg.Done()
			// Use sibling context so tools can be cancelled on Bash errors.
			// Also propagate parent ctx cancellation via AfterFunc (avoids a
			// separate goroutine per tool).
			execCtx, cancel := context.WithCancel(se.siblingCtx)
			defer cancel()
			stop := context.AfterFunc(ctx, cancel)
			defer stop()

			result := se.executeOne(execCtx, block)
			se.mu.Lock()
			se.results[block.ID] = result
			delete(se.running, block.ID)
			se.mu.Unlock()
		}()
	} else {
		// Queue serial tools for later — they need permission checks
		se.mu.Lock()
		se.pending = append(se.pending, block)
		se.mu.Unlock()
	}
}

// Collect waits for all concurrent tools to finish and returns:
// - concurrentResults: results for concurrent-safe tools (keyed by tool ID)
// - pendingSerial: serial tool blocks that still need permission checks + execution
//
// Serial tools are NOT executed here — the caller must run them through the
// permission engine before execution.
func (se *StreamingToolExecutor) Collect(ctx context.Context) (concurrentResults map[string]tool.ToolCallResult, pendingSerial []provider.ToolUseBlock) {
	// Wait for all concurrent tools to finish
	se.wg.Wait()

	se.mu.Lock()
	defer se.mu.Unlock()

	// Return concurrent results and pending serial tools
	return se.results, se.pending
}

// CompletedCount returns how many tools have finished executing.
func (se *StreamingToolExecutor) CompletedCount() int {
	se.mu.Lock()
	defer se.mu.Unlock()
	return len(se.results)
}

func (se *StreamingToolExecutor) executeOne(ctx context.Context, block provider.ToolUseBlock) tool.ToolCallResult {
	tc := tool.ToolCall{ID: block.ID, Name: block.Name, Input: json.RawMessage(block.Input)}

	t := se.registry.Get(block.Name)
	if t == nil {
		return tool.ToolCallResult{
			ToolCall: tc,
			Result:   tool.ErrorResult("Unknown tool: " + block.Name),
		}
	}

	result, err := t.Execute(ctx, tc.Input)
	if err != nil {
		return tool.ToolCallResult{
			ToolCall: tc,
			Result:   tool.ErrorResult("Tool execution error: " + err.Error()),
			Error:    err,
		}
	}

	return tool.ToolCallResult{
		ToolCall: tc,
		Result:   result,
	}
}
