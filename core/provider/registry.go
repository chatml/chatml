package provider

import (
	"fmt"
	"strings"
	"sync"
)

// ProviderFactory creates a Provider from credentials.
type ProviderFactory func(apiKey, model string) (Provider, error)

// Registry maps model name patterns to provider factories.
// This allows runtime provider selection based on the model name.
type Registry struct {
	mu        sync.RWMutex
	factories map[string]ProviderFactory // prefix → factory
	fallback  ProviderFactory            // used when no prefix matches
}

// NewRegistry creates an empty provider registry.
func NewRegistry() *Registry {
	return &Registry{
		factories: make(map[string]ProviderFactory),
	}
}

// Register adds a provider factory for models matching the given prefix.
// Example prefixes: "claude-", "gpt-", "o1", "o3", "bedrock/".
func (r *Registry) Register(prefix string, factory ProviderFactory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[prefix] = factory
}

// SetFallback sets the default factory used when no prefix matches.
func (r *Registry) SetFallback(factory ProviderFactory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fallback = factory
}

// Create returns a Provider for the given model name by matching prefixes.
// Longer prefix matches take priority (e.g., "claude-opus" before "claude-").
func (r *Registry) Create(apiKey, model string) (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// Find the longest matching prefix
	var bestPrefix string
	for prefix := range r.factories {
		if strings.HasPrefix(model, prefix) && len(prefix) > len(bestPrefix) {
			bestPrefix = prefix
		}
	}

	if bestPrefix != "" {
		return r.factories[bestPrefix](apiKey, model)
	}

	if r.fallback != nil {
		return r.fallback(apiKey, model)
	}

	return nil, fmt.Errorf("no provider registered for model %q", model)
}

// Prefixes returns all registered prefixes (for debugging/listing).
func (r *Registry) Prefixes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]string, 0, len(r.factories))
	for prefix := range r.factories {
		result = append(result, prefix)
	}
	return result
}
