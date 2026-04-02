package provider

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCalculateCost_Sonnet(t *testing.T) {
	usage := Usage{
		InputTokens:  1_000_000,
		OutputTokens: 100_000,
	}
	cost := CalculateCost("claude-sonnet-4-6", usage)
	// 1M input * $3/M + 100K output * $15/M = $3 + $1.5 = $4.5
	assert.InDelta(t, 4.5, cost, 0.001)
}

func TestCalculateCost_Opus(t *testing.T) {
	usage := Usage{
		InputTokens:  500_000,
		OutputTokens: 50_000,
	}
	cost := CalculateCost("claude-opus-4-6", usage)
	// 500K * $15/M + 50K * $75/M = $7.5 + $3.75 = $11.25
	assert.InDelta(t, 11.25, cost, 0.001)
}

func TestCalculateCost_WithCache(t *testing.T) {
	usage := Usage{
		InputTokens:             100_000,
		OutputTokens:            50_000,
		CacheReadInputTokens:    800_000,
		CacheCreationInputTokens: 100_000,
	}
	cost := CalculateCost("claude-sonnet-4-6", usage)
	// 100K * $3/M + 50K * $15/M + 800K * $0.3/M + 100K * $3.75/M
	// = $0.3 + $0.75 + $0.24 + $0.375 = $1.665
	assert.InDelta(t, 1.665, cost, 0.001)
}

func TestCalculateCost_Haiku(t *testing.T) {
	usage := Usage{
		InputTokens:  1_000_000,
		OutputTokens: 1_000_000,
	}
	cost := CalculateCost("claude-haiku-4-5-20251001", usage)
	// 1M * $0.8/M + 1M * $4/M = $0.8 + $4 = $4.8
	assert.InDelta(t, 4.8, cost, 0.001)
}

func TestCalculateCost_UnknownModel(t *testing.T) {
	usage := Usage{
		InputTokens:  1_000_000,
		OutputTokens: 100_000,
	}
	cost := CalculateCost("unknown-model-v1", usage)
	// Uses default (Sonnet) pricing
	assert.InDelta(t, 4.5, cost, 0.001)
}

func TestCalculateCost_ZeroUsage(t *testing.T) {
	cost := CalculateCost("claude-sonnet-4-6", Usage{})
	assert.Equal(t, 0.0, cost)
}
