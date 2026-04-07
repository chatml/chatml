package naming

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

// GenerateSessionName returns a random constellation/astronomy name for session naming.
func GenerateSessionName() string {
	idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(Constellations))))
	if err != nil {
		// Fallback to first entry if crypto/rand fails (extremely unlikely)
		return Constellations[0]
	}
	return Constellations[idx.Int64()]
}

// GenerateUniqueSessionName generates a constellation name that doesn't conflict with existing names.
// If the generated name already exists, it appends a short random suffix.
func GenerateUniqueSessionName(existingNames []string) string {
	// Build lookup set for O(1) collision checking
	existing := make(map[string]bool, len(existingNames))
	for _, name := range existingNames {
		existing[strings.ToLower(name)] = true
	}

	// Try to find an unused name (up to 10 attempts)
	for i := 0; i < 10; i++ {
		name := GenerateSessionName()
		if !existing[strings.ToLower(name)] {
			return name
		}
	}

	// All attempts collided - append a random suffix
	baseName := GenerateSessionName()
	suffix := generateSuffix()
	return fmt.Sprintf("%s-%s", baseName, suffix)
}

// generateSuffix creates a short random alphanumeric suffix for collision handling.
func generateSuffix() string {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	const length = 4

	suffix := make([]byte, length)
	for i := range suffix {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			suffix[i] = 'x' // Fallback character
		} else {
			suffix[i] = charset[idx.Int64()]
		}
	}
	return string(suffix)
}
