package loop

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/provider"
	"github.com/chatml/chatml-backend/tool"
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
		time.Sleep(m.execDelay)
	}
	return tool.TextResult(m.result), nil
}

func TestStreamingExecutor_ConcurrentStartsImmediately(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Read", concurrent: true, execDelay: 50 * time.Millisecond, result: "file content"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(reg, exec)

	start := time.Now()
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Read", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_2", Name: "Read", Input: json.RawMessage(`{}`)})

	// Both should be running concurrently now
	allCalls := []provider.ToolUseBlock{
		{ID: "tu_1", Name: "Read"}, {ID: "tu_2", Name: "Read"},
	}
	results := se.Collect(context.Background(), allCalls)
	elapsed := time.Since(start)

	require.Len(t, results, 2)
	assert.Equal(t, "file content", results[0].Result.Content)
	assert.Equal(t, "file content", results[1].Result.Content)
	// Both ran concurrently — should complete in ~50ms, not 100ms
	assert.Less(t, elapsed, 90*time.Millisecond)
}

func TestStreamingExecutor_SerialQueued(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Bash", concurrent: false, result: "output"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Bash", Input: json.RawMessage(`{}`)})

	// CompletedCount should be 0 — serial tools are queued
	assert.Equal(t, 0, se.CompletedCount())

	allCalls := []provider.ToolUseBlock{{ID: "tu_1", Name: "Bash"}}
	results := se.Collect(context.Background(), allCalls)

	require.Len(t, results, 1)
	assert.Equal(t, "output", results[0].Result.Content)
}

func TestStreamingExecutor_MixedConcurrentSerial(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "Read", concurrent: true, execDelay: 30 * time.Millisecond, result: "read"})
	reg.Register(&mockToolForSE{name: "Bash", concurrent: false, result: "bash"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Read", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_2", Name: "Bash", Input: json.RawMessage(`{}`)})

	allCalls := []provider.ToolUseBlock{
		{ID: "tu_1", Name: "Read"}, {ID: "tu_2", Name: "Bash"},
	}
	results := se.Collect(context.Background(), allCalls)

	require.Len(t, results, 2)
	assert.Equal(t, "read", results[0].Result.Content)
	assert.Equal(t, "bash", results[1].Result.Content)
}

func TestStreamingExecutor_UnknownTool(t *testing.T) {
	reg := tool.NewRegistry()
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "tu_1", Name: "Missing", Input: json.RawMessage(`{}`)})

	allCalls := []provider.ToolUseBlock{{ID: "tu_1", Name: "Missing"}}
	results := se.Collect(context.Background(), allCalls)

	require.Len(t, results, 1)
	assert.True(t, results[0].Result.IsError)
	assert.Contains(t, results[0].Result.Content, "Unknown tool")
}

func TestStreamingExecutor_Empty(t *testing.T) {
	reg := tool.NewRegistry()
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(reg, exec)
	results := se.Collect(context.Background(), nil)
	assert.Empty(t, results)
}

func TestStreamingExecutor_OrderPreserved(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockToolForSE{name: "A", concurrent: true, result: "a"})
	reg.Register(&mockToolForSE{name: "B", concurrent: false, result: "b"})
	reg.Register(&mockToolForSE{name: "C", concurrent: true, result: "c"})
	exec := tool.NewExecutor(reg, 8)

	se := NewStreamingToolExecutor(reg, exec)
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "1", Name: "A", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "2", Name: "B", Input: json.RawMessage(`{}`)})
	se.AddTool(context.Background(), provider.ToolUseBlock{ID: "3", Name: "C", Input: json.RawMessage(`{}`)})

	allCalls := []provider.ToolUseBlock{
		{ID: "1", Name: "A"}, {ID: "2", Name: "B"}, {ID: "3", Name: "C"},
	}
	results := se.Collect(context.Background(), allCalls)

	require.Len(t, results, 3)
	assert.Equal(t, "a", results[0].Result.Content)
	assert.Equal(t, "b", results[1].Result.Content)
	assert.Equal(t, "c", results[2].Result.Content)
}
