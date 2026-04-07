package tool

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockTool is a minimal Tool implementation for testing.
type mockTool struct {
	name           string
	description    string
	concurrentSafe bool
	execFn         func(ctx context.Context, input json.RawMessage) (*Result, error)
}

func (t *mockTool) Name() string               { return t.name }
func (t *mockTool) Description() string         { return t.description }
func (t *mockTool) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (t *mockTool) IsConcurrentSafe() bool      { return t.concurrentSafe }
func (t *mockTool) Execute(ctx context.Context, input json.RawMessage) (*Result, error) {
	if t.execFn != nil {
		return t.execFn(ctx, input)
	}
	return TextResult("mock result"), nil
}

func TestRegistry_RegisterAndGet(t *testing.T) {
	reg := NewRegistry()

	tool1 := &mockTool{name: "Bash"}
	tool2 := &mockTool{name: "Read"}

	reg.Register(tool1)
	reg.Register(tool2)

	assert.Equal(t, tool1, reg.Get("Bash"))
	assert.Equal(t, tool2, reg.Get("Read"))
	assert.Nil(t, reg.Get("NonExistent"))
}

func TestRegistry_Count(t *testing.T) {
	reg := NewRegistry()
	assert.Equal(t, 0, reg.Count())

	reg.Register(&mockTool{name: "A"})
	assert.Equal(t, 1, reg.Count())

	reg.Register(&mockTool{name: "B"})
	assert.Equal(t, 2, reg.Count())
}

func TestRegistry_All_PreservesOrder(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{name: "C"})
	reg.Register(&mockTool{name: "A"})
	reg.Register(&mockTool{name: "B"})

	all := reg.All()
	require.Len(t, all, 3)
	assert.Equal(t, "C", all[0].Name())
	assert.Equal(t, "A", all[1].Name())
	assert.Equal(t, "B", all[2].Name())
}

func TestRegistry_DuplicatePanics(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{name: "Bash"})

	assert.Panics(t, func() {
		reg.Register(&mockTool{name: "Bash"})
	})
}

func TestRegistry_ToolDefs(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{name: "Read", description: "Read files"})
	reg.Register(&mockTool{name: "Write", description: "Write files"})

	defs := reg.ToolDefs()
	require.Len(t, defs, 2)
	assert.Equal(t, "Read", defs[0].Name)
	assert.Equal(t, "Read files", defs[0].Description)
	assert.Equal(t, "Write", defs[1].Name)
}

func TestRegistry_ToolDefs_IncludesInputSchema(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&mockTool{name: "Read", description: "Read files"})

	defs := reg.ToolDefs()
	require.Len(t, defs, 1)
	assert.JSONEq(t, `{"type":"object"}`, string(defs[0].InputSchema))
}

func TestRegistry_Empty(t *testing.T) {
	reg := NewRegistry()
	assert.Nil(t, reg.Get("anything"))
	assert.Empty(t, reg.All())
	assert.Empty(t, reg.ToolDefs())
}

// --- tool.go helper tests ---

func TestToolDef_Conversion(t *testing.T) {
	mock := &mockTool{name: "Bash", description: "Run commands"}
	def := ToolDef(mock)
	assert.Equal(t, "Bash", def.Name)
	assert.Equal(t, "Run commands", def.Description)
	assert.JSONEq(t, `{"type":"object"}`, string(def.InputSchema))
}

func TestErrorResult(t *testing.T) {
	r := ErrorResult("something failed")
	assert.True(t, r.IsError)
	assert.Equal(t, "something failed", r.Content)
	assert.Nil(t, r.Metadata)
}

func TestTextResult(t *testing.T) {
	r := TextResult("hello")
	assert.False(t, r.IsError)
	assert.Equal(t, "hello", r.Content)
	assert.Nil(t, r.Metadata)
}
