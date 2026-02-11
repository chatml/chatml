package naming

import (
	"strings"
	"testing"
)

// --- Constellations list integrity tests ---

func TestConstellations_NoDuplicates(t *testing.T) {
	seen := make(map[string]bool, len(Constellations))
	for _, name := range Constellations {
		if seen[name] {
			t.Errorf("Duplicate constellation name: %q", name)
		}
		seen[name] = true
	}
}

func TestConstellations_AllLowercase(t *testing.T) {
	for _, name := range Constellations {
		if name != strings.ToLower(name) {
			t.Errorf("Constellation name %q is not lowercase", name)
		}
	}
}

func TestConstellations_NoEmptyStrings(t *testing.T) {
	for i, name := range Constellations {
		if name == "" {
			t.Errorf("Constellations[%d] is empty", i)
		}
	}
}

func TestConstellations_ValidCharacters(t *testing.T) {
	for _, name := range Constellations {
		for _, c := range name {
			if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
				t.Errorf("Constellation name %q contains invalid character %q; only lowercase letters, digits, and hyphens are allowed", name, string(c))
			}
		}
	}
}

func TestConstellations_NoLeadingOrTrailingHyphens(t *testing.T) {
	for _, name := range Constellations {
		if strings.HasPrefix(name, "-") {
			t.Errorf("Constellation name %q has leading hyphen", name)
		}
		if strings.HasSuffix(name, "-") {
			t.Errorf("Constellation name %q has trailing hyphen", name)
		}
	}
}

func TestConstellations_NonEmpty(t *testing.T) {
	if len(Constellations) == 0 {
		t.Error("Constellations list is empty")
	}
}

// --- GenerateSessionName tests ---

