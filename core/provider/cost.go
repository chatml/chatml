package provider

import "strings"

// modelCost holds per-million-token pricing for a model.
type modelCost struct {
	InputPerMillion          float64
	OutputPerMillion         float64
	CacheReadPerMillion      float64
	CacheCreationPerMillion  float64
}

// Model pricing as of 2025 (USD per million tokens).
var modelCosts = map[string]modelCost{
	"claude-opus-4-6": {
		InputPerMillion:         15.0,
		OutputPerMillion:        75.0,
		CacheReadPerMillion:     1.5,
		CacheCreationPerMillion: 18.75,
	},
	"claude-sonnet-4-6": {
		InputPerMillion:         3.0,
		OutputPerMillion:        15.0,
		CacheReadPerMillion:     0.3,
		CacheCreationPerMillion: 3.75,
	},
	"claude-haiku-4-5": {
		InputPerMillion:         0.8,
		OutputPerMillion:        4.0,
		CacheReadPerMillion:     0.08,
		CacheCreationPerMillion: 1.0,
	},
}

// Default cost for unknown models (use Sonnet pricing as reasonable middle ground).
var defaultCost = modelCost{
	InputPerMillion:         3.0,
	OutputPerMillion:        15.0,
	CacheReadPerMillion:     0.3,
	CacheCreationPerMillion: 3.75,
}

// CalculateCost computes the USD cost for a given model and usage.
// NOTE: In the Anthropic API, InputTokens excludes cache tokens (they are
// reported separately in CacheReadInputTokens and CacheCreationInputTokens).
// This function charges each category at its own rate without deduction.
func CalculateCost(model string, usage Usage) float64 {
	costs, ok := modelCosts[model]
	if !ok {
		// Prefix match for date-suffixed model IDs (e.g., "claude-opus-4-6-20260101")
		for prefix, c := range modelCosts {
			if strings.HasPrefix(model, prefix) {
				costs = c
				ok = true
				break
			}
		}
		if !ok {
			costs = defaultCost
		}
	}

	cost := 0.0
	cost += float64(usage.InputTokens) / 1_000_000 * costs.InputPerMillion
	cost += float64(usage.OutputTokens) / 1_000_000 * costs.OutputPerMillion
	cost += float64(usage.CacheReadInputTokens) / 1_000_000 * costs.CacheReadPerMillion
	cost += float64(usage.CacheCreationInputTokens) / 1_000_000 * costs.CacheCreationPerMillion

	return cost
}
