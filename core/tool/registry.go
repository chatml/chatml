package tool

import (
	"fmt"
	"strings"
	"sync"

	"github.com/chatml/chatml-core/provider"
)

// Registry holds all registered tools and provides lookup by name.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
	order []string // Preserves registration order for ToolDefs()
}

// DeferredToolSummary is a one-line summary of a deferred tool for system prompt injection.
type DeferredToolSummary struct {
	Name        string
	Description string
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

// ToolDefs returns provider.ToolDef for all non-deferred registered tools,
// suitable for inclusion in a ChatRequest.
func (r *Registry) ToolDefs() []provider.ToolDef {
	tools := r.All()
	defs := make([]provider.ToolDef, 0, len(tools))
	for _, t := range tools {
		if d, ok := t.(Deferrable); ok && d.DeferLoading() {
			continue // Skip deferred tools — they're discovered via ToolSearch
		}
		defs = append(defs, ToolDef(t))
	}
	return defs
}

// DeferredSummaries returns one-line summaries of all deferred tools.
// These are injected into the system prompt so the model knows they exist
// and can use ToolSearch to fetch their full schemas.
func (r *Registry) DeferredSummaries() []DeferredToolSummary {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var summaries []DeferredToolSummary
	for _, name := range r.order {
		t := r.tools[name]
		if d, ok := t.(Deferrable); ok && d.DeferLoading() {
			summaries = append(summaries, DeferredToolSummary{
				Name:        t.Name(),
				Description: t.Description(),
			})
		}
	}
	return summaries
}

// SearchTools searches all tools (including deferred) by query string.
// Returns matching tool definitions. Supports "select:Name1,Name2" for exact
// lookup, or keyword search against name and description.
func (r *Registry) SearchTools(query string, maxResults int) []provider.ToolDef {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if maxResults <= 0 {
		maxResults = 5
	}

	// Exact selection: "select:Read,Edit,Grep"
	if strings.HasPrefix(query, "select:") {
		names := strings.Split(strings.TrimPrefix(query, "select:"), ",")
		var results []provider.ToolDef
		for _, name := range names {
			name = strings.TrimSpace(name)
			if t, ok := r.tools[name]; ok {
				results = append(results, ToolDef(t))
			}
		}
		return results
	}

	// Keyword search: match against name and description
	queryLower := strings.ToLower(query)
	keywords := strings.Fields(queryLower)

	type scored struct {
		def   provider.ToolDef
		score int
	}
	var matches []scored

	for _, name := range r.order {
		t := r.tools[name]
		nameLower := strings.ToLower(t.Name())
		descLower := strings.ToLower(t.Description())

		score := 0
		for _, kw := range keywords {
			if strings.Contains(nameLower, kw) {
				score += 10 // Name match is strong
			}
			if strings.Contains(descLower, kw) {
				score += 5 // Description match is weaker
			}
		}
		if score > 0 {
			matches = append(matches, scored{def: ToolDef(t), score: score})
		}
	}

	// Sort by score descending (simple selection sort for small N)
	for i := 0; i < len(matches)-1; i++ {
		for j := i + 1; j < len(matches); j++ {
			if matches[j].score > matches[i].score {
				matches[i], matches[j] = matches[j], matches[i]
			}
		}
	}

	var results []provider.ToolDef
	for i, m := range matches {
		if i >= maxResults {
			break
		}
		results = append(results, m.def)
	}
	return results
}

// ToolPrompts collects prompt text from all tools that implement PromptProvider.
// Returns non-empty prompt strings in registration order.
func (r *Registry) ToolPrompts() []string {
	tools := r.All()
	var prompts []string
	for _, t := range tools {
		if pp, ok := t.(PromptProvider); ok {
			if p := pp.Prompt(); p != "" {
				prompts = append(prompts, p)
			}
		}
	}
	return prompts
}

// Subset returns a new registry containing only the tools with the given names.
// Tools are added in their original registration order.
func (r *Registry) Subset(names []string) *Registry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	sub := NewRegistry()
	nameSet := make(map[string]bool, len(names))
	for _, n := range names {
		nameSet[n] = true
	}
	for _, name := range r.order {
		if nameSet[name] {
			sub.Register(r.tools[name])
		}
	}
	return sub
}

// Count returns the number of registered tools.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.tools)
}

// ToolNames returns the names of all registered tools in registration order.
func (r *Registry) ToolNames() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, len(r.order))
	copy(names, r.order)
	return names
}
