package naming

import (
	"strings"
	"testing"
)

func TestGenerateSessionName(t *testing.T) {
	name := GenerateSessionName()
	if name == "" {
		t.Error("GenerateSessionName returned empty string")
	}

	// Verify it's one of the cities
	found := false
	for _, city := range Cities {
		if name == city {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("GenerateSessionName returned %q which is not in Cities list", name)
	}
}

func TestGenerateUniqueSessionName_NoCollision(t *testing.T) {
	existingNames := []string{"tokyo", "london", "paris"}
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

func TestGenerateUniqueSessionName_CaseInsensitive(t *testing.T) {
	// Test that collision detection is case-insensitive
	existingNames := []string{"TOKYO", "London", "PARIS"}

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
	// When all cities are taken, should append a suffix
	existingNames := make([]string, len(Cities))
	copy(existingNames, Cities)

	name := GenerateUniqueSessionName(existingNames)

	if name == "" {
		t.Error("GenerateUniqueSessionName returned empty string")
	}

	// Should have a suffix (city-xxxx format)
	if !strings.Contains(name, "-") {
		t.Errorf("GenerateUniqueSessionName should append suffix when all cities are taken, got %q", name)
	}

	// Suffix should be 4 chars after the hyphen
	parts := strings.Split(name, "-")
	if len(parts) < 2 {
		t.Errorf("Expected suffix format city-xxxx, got %q", name)
		return
	}
	suffix := parts[len(parts)-1]
	if len(suffix) != 4 {
		t.Errorf("Expected 4-char suffix, got %q (%d chars)", suffix, len(suffix))
	}
}

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
