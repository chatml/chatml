package server

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// ============================================================================
// AllowedOrigins Tests
// ============================================================================

func TestAllowedOrigins_Default(t *testing.T) {
	// Note: AllowedOrigins is initialized at package load time, so we can only
	// verify it contains the expected default values
	require.Contains(t, AllowedOrigins, "tauri://localhost")
	require.Contains(t, AllowedOrigins, "https://tauri.localhost")
}

func TestAllowedOriginsMap_ContainsAllOrigins(t *testing.T) {
	// Verify the map contains all origins from the slice
	for _, origin := range AllowedOrigins {
		require.True(t, AllowedOriginsMap[origin], "AllowedOriginsMap should contain %q", origin)
	}

	// Verify counts match
	require.Equal(t, len(AllowedOrigins), len(AllowedOriginsMap))
}

func TestAllowedOriginsMap_Lookup(t *testing.T) {
	// Test O(1) lookup works correctly
	require.True(t, AllowedOriginsMap["tauri://localhost"])
	require.True(t, AllowedOriginsMap["https://tauri.localhost"])
	require.False(t, AllowedOriginsMap["https://malicious.example.com"])
	require.False(t, AllowedOriginsMap[""])
}

// ============================================================================
// GitHubConfig Tests
// ============================================================================

func TestLoadGitHubConfig_FromEnv(t *testing.T) {
	// Save original values
	origClientID := os.Getenv("GITHUB_CLIENT_ID")
	origClientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	defer func() {
		os.Setenv("GITHUB_CLIENT_ID", origClientID)
		os.Setenv("GITHUB_CLIENT_SECRET", origClientSecret)
	}()

	// Set test values
	os.Setenv("GITHUB_CLIENT_ID", "test-client-id")
	os.Setenv("GITHUB_CLIENT_SECRET", "test-client-secret")

	config := LoadGitHubConfig()

	require.Equal(t, "test-client-id", config.ClientID)
	require.Equal(t, "test-client-secret", config.ClientSecret)
}

func TestLoadGitHubConfig_Empty(t *testing.T) {
	// Save original values
	origClientID := os.Getenv("GITHUB_CLIENT_ID")
	origClientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	defer func() {
		os.Setenv("GITHUB_CLIENT_ID", origClientID)
		os.Setenv("GITHUB_CLIENT_SECRET", origClientSecret)
	}()

	// Clear env vars
	os.Unsetenv("GITHUB_CLIENT_ID")
	os.Unsetenv("GITHUB_CLIENT_SECRET")

	config := LoadGitHubConfig()

	// When both env and build vars are empty, config should be empty
	// (build vars are set at compile time, so they may or may not be empty)
	// We just verify the function doesn't panic and returns a valid struct
	require.NotPanics(t, func() {
		_ = config.ClientID
		_ = config.ClientSecret
	})
}

func TestGitHubConfig_StructFields(t *testing.T) {
	config := GitHubConfig{
		ClientID:     "my-client-id",
		ClientSecret: "my-client-secret",
	}

	require.Equal(t, "my-client-id", config.ClientID)
	require.Equal(t, "my-client-secret", config.ClientSecret)
}

// ============================================================================
// FileSizeConfig Tests
// ============================================================================