func TestGenerateSessionName(t *testing.T) {
	name := GenerateSessionName()
	if name == "" {
		t.Error("GenerateSessionName returned empty string")
	}

	// Verify it's one of the constellations
	found := false
	for _, constellation := range Constellations {
		if name == constellation {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("GenerateSessionName returned %q which is not in Constellations list", name)
	}
}

func TestGenerateSessionName_Randomness(t *testing.T) {
	// Generate many names and verify we get variety
	names := make(map[string]bool)
	for i := 0; i < 200; i++ {
		names[GenerateSessionName()] = true
	}

	// With 174+ constellations and 200 attempts, we should see at least 20 distinct names
	if len(names) < 20 {
		t.Errorf("GenerateSessionName produced only %d unique names in 200 attempts; expected more variety", len(names))
	}
}

func TestGenerateSessionName_AlwaysValid(t *testing.T) {
	// Every call should return a valid constellation name
	constellationSet := make(map[string]bool, len(Constellations))
	for _, c := range Constellations {
		constellationSet[c] = true
	}

	for i := 0; i < 100; i++ {
		name := GenerateSessionName()
		if !constellationSet[name] {
			t.Errorf("Iteration %d: GenerateSessionName returned %q which is not a valid constellation", i, name)
		}
	}
}

// --- GenerateUniqueSessionName tests ---

func TestGenerateUniqueSessionName_NoCollision(t *testing.T) {
	existingNames := []string{"orion", "sirius", "vega"}
	name := GenerateUniqueSessionName(existingNames)

	if name == "" {
		t.Error("GenerateUniqueSessionName returned empty string")
	}

	// Should not match any existing name (case-insensitive)
	nameLower := strings.ToLower(name)
	for _, existing := range existingNames {
		if nameLower == strings.ToLower(existing) {
			// Could happen if all 10 attempts collide, but the suffix should make it unique
			if !strings.Contains(name, "-") {
				t.Errorf("GenerateUniqueSessionName returned %q which matches existing name %q", name, existing)
			}
		}
	}
}

func TestGenerateUniqueSessionName_EmptyExisting(t *testing.T) {
	name := GenerateUniqueSessionName([]string{})
	if name == "" {
		t.Error("GenerateUniqueSessionName with empty existing returned empty string")
	}

	// With no collisions, result should be a plain constellation name
	constellationSet := make(map[string]bool, len(Constellations))
	for _, c := range Constellations {
		constellationSet[c] = true
	}
	if !constellationSet[name] {
		t.Errorf("GenerateUniqueSessionName with empty existing returned %q which is not a valid constellation", name)
	}
}

func TestGenerateUniqueSessionName_NilExisting(t *testing.T) {
	name := GenerateUniqueSessionName(nil)
	if name == "" {
		t.Error("GenerateUniqueSessionName with nil existing returned empty string")
	}
}

func TestGenerateUniqueSessionName_CaseInsensitive(t *testing.T) {
	// Test that collision detection is case-insensitive
	existingNames := []string{"ORION", "Sirius", "VEGA"}

	// Run multiple times to increase chance of collision
	for i := 0; i < 100; i++ {
		name := GenerateUniqueSessionName(existingNames)
		nameLower := strings.ToLower(name)

		// If it matches an existing name (case-insensitive), it must have a suffix
		for _, existing := range existingNames {
			if nameLower == strings.ToLower(existing) {
				t.Errorf("GenerateUniqueSessionName returned %q which matches existing name %q (case-insensitive)", name, existing)
			}
		}
	}
}

func TestGenerateUniqueSessionName_HighCollision(t *testing.T) {
	// When all constellations are taken, should append a suffix
	existingNames := make([]string, len(Constellations))
	copy(existingNames, Constellations)

	name := GenerateUniqueSessionName(existingNames)

	if name == "" {
		t.Error("GenerateUniqueSessionName returned empty string")
	}

	// Suffix should be 4 chars after the last hyphen
	parts := strings.Split(name, "-")
	if len(parts) < 2 {
		t.Errorf("Expected suffix format name-xxxx, got %q", name)
		return
	}
	suffix := parts[len(parts)-1]
	if len(suffix) != 4 {
		t.Errorf("Expected 4-char suffix, got %q (%d chars)", suffix, len(suffix))
	}
}

func TestGenerateUniqueSessionName_HighCollision_BaseIsValid(t *testing.T) {
	// When all names are taken and a suffix is appended, the base should still be a real constellation
	existingNames := make([]string, len(Constellations))
	copy(existingNames, Constellations)

	constellationSet := make(map[string]bool, len(Constellations))
	for _, c := range Constellations {
		constellationSet[c] = true
	}

	for i := 0; i < 20; i++ {
		name := GenerateUniqueSessionName(existingNames)
		// Remove the last 5 chars ("-xxxx" suffix) to get the base name
		parts := strings.Split(name, "-")
		// Reconstruct the base by joining all parts except the last (the 4-char suffix)
		baseParts := parts[:len(parts)-1]
		base := strings.Join(baseParts, "-")

		if !constellationSet[base] {
			t.Errorf("Iteration %d: base name %q (from %q) is not a valid constellation", i, base, name)
		}
	}
}

func TestGenerateUniqueSessionName_HighCollision_SuffixUniqueness(t *testing.T) {
	// Multiple calls with full collision should produce different suffixes
	existingNames := make([]string, len(Constellations))
	copy(existingNames, Constellations)

	results := make(map[string]bool)
	for i := 0; i < 50; i++ {
		results[GenerateUniqueSessionName(existingNames)] = true
	}

	// With random 4-char suffixes (36^4 = 1.6M possibilities), 50 tries should all be unique
	if len(results) < 40 {
		t.Errorf("Expected mostly unique suffixed names, got only %d unique out of 50", len(results))
	}
}

func TestGenerateUniqueSessionName_WithHyphenatedExisting(t *testing.T) {
	// Test that names with hyphens in them (like "ursa-major") work correctly as existing names
	existingNames := []string{"ursa-major", "ursa-minor", "canis-major", "orion-nebula"}
	name := GenerateUniqueSessionName(existingNames)

	if name == "" {
		t.Error("GenerateUniqueSessionName returned empty string")
	}

	nameLower := strings.ToLower(name)
	for _, existing := range existingNames {
		// The base name (without suffix) should not match
		if nameLower == strings.ToLower(existing) {
			t.Errorf("GenerateUniqueSessionName returned %q which exactly matches existing %q", name, existing)
		}
	}
}

// --- generateSuffix tests ---

func TestGenerateSuffix(t *testing.T) {
	suffix := generateSuffix()

	if len(suffix) != 4 {
		t.Errorf("generateSuffix should return 4 chars, got %d", len(suffix))
	}

	// Should only contain lowercase letters and digits
	for _, c := range suffix {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			t.Errorf("generateSuffix should only contain lowercase letters and digits, got %q", suffix)
		}
	}
}

func TestGenerateSuffix_Uniqueness(t *testing.T) {
	// Generate multiple suffixes and verify they're not all the same
	suffixes := make(map[string]bool)
	for i := 0; i < 100; i++ {
		suffixes[generateSuffix()] = true
	}

	// Should have generated multiple unique suffixes
	if len(suffixes) < 10 {
		t.Errorf("generateSuffix appears to not be random, only got %d unique suffixes in 100 attempts", len(suffixes))
	}
}

func TestGenerateSuffix_ConsistentLength(t *testing.T) {
	for i := 0; i < 100; i++ {
		suffix := generateSuffix()
		if len(suffix) != 4 {
			t.Errorf("Iteration %d: generateSuffix returned %q with length %d, expected 4", i, suffix, len(suffix))
		}
	}
}
