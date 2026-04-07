// Canonical catalog of local models supported via Ollama.
// This is the single source of truth — other packages (core/loop, backend/ollama)
// should import from here rather than maintaining parallel maps.
package ollama

import "strings"

// LocalModelDef describes a locally-available model that ChatML can run via Ollama.
type LocalModelDef struct {
	ID            string // ChatML model ID, e.g. "gemma-4-27b"
	OllamaName    string // Ollama model tag, e.g. "gemma4:27b"
	DisplayName   string // UI label
	Description   string // Short description for model selector
	ContextWindow int    // Max context window in tokens
	Cutoff        string // Knowledge cutoff date
}

// supportedModels is the catalog of local models we support out of the box.
// Access via AllModels() to prevent mutation of the slice and its pre-built indexes.
var supportedModels = []LocalModelDef{
	{
		ID:            "gemma-4-e2b",
		OllamaName:    "gemma4:e2b",
		DisplayName:   "Gemma 4 E2B",
		Description:   "Ultra-light local model (2B)",
		ContextWindow: 128000,
		Cutoff:        "March 2025",
	},
	{
		ID:            "gemma-4-e4b",
		OllamaName:    "gemma4:e4b",
		DisplayName:   "Gemma 4 E4B",
		Description:   "Fast local model (4B)",
		ContextWindow: 128000,
		Cutoff:        "March 2025",
	},
	{
		ID:            "gemma-4-27b",
		OllamaName:    "gemma4:27b",
		DisplayName:   "Gemma 4 27B",
		Description:   "Local MoE model (4B active)",
		ContextWindow: 256000,
		Cutoff:        "March 2025",
	},
	{
		ID:            "gemma-4-31b",
		OllamaName:    "gemma4:31b",
		DisplayName:   "Gemma 4 31B",
		Description:   "Most capable local model",
		ContextWindow: 256000,
		Cutoff:        "March 2025",
	},
}

// Pre-built indexes for fast lookup.
var (
	byID        map[string]*LocalModelDef
	byOllama    map[string]*LocalModelDef
	ctxWindows  map[string]int // ollama name → context window
)

func init() {
	byID = make(map[string]*LocalModelDef, len(supportedModels))
	byOllama = make(map[string]*LocalModelDef, len(supportedModels))
	ctxWindows = make(map[string]int, len(supportedModels))
	for i := range supportedModels {
		m := &supportedModels[i]
		byID[m.ID] = m
		byOllama[m.OllamaName] = m
		ctxWindows[m.OllamaName] = m.ContextWindow
	}
}

// AllModels returns a copy of the supported local model catalog.
func AllModels() []LocalModelDef {
	out := make([]LocalModelDef, len(supportedModels))
	copy(out, supportedModels)
	return out
}

// IsLocalModel returns true if the model ID corresponds to a local model.
func IsLocalModel(modelID string) bool {
	if _, ok := byID[modelID]; ok {
		return true
	}
	return strings.HasPrefix(modelID, "ollama/")
}

// LookupByID returns the model def for a ChatML model ID, or nil.
func LookupByID(modelID string) *LocalModelDef {
	return byID[modelID]
}

// LookupByOllamaName returns the model def for an Ollama tag, or nil.
func LookupByOllamaName(name string) *LocalModelDef {
	return byOllama[name]
}

// ToOllamaName converts a ChatML model ID to the Ollama model tag.
func ToOllamaName(modelID string) string {
	if m := byID[modelID]; m != nil {
		return m.OllamaName
	}
	if strings.HasPrefix(modelID, "ollama/") {
		return strings.TrimPrefix(modelID, "ollama/")
	}
	return modelID
}

// ContextWindowForOllamaModel returns the context window for an Ollama model tag.
func ContextWindowForOllamaModel(ollamaName string) (int, bool) {
	w, ok := ctxWindows[ollamaName]
	return w, ok
}
