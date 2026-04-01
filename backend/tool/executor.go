package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/chatml/chatml-backend/provider"
)

// ToolCall represents a pending tool invocation from the LLM.
type ToolCall struct {
	ID    string          // Unique ID from the tool_use block
	Name  string          // Tool name
	Input json.RawMessage // Raw JSON input
}

// ToolCallResult is the outcome of executing a single tool call.
type ToolCallResult struct {
	ToolCall ToolCall // Original call
	Result   *Result  // Execution result (nil if tool not found)
	Error    error    // System error (distinct from tool returning IsError)
}

// Executor manages tool execution with concurrent/serial partitioning.
// Read-only tools (IsConcurrentSafe=true) run in parallel.
// Write tools run sequentially after all concurrent tools complete.
type Executor struct {
	registry      *Registry
	maxConcurrent int
}

// NewExecutor creates a tool executor.
func NewExecutor(registry *Registry, maxConcurrent int) *Executor {
	if maxConcurrent <= 0 {
		maxConcurrent = 8
	}
	return &Executor{
		registry:      registry,
		maxConcurrent: maxConcurrent,
	}
}

// Execute runs a batch of tool calls with appropriate concurrency.
// Concurrent-safe tools run in parallel (up to maxConcurrent).
// Non-concurrent-safe tools run sequentially after all concurrent tools finish.
// Returns results in the same order as input calls.
func (e *Executor) Execute(ctx context.Context, calls []ToolCall) []ToolCallResult {
	if len(calls) == 0 {
		return nil
	}

	// Partition into concurrent and serial batches
	type indexedCall struct {
		index int
		call  ToolCall
	}
	var concurrent, serial []indexedCall

	for i, call := range calls {
		t := e.registry.Get(call.Name)
		if t != nil && t.IsConcurrentSafe() {
			concurrent = append(concurrent, indexedCall{i, call})
		} else {
			serial = append(serial, indexedCall{i, call})
		}
	}

	results := make([]ToolCallResult, len(calls))

	// Run concurrent tools in parallel
	if len(concurrent) > 0 {
		var wg sync.WaitGroup
		sem := make(chan struct{}, e.maxConcurrent)

		for _, ic := range concurrent {
			wg.Add(1)
			go func(idx int, call ToolCall) {
				defer wg.Done()
				sem <- struct{}{}        // Acquire semaphore
				defer func() { <-sem }() // Release semaphore

				results[idx] = e.executeOne(ctx, call)
			}(ic.index, ic.call)
		}

		wg.Wait()
	}

	// Run serial tools one by one
	for _, ic := range serial {
		results[ic.index] = e.executeOne(ctx, ic.call)
	}

	return results
}

// executeOne runs a single tool call.
func (e *Executor) executeOne(ctx context.Context, call ToolCall) ToolCallResult {
	t := e.registry.Get(call.Name)
	if t == nil {
		return ToolCallResult{
			ToolCall: call,
			Result:   ErrorResult(fmt.Sprintf("Unknown tool: %s", call.Name)),
		}
	}

	result, err := t.Execute(ctx, call.Input)
	if err != nil {
		return ToolCallResult{
			ToolCall: call,
			Result:   ErrorResult(fmt.Sprintf("Tool execution error: %v", err)),
			Error:    err,
		}
	}

	return ToolCallResult{
		ToolCall: call,
		Result:   result,
	}
}

// BuildToolResultMessage creates a provider.Message with tool_result blocks
// from a set of execution results.
func BuildToolResultMessage(results []ToolCallResult) provider.Message {
	var blocks []provider.ContentBlock
	for _, r := range results {
		content := ""
		isError := false
		if r.Result != nil {
			content = r.Result.Content
			isError = r.Result.IsError
		} else if r.Error != nil {
			content = r.Error.Error()
			isError = true
		}
		blocks = append(blocks, provider.NewToolResultBlock(r.ToolCall.ID, content, isError))
	}
	return provider.Message{
		Role:    provider.RoleUser,
		Content: blocks,
	}
}
