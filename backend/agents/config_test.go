package agents

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// ============================================================================
// LoadConfig Tests
// ============================================================================

func TestLoadConfig_FromEnv(t *testing.T) {
	// Save original values
	origGitHub := os.Getenv("GITHUB_TOKEN")
	origLinear := os.Getenv("LINEAR_API_KEY")
	defer func() {
		os.Setenv("GITHUB_TOKEN", origGitHub)
		os.Setenv("LINEAR_API_KEY", origLinear)
	}()

	// Set test values
	os.Setenv("GITHUB_TOKEN", "ghp_test_token")
	os.Setenv("LINEAR_API_KEY", "lin_test_key")

	config := LoadConfig()

	require.NotNil(t, config)
	require.Equal(t, "ghp_test_token", config.GitHubToken)
	require.Equal(t, "lin_test_key", config.LinearAPIKey)
}

func TestLoadConfig_Empty(t *testing.T) {
	// Save original values
	origGitHub := os.Getenv("GITHUB_TOKEN")
	origLinear := os.Getenv("LINEAR_API_KEY")
	defer func() {
		os.Setenv("GITHUB_TOKEN", origGitHub)
		os.Setenv("LINEAR_API_KEY", origLinear)
	}()

	// Clear env vars
	os.Unsetenv("GITHUB_TOKEN")
	os.Unsetenv("LINEAR_API_KEY")

	config := LoadConfig()

	require.NotNil(t, config)
	require.Empty(t, config.GitHubToken)
	require.Empty(t, config.LinearAPIKey)
}

func TestLoadConfig_GitHubOnly(t *testing.T) {
	// Save original values
	origGitHub := os.Getenv("GITHUB_TOKEN")
	origLinear := os.Getenv("LINEAR_API_KEY")
	defer func() {
		os.Setenv("GITHUB_TOKEN", origGitHub)
		os.Setenv("LINEAR_API_KEY", origLinear)
	}()

	os.Setenv("GITHUB_TOKEN", "ghp_only_token")
	os.Unsetenv("LINEAR_API_KEY")

	config := LoadConfig()

	require.Equal(t, "ghp_only_token", config.GitHubToken)
	require.Empty(t, config.LinearAPIKey)
}

func TestLoadConfig_LinearOnly(t *testing.T) {
	// Save original values
	origGitHub := os.Getenv("GITHUB_TOKEN")
	origLinear := os.Getenv("LINEAR_API_KEY")
	defer func() {
		os.Setenv("GITHUB_TOKEN", origGitHub)
		os.Setenv("LINEAR_API_KEY", origLinear)
	}()

	os.Unsetenv("GITHUB_TOKEN")
	os.Setenv("LINEAR_API_KEY", "lin_only_key")

	config := LoadConfig()

	require.Empty(t, config.GitHubToken)
	require.Equal(t, "lin_only_key", config.LinearAPIKey)
}

// ============================================================================
// HasGitHub Tests
// ============================================================================

func TestConfig_HasGitHub_True(t *testing.T) {
	config := &Config{
		GitHubToken: "ghp_some_token",
	}

	require.True(t, config.HasGitHub())
}

func TestConfig_HasGitHub_False_Empty(t *testing.T) {
	config := &Config{
		GitHubToken: "",
	}

	require.False(t, config.HasGitHub())
}

func TestConfig_HasGitHub_False_Nil(t *testing.T) {
	config := &Config{}

	require.False(t, config.HasGitHub())
}

// ============================================================================
// HasLinear Tests
// ============================================================================

func TestConfig_HasLinear_True(t *testing.T) {
	config := &Config{
		LinearAPIKey: "lin_some_key",
	}

	require.True(t, config.HasLinear())
}

func TestConfig_HasLinear_False_Empty(t *testing.T) {
	config := &Config{
		LinearAPIKey: "",
	}

	require.False(t, config.HasLinear())
}

func TestConfig_HasLinear_False_Nil(t *testing.T) {
	config := &Config{}

	require.False(t, config.HasLinear())
}

// ============================================================================
// Config Struct Tests
// ============================================================================

func TestConfig_StructFields(t *testing.T) {
	config := Config{
		GitHubToken:  "github-token",
		LinearAPIKey: "linear-key",
	}

	require.Equal(t, "github-token", config.GitHubToken)
	require.Equal(t, "linear-key", config.LinearAPIKey)
}

func TestConfig_BothConfigured(t *testing.T) {
	config := &Config{
		GitHubToken:  "ghp_token",
		LinearAPIKey: "lin_key",
	}

	require.True(t, config.HasGitHub())
	require.True(t, config.HasLinear())
}

func TestConfig_NeitherConfigured(t *testing.T) {
	config := &Config{}

	require.False(t, config.HasGitHub())
	require.False(t, config.HasLinear())
}