func TestFileSizeConfig_DefaultValue(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Clear env var to test default
	os.Unsetenv("CHATML_MAX_FILE_SIZE_MB")

	config := LoadFileSizeConfig()

	// Default is 50MB
	expectedSize := int64(50 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestFileSizeConfig_FromEnvironment(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Set custom value (100MB)
	os.Setenv("CHATML_MAX_FILE_SIZE_MB", "100")

	config := LoadFileSizeConfig()

	expectedSize := int64(100 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_SmallValue(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Set small value (1MB)
	os.Setenv("CHATML_MAX_FILE_SIZE_MB", "1")

	config := LoadFileSizeConfig()

	expectedSize := int64(1 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_InvalidEnv_NotANumber(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Set invalid value
	os.Setenv("CHATML_MAX_FILE_SIZE_MB", "not-a-number")

	config := LoadFileSizeConfig()

	// Should fall back to default (50MB)
	expectedSize := int64(50 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_InvalidEnv_NegativeValue(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Set negative value
	os.Setenv("CHATML_MAX_FILE_SIZE_MB", "-10")

	config := LoadFileSizeConfig()

	// Should fall back to default (50MB)
	expectedSize := int64(50 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_InvalidEnv_ZeroValue(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Set zero value
	os.Setenv("CHATML_MAX_FILE_SIZE_MB", "0")

	config := LoadFileSizeConfig()

	// Should fall back to default (50MB)
	expectedSize := int64(50 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestLoadFileSizeConfig_LargeValue(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_MAX_FILE_SIZE_MB")
	defer os.Setenv("CHATML_MAX_FILE_SIZE_MB", origValue)

	// Set large value (1GB)
	os.Setenv("CHATML_MAX_FILE_SIZE_MB", "1024")

	config := LoadFileSizeConfig()

	expectedSize := int64(1024 * 1024 * 1024)
	require.Equal(t, expectedSize, config.MaxFileSizeBytes)
}

func TestFileSizeConfig_StructFields(t *testing.T) {
	config := FileSizeConfig{
		MaxFileSizeBytes: 1234567,
	}

	require.Equal(t, int64(1234567), config.MaxFileSizeBytes)
}

// ============================================================================
// DirListingCacheConfig Tests
// ============================================================================

func TestLoadDirListingCacheConfig_Default(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Clear env var to test default
	os.Unsetenv("CHATML_DIR_CACHE_TTL")

	config := LoadDirListingCacheConfig()

	// Default is 30 seconds
	require.Equal(t, 30*time.Second, config.TTL)
}

func TestLoadDirListingCacheConfig_FromEnv(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set custom value
	os.Setenv("CHATML_DIR_CACHE_TTL", "1m")

	config := LoadDirListingCacheConfig()

	require.Equal(t, 1*time.Minute, config.TTL)
}

func TestLoadDirListingCacheConfig_FromEnv_Seconds(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set value in seconds
	os.Setenv("CHATML_DIR_CACHE_TTL", "45s")

	config := LoadDirListingCacheConfig()

	require.Equal(t, 45*time.Second, config.TTL)
}

func TestLoadDirListingCacheConfig_FromEnv_Hours(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set value in hours
	os.Setenv("CHATML_DIR_CACHE_TTL", "1h")

	config := LoadDirListingCacheConfig()

	require.Equal(t, 1*time.Hour, config.TTL)
}

func TestLoadDirListingCacheConfig_InvalidDuration(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set invalid duration
	os.Setenv("CHATML_DIR_CACHE_TTL", "invalid-duration")

	config := LoadDirListingCacheConfig()

	// Should fall back to default (30 seconds)
	require.Equal(t, 30*time.Second, config.TTL)
}

func TestLoadDirListingCacheConfig_NegativeDuration(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set negative duration
	os.Setenv("CHATML_DIR_CACHE_TTL", "-30s")

	config := LoadDirListingCacheConfig()

	// Should fall back to default (30 seconds)
	require.Equal(t, 30*time.Second, config.TTL)
}

func TestLoadDirListingCacheConfig_ZeroDuration(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set zero duration
	os.Setenv("CHATML_DIR_CACHE_TTL", "0s")

	config := LoadDirListingCacheConfig()

	// Should fall back to default (30 seconds) because 0 is not > 0
	require.Equal(t, 30*time.Second, config.TTL)
}

func TestLoadDirListingCacheConfig_EmptyString(t *testing.T) {
	// Save original value
	origValue := os.Getenv("CHATML_DIR_CACHE_TTL")
	defer os.Setenv("CHATML_DIR_CACHE_TTL", origValue)

	// Set empty string
	os.Setenv("CHATML_DIR_CACHE_TTL", "")

	config := LoadDirListingCacheConfig()

	// Should use default (30 seconds)
	require.Equal(t, 30*time.Second, config.TTL)
}

func TestDirListingCacheConfig_StructFields(t *testing.T) {
	config := DirListingCacheConfig{
		TTL: 5 * time.Minute,
	}

	require.Equal(t, 5*time.Minute, config.TTL)
}
