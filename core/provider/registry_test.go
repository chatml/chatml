package provider

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockProvider struct {
	name string
}

func (m *mockProvider) StreamChat(_ interface{}, _ interface{}) {}
func (m *mockProvider) Name() string                           { return m.name }

func TestRegistry_Create_MatchesPrefix(t *testing.T) {
	reg := NewRegistry()
	reg.Register("claude-", func(apiKey, model string) (Provider, error) {
		return nil, fmt.Errorf("anthropic:%s", model)
	})
	reg.Register("gpt-", func(apiKey, model string) (Provider, error) {
		return nil, fmt.Errorf("openai:%s", model)
	})

	_, err := reg.Create("key", "claude-sonnet-4-6")
	assert.Contains(t, err.Error(), "anthropic:claude-sonnet-4-6")

	_, err = reg.Create("key", "gpt-4o")
	assert.Contains(t, err.Error(), "openai:gpt-4o")
}

func TestRegistry_Create_LongestPrefixWins(t *testing.T) {
	reg := NewRegistry()
	reg.Register("claude-", func(apiKey, model string) (Provider, error) {
		return nil, fmt.Errorf("short")
	})
	reg.Register("claude-opus", func(apiKey, model string) (Provider, error) {
		return nil, fmt.Errorf("long")
	})

	_, err := reg.Create("key", "claude-opus-4-6")
	assert.Contains(t, err.Error(), "long")

	_, err = reg.Create("key", "claude-sonnet-4-6")
	assert.Contains(t, err.Error(), "short")
}

func TestRegistry_Create_NoMatch(t *testing.T) {
	reg := NewRegistry()
	reg.Register("claude-", func(apiKey, model string) (Provider, error) {
		return nil, nil
	})

	_, err := reg.Create("key", "llama-3")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no provider")
}

func TestRegistry_Create_Fallback(t *testing.T) {
	reg := NewRegistry()
	reg.SetFallback(func(apiKey, model string) (Provider, error) {
		return nil, fmt.Errorf("fallback:%s", model)
	})

	_, err := reg.Create("key", "unknown-model")
	assert.Contains(t, err.Error(), "fallback:unknown-model")
}

func TestRegistry_Prefixes(t *testing.T) {
	reg := NewRegistry()
	reg.Register("claude-", nil)
	reg.Register("gpt-", nil)
	reg.Register("o1", nil)

	prefixes := reg.Prefixes()
	require.Len(t, prefixes, 3)
}

func TestRegistry_Empty(t *testing.T) {
	reg := NewRegistry()
	_, err := reg.Create("key", "anything")
	assert.Error(t, err)
}
