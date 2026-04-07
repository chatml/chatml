package loop

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/chatml/chatml-core/provider"
	"github.com/chatml/chatml-core/tool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockToolForSE struct {
	name       string
	concurrent bool
	execDelay  time.Duration
	result     string
}

func (m *mockToolForSE) Name() string                     { return m.name }
func (m *mockToolForSE) Description() string               { return "" }
func (m *mockToolForSE) InputSchema() json.RawMessage       { return json.RawMessage(`{}`) }
func (m *mockToolForSE) IsConcurrentSafe() bool             { return m.concurrent }
func (m *mockToolForSE) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	if m.execDelay > 0 {
		select {
		case <-time.After(m.execDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return tool.TextResult(m.result), nil
}

func TestStreamingExecutor_ConcurrentStartsImmediately(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Read", concurrent: true, execDelay: 50 * time.Millisecond, result: "file content"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(context.Background(), reg, exec)

	start := time.Now()
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Read", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_2", Name: "Read", Input: json.RawMessage(`{}`)})

	// Both should be running concurrently now
	concurrentResults, pendingSerial := se.Collect(context.Background())
	elapsed := time.Since(start)

	require.Len(t, concurrentResults, 2)
	assert.Equal(t, "file content", concurrentResults["tu_1"].Result.Content)
	assert.Equal(t, "file content", concurrentResults["tu_2"].Result.Content)
	assert.Empty(t, pendingSerial, "no serial tools should be pending")
	// Both ran concurrently — should complete in ~50ms, not 100ms
	assert.Less(t, elapsed, 90*time.Millisecond)
}

func TestStreamingExecutor_SerialQueued(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Bash", concurrent: false, result: "output"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(context.Background(), reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Bash", Input: json.RawMessage(`{}`)})

	// CompletedCount should be 0 — serial tools are queued
	assert.Equal(t, 0, se.CompletedCount())

	concurrentResults, pendingSerial := se.Collect(context.Background())

	assert.Empty(t, concurrentResults, "no concurrent results")
	require.Len(t, pendingSerial, 1, "serial tool should be in pending")
	assert.Equal(t, "Bash", pendingSerial[0].Name)
}

func TestStreamingExecutor_MixedConcurrentSerial(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Read", concurrent: true, execDelay: 30 * time.Millisecond, result: "read"})
	reg.Register(&mockToolForSE{name: "Bash", concurrent: false, result: "bash"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(context.Background(), reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Read", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_2", Name: "Bash", Input: json.RawMessage(`{}`)})

	concurrentResults, pendingSerial := se.Collect(context.Background())

	require.Len(t, concurrentResults, 1, "one concurrent result")
	assert.Equal(t, "read", concurrentResults["tu_1"].Result.Content)
	require.Len(t, pendingSerial, 1, "one serial tool pending")
	assert.Equal(t, "Bash", pendingSerial[0].Name)
}

func TestStreamingExecutor_UnknownTool(t *testing.T) {
	reg := tool.NewRegistry()
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(context.Background(), reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Missing", Input: json.RawMessage(`{}`)})

	// Unknown tools are queued as serial (registry.Get returns nil, so not concurrent-safe)
	_, pendingSerial := se.Collect(context.Background())
	require.Len(t, pendingSerial, 1)
	assert.Equal(t, "Missing", pendingSerial[0].Name)
}

func TestStreamingExecutor_Empty(t *testing.T) {
	reg := tool.NewRegistry()
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(context.Background(), reg, exec)
	concurrentResults, pendingSerial := se.Collect(context.Background())
	assert.Empty(t, concurrentResults)
	assert.Empty(t, pendingSerial)
}

func TestStreamingExecutor_OrderPreserved(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "A", concurrent: true, result: "a"})
	reg.Register(&mockToolForSE{name: "B", concurrent: false, result: "b"})
	reg.Register(&mockToolForSE{name: "C", concurrent: true, result: "c"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(context.Background(), reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "1", Name: "A", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "2", Name: "B", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "3", Name: "C", Input: json.RawMessage(`{}`)})

	concurrentResults, pendingSerial := se.Collect(context.Background())

	require.Len(t, concurrentResults, 2, "A and C are concurrent")
	assert.Equal(t, "a", concurrentResults["1"].Result.Content)
	assert.Equal(t, "c", concurrentResults["3"].Result.Content)
	require.Len(t, pendingSerial, 1, "B is serial")
	assert.Equal(t, "B", pendingSerial[0].Name)
}

func TestStreamingExecutor_ParentContextCancellation(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Read", concurrent: true, execDelay: 5 * time.Second, result: "slow"})
	exec := tool.NewExecutor(reg, 8)

	parentCtx, cancel := context.WithCancel(context.Background())
	se := NewStreamingToolExecutor(parentCtx, reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Read", Input: json.RawMessage(`{}`)})

	// Cancel parent context — should cancel the sibling context and in-flight tools
	cancel()

	concurrentResults, _ := se.Collect(context.Background())
	require.Len(t, concurrentResults, 1)
	// The tool should have been cancelled (error result)
	assert.True(t, concurrentResults["tu_1"].Result.IsError || concurrentResults["tu_1"].Error != nil,
		"tool should fail due to context cancellation")
}
