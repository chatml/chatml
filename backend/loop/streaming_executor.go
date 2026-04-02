package loop

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/chatml/chatml-backend/provider"
	"github.com/chatml/chatml-backend/tool"
)

// StreamingToolExecutor starts executing tool calls as they arrive during
// streaming, rather than waiting for the entire response to complete.
// Concurrent-safe tools start immediately; serial tools are queued.
//
// Sibling abort: if a Bash tool returns an error, pending sibling tools
// are cancelled via the shared siblingCtx. This matches Claude Code's
// behavior where Bash errors abort sibling tools (implicit dependency chains).
type StreamingToolExecutor struct {
	registry *tool.Registry
	executor *tool.Executor

	mu        sync.Mutex
	pending   []provider.ToolUseBlock      // Tools waiting for execution
	results   map[string]tool.ToolCallResult // Completed results by tool ID
	running   map[string]struct{}           // Currently executing tool IDs
	wg        sync.WaitGroup

	// Sibling abort: cancel pending tools when a Bash error occurs
	siblingCtx    context.Context
	siblingCancel context.CancelFunc
	aborted       bool
	abortReason   string
}

// NewStreamingToolExecutor creates a streaming executor.
func NewStreamingToolExecutor(registry *tool.Registry, executor *tool.Executor) *StreamingToolExecutor {
	ctx, cancel := context.WithCancel(context.Background())
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
// Serial tools are queued and executed after all concurrent tools complete.
func (se *StreamingToolExecutor) AddTool(ctx context.Context, block provider.ToolUseBlock) {
	t := se.registry.Get(block.Name)

	if t != nil && t.IsConcurrentSafe() {
		// Start concurrent-safe tools immediately
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
		// Queue serial tools for later
		se.mu.Lock()
		se.pending = append(se.pending, block)
		se.mu.Unlock()
	}
}

// Collect waits for all concurrent tools to finish, then executes serial tools,
// and returns all results in the order matching the provided tool call list.
func (se *StreamingToolExecutor) Collect(ctx context.Context, allToolCalls []provider.ToolUseBlock) []tool.ToolCallResult {
	// Wait for all concurrent tools to finish
	se.wg.Wait()

	// Execute serial tools sequentially
	se.mu.Lock()
	pending := se.pending
	se.pending = nil
	se.mu.Unlock()

	for _, block := range pending {
		// Check if siblings were aborted
		se.mu.Lock()
		aborted := se.aborted
		reason := se.abortReason
		se.mu.Unlock()

		if aborted {
			tc := tool.ToolCall{ID: block.ID, Name: block.Name, Input: json.RawMessage(block.Input)}
			se.mu.Lock()
			se.results[block.ID] = tool.ToolCallResult{
				ToolCall: tc,
				Result:   tool.ErrorResult("Aborted: " + reason),
			}
			se.mu.Unlock()
			continue
		}

		result := se.executeOne(ctx, block)

		// If a Bash tool (serial) returned an error, abort remaining siblings
		if block.Name == "Bash" && result.Result != nil && result.Result.IsError {
			se.mu.Lock()
			if !se.aborted {
				se.aborted = true
				se.abortReason = "Bash command failed — aborting remaining tools"
				se.siblingCancel()
			}
			se.mu.Unlock()
		}

		se.mu.Lock()
		se.results[block.ID] = result
		se.mu.Unlock()
	}

	// Build results in original order
	results := make([]tool.ToolCallResult, len(allToolCalls))
	se.mu.Lock()
	for i, tc := range allToolCalls {
		if r, ok := se.results[tc.ID]; ok {
			results[i] = r
		} else {
			results[i] = tool.ToolCallResult{
				ToolCall: tool.ToolCall{ID: tc.ID, Name: tc.Name, Input: tc.Input},
				Result:   tool.ErrorResult("Tool execution result not found"),
			}
		}
	}
	se.mu.Unlock()

	return results
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
