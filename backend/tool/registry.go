package tool

import (
	"fmt"
	"sync"

	"github.com/chatml/chatml-backend/provider"
)

// Registry holds all registered tools and provides lookup by name.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
	order []string // Preserves registration order for ToolDefs()
}

// NewRegistry creates an empty tool registry.
func NewRegistry() *Registry {
	return &Registry{
		tools: make(map[string]Tool),
	}
}

// Register adds a tool to the registry. Panics if a tool with the same name
// is already registered (catches configuration bugs at startup).
func (r *Registry) Register(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := t.Name()
	if _, exists := r.tools[name]; exists {
		panic(fmt.Sprintf("tool %q already registered", name))
	}
	r.tools[name] = t
	r.order = append(r.order, name)
}

// Get returns a tool by name, or nil if not found.
func (r *Registry) Get(name string) Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tools[name]
}

// All returns all registered tools in registration order.
func (r *Registry) All() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]Tool, 0, len(r.order))
	for _, name := range r.order {
		result = append(result, r.tools[name])
	}
	return result
}

// ToolDefs returns provider.ToolDef for all registered tools, suitable for
// inclusion in a ChatRequest.
func (r *Registry) ToolDefs() []provider.ToolDef {
	tools := r.All()
	defs := make([]provider.ToolDef, 0, len(tools))
	for _, t := range tools {
		defs = append(defs, ToolDef(t))
	}
	return defs
}

// Count returns the number of registered tools.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.tools)
}
