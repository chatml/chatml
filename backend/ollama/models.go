// Package ollama model catalog — delegates to the canonical catalog in
// core/provider/ollama to avoid duplication.
package ollama

import (
	ollamaprov "github.com/chatml/chatml-core/provider/ollama"
)

// LocalModel is a type alias for the canonical model definition.
type LocalModel = ollamaprov.LocalModelDef

// SupportedLocalModels returns a copy of the canonical catalog.
func SupportedLocalModels() []LocalModel {
	return ollamaprov.AllModels()
}

// IsLocalModel delegates to the canonical implementation.
func IsLocalModel(modelID string) bool {
	return ollamaprov.IsLocalModel(modelID)
}

// LookupLocalModel returns the LocalModel for a ChatML model ID, or nil.
func LookupLocalModel(modelID string) *LocalModel {
	return ollamaprov.LookupByID(modelID)
}

// ToOllamaName converts a ChatML model ID to the Ollama model tag.
func ToOllamaName(modelID string) string {
	return ollamaprov.ToOllamaName(modelID)
}
