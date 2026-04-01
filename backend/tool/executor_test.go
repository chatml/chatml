package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExecutor_EmptyCalls(t *testing.T) {
	reg := NewRegistry()
	exec := NewExecutor(reg, 4)

	results := exec.Execute(context.Background(), nil)
	assert.Nil(t, results)
}

func TestExecutor_UnknownTool(t *testing.T) {
	reg := NewRegistry()
	exec := NewExecutor(reg, 4)

	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "NonExistent", Input: json.RawMessage(`{}`)},
	})

	require.Len(t, results, 1)
	assert.True(t, results[0].Result.IsError)
	assert.Contains(t, results[0].Result.Content, "Unknown tool")
}

func TestExecutor_SingleTool(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{
		name: "Echo",
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			var in struct{ Text string }
			json.Unmarshal(input, &in)
			return TextResult("echo: " + in.Text), nil
		},
	})

	exec := NewExecutor(reg, 4)
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "Echo", Input: json.RawMessage(`{"text":"hello"}`)},
	})

	require.Len(t, results, 1)
	assert.False(t, results[0].Result.IsError)
	assert.Equal(t, "echo: hello", results[0].Result.Content)
	assert.Equal(t, "tu_1", results[0].ToolCall.ID)
}

func TestExecutor_ConcurrentPartitioning(t *testing.T) {
	// Track execution order to verify concurrent tools run before serial
	var executionOrder []string
	var mu sync.Mutex

	reg := NewRegistry()
	reg.Register(&mockTool{
		name:           "ReadA",
		concurrentSafe: true,
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			time.Sleep(50 * time.Millisecond)
			mu.Lock()
			executionOrder = append(executionOrder, "ReadA")
			mu.Unlock()
			return TextResult("readA"), nil
		},
	})
	reg.Register(&mockTool{
		name:           "ReadB",
		concurrentSafe: true,
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			time.Sleep(50 * time.Millisecond)
			mu.Lock()
			executionOrder = append(executionOrder, "ReadB")
			mu.Unlock()
			return TextResult("readB"), nil
		},
	})
	reg.Register(&mockTool{
		name:           "Write",
		concurrentSafe: false,
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			mu.Lock()
			executionOrder = append(executionOrder, "Write")
			mu.Unlock()
			return TextResult("wrote"), nil
		},
	})

	exec := NewExecutor(reg, 4)

	start := time.Now()
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "ReadA", Input: json.RawMessage(`{}`)},
		{ID: "tu_2", Name: "Write", Input: json.RawMessage(`{}`)},
		{ID: "tu_3", Name: "ReadB", Input: json.RawMessage(`{}`)},
	})
	elapsed := time.Since(start)

	require.Len(t, results, 3)

	// Concurrent reads should have run in parallel (< 100ms total, not 100ms)
	assert.Less(t, elapsed, 150*time.Millisecond, "concurrent tools should run in parallel")

	// Results should be in original order regardless of execution order
	assert.Equal(t, "tu_1", results[0].ToolCall.ID)
	assert.Equal(t, "readA", results[0].Result.Content)
	assert.Equal(t, "tu_2", results[1].ToolCall.ID)
	assert.Equal(t, "wrote", results[1].Result.Content)
	assert.Equal(t, "tu_3", results[2].ToolCall.ID)
	assert.Equal(t, "readB", results[2].Result.Content)

	// Serial tool (Write) should execute after concurrent tools
	mu.Lock()
	writeIdx := -1
	for i, name := range executionOrder {
		if name == "Write" {
			writeIdx = i
		}
	}
	mu.Unlock()
	assert.Equal(t, len(executionOrder)-1, writeIdx, "Write (serial) should execute last")
}

func TestExecutor_ConcurrencyLimit(t *testing.T) {
	var maxConcurrent atomic.Int32
	var currentConcurrent atomic.Int32

	reg := NewRegistry()
	for i := 0; i < 10; i++ {
		name := string(rune('A' + i))
		reg.Register(&mockTool{
			name:           name,
			concurrentSafe: true,
			execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
				cur := currentConcurrent.Add(1)
				// Track max concurrent
				for {
					old := maxConcurrent.Load()
					if cur <= old || maxConcurrent.CompareAndSwap(old, cur) {
						break
					}
				}
				time.Sleep(20 * time.Millisecond)
				currentConcurrent.Add(-1)
				return TextResult("ok"), nil
			},
		})
	}

	exec := NewExecutor(reg, 3) // Limit to 3 concurrent

	calls := make([]ToolCall, 10)
	for i := 0; i < 10; i++ {
		calls[i] = ToolCall{ID: "tu_" + string(rune('A'+i)), Name: string(rune('A' + i)), Input: json.RawMessage(`{}`)}
	}

	results := exec.Execute(context.Background(), calls)
	require.Len(t, results, 10)

	// Max concurrent should not exceed 3
	assert.LessOrEqual(t, maxConcurrent.Load(), int32(3), "should respect concurrency limit")
}

func TestExecutor_ToolError(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{
		name: "Fail",
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			return ErrorResult("something went wrong"), nil
		},
	})

	exec := NewExecutor(reg, 4)
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "Fail", Input: json.RawMessage(`{}`)},
	})

	require.Len(t, results, 1)
	assert.True(t, results[0].Result.IsError)
	assert.Contains(t, results[0].Result.Content, "something went wrong")
}

