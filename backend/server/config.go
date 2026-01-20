package server

import "os"

// AllowedOrigins defines the allowed origins for CORS and WebSocket connections.
// These must be kept in sync to prevent security misconfigurations.
// Additional dev origins can be added via CHATML_DEV_ORIGINS environment variable.
var AllowedOrigins = func() []string {
	origins := []string{
		"tauri://localhost",
		"https://tauri.localhost",
	}
	// Add dev origin if specified via environment variable
	if devOrigin := os.Getenv("CHATML_DEV_ORIGIN"); devOrigin != "" {
		origins = append(origins, devOrigin)
	}
	return origins
}()

// AllowedOriginsMap provides O(1) lookup for WebSocket origin validation.
var AllowedOriginsMap = func() map[string]bool {
	m := make(map[string]bool, len(AllowedOrigins))
	for _, origin := range AllowedOrigins {
		m[origin] = true
	}
	return m
}()

// GitHubConfig holds GitHub OAuth configuration
type GitHubConfig struct {
	ClientID     string
	ClientSecret string
}

// LoadGitHubConfig loads GitHub OAuth config from environment variables
func LoadGitHubConfig() GitHubConfig {
	return GitHubConfig{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
	}
}
