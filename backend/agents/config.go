package agents

import (
	"os"
)

// Config holds configuration for polling adapters
type Config struct {
	// GitHub configuration
	GitHubToken string

	// Linear configuration
	LinearAPIKey string
}

// LoadConfig loads configuration from environment variables
func LoadConfig() *Config {
	return &Config{
		GitHubToken:  os.Getenv("GITHUB_TOKEN"),
		LinearAPIKey: os.Getenv("LINEAR_API_KEY"),
	}
}

// HasGitHub returns true if GitHub is configured
func (c *Config) HasGitHub() bool {
	return c.GitHubToken != ""
}

// HasLinear returns true if Linear is configured
func (c *Config) HasLinear() bool {
	return c.LinearAPIKey != ""
}