func TestBuildToolResultMessage(t *testing.T) {
	results := []ToolCallResult{
		{
			ToolCall: ToolCall{ID: "tu_1", Name: "Read"},
			Result:   TextResult("file contents here"),
		},
		{
			ToolCall: ToolCall{ID: "tu_2", Name: "Write"},
			Result:   ErrorResult("permission denied"),
		},
	}

	msg := BuildToolResultMessage(results)
	assert.Equal(t, "user", string(msg.Role))
	require.Len(t, msg.Content, 2)

	assert.Equal(t, "tool_result", string(msg.Content[0].Type))
	assert.Equal(t, "tu_1", msg.Content[0].ForToolUseID)
	assert.Equal(t, "file contents here", msg.Content[0].ResultContent)
	assert.False(t, msg.Content[0].IsError)

	assert.Equal(t, "tool_result", string(msg.Content[1].Type))
	assert.Equal(t, "tu_2", msg.Content[1].ForToolUseID)
	assert.True(t, msg.Content[1].IsError)
}

func TestBuildToolResultMessage_NilResult(t *testing.T) {
	results := []ToolCallResult{
		{
			ToolCall: ToolCall{ID: "tu_1", Name: "Bad"},
			Result:   nil,
			Error:    fmt.Errorf("tool crashed"),
		},
	}

	msg := BuildToolResultMessage(results)
	require.Len(t, msg.Content, 1)
	assert.True(t, msg.Content[0].IsError)
	assert.Contains(t, msg.Content[0].ResultContent, "tool crashed")
}

func TestExecutor_DefaultMaxConcurrent(t *testing.T) {
	reg := NewRegistry()
	exec := NewExecutor(reg, 0)
	// Should not panic and should default to 8
	results := exec.Execute(context.Background(), nil)
	assert.Nil(t, results)
}

func TestExecutor_ContextCancellation(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{
		name:           "Slow",
		concurrentSafe: true,
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			select {
			case <-ctx.Done():
				return ErrorResult("cancelled"), nil
			case <-time.After(5 * time.Second):
				return TextResult("done"), nil
			}
		},
	})

	exec := NewExecutor(reg, 4)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan []ToolCallResult, 1)
	go func() {
		done <- exec.Execute(ctx, []ToolCall{
			{ID: "tu_1", Name: "Slow", Input: json.RawMessage(`{}`)},
		})
	}()

	// Cancel immediately
	cancel()

	results := <-done
	require.Len(t, results, 1)
	assert.True(t, results[0].Result.IsError)
	assert.Contains(t, results[0].Result.Content, "cancelled")
}

func TestExecutor_ToolSystemError(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{
		name: "Crasher",
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			return nil, fmt.Errorf("unexpected panic")
		},
	})

	exec := NewExecutor(reg, 4)
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "Crasher", Input: json.RawMessage(`{}`)},
	})

	require.Len(t, results, 1)
	assert.True(t, results[0].Result.IsError)
	assert.Contains(t, results[0].Result.Content, "Tool execution error")
	assert.NotNil(t, results[0].Error)
}

func TestExecutor_AllSerialTools(t *testing.T) {
	var order []string
	var mu sync.Mutex

	reg := NewRegistry()
	for _, name := range []string{"W1", "W2", "W3"} {
		n := name
		reg.Register(&mockTool{
			name:           n,
			concurrentSafe: false,
			execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
				mu.Lock()
				order = append(order, n)
				mu.Unlock()
				return TextResult(n), nil
			},
		})
	}

	exec := NewExecutor(reg, 4)
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "W1", Input: json.RawMessage(`{}`)},
		{ID: "tu_2", Name: "W2", Input: json.RawMessage(`{}`)},
		{ID: "tu_3", Name: "W3", Input: json.RawMessage(`{}`)},
	})

	require.Len(t, results, 3)
	// Serial tools should execute in order
	mu.Lock()
	assert.Equal(t, []string{"W1", "W2", "W3"}, order)
	mu.Unlock()
	// Results should be in original order
	assert.Equal(t, "W1", results[0].Result.Content)
	assert.Equal(t, "W2", results[1].Result.Content)
	assert.Equal(t, "W3", results[2].Result.Content)
}

func TestExecutor_AllConcurrentTools(t *testing.T) {
	reg := NewRegistry()
	for _, name := range []string{"R1", "R2", "R3"} {
		n := name
		reg.Register(&mockTool{
			name:           n,
			concurrentSafe: true,
			execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
				time.Sleep(30 * time.Millisecond)
				return TextResult(n), nil
			},
		})
	}

	exec := NewExecutor(reg, 10)
	start := time.Now()
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "R1", Input: json.RawMessage(`{}`)},
		{ID: "tu_2", Name: "R2", Input: json.RawMessage(`{}`)},
		{ID: "tu_3", Name: "R3", Input: json.RawMessage(`{}`)},
	})
	elapsed := time.Since(start)

	require.Len(t, results, 3)
	// All concurrent — should complete in ~30ms, not 90ms
	assert.Less(t, elapsed, 80*time.Millisecond)
}

func TestExecutor_MixedUnknownTool(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{
		name: "Good",
		execFn: func(ctx context.Context, input json.RawMessage) (*Result, error) {
			return TextResult("ok"), nil
		},
	})

	exec := NewExecutor(reg, 4)
	results := exec.Execute(context.Background(), []ToolCall{
		{ID: "tu_1", Name: "Good", Input: json.RawMessage(`{}`)},
		{ID: "tu_2", Name: "Missing", Input: json.RawMessage(`{}`)},
	})

	require.Len(t, results, 2)
	assert.False(t, results[0].Result.IsError)
	assert.True(t, results[1].Result.IsError)
	assert.Contains(t, results[1].Result.Content, "Unknown tool")
}
