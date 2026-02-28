package server

import (
	"os"
	"strconv"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

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

// Build-time variables (set via -ldflags)
// Example: go build -ldflags "-X github.com/chatml/chatml-backend/server.githubClientID=xxx"
var (
	githubClientID     string
	githubClientSecret string
	buildVersion       = "dev"
)

// LinearConfig holds Linear OAuth configuration
type LinearConfig struct {
	ClientID string
}

// Build-time variable for Linear OAuth (set via -ldflags)
var linearClientID string

// LoadLinearConfig loads Linear OAuth config.
// Priority: environment variables > build-time embedded values
func LoadLinearConfig() LinearConfig {
	clientID := os.Getenv("LINEAR_CLIENT_ID")
	if clientID == "" {
		clientID = linearClientID
	}
	return LinearConfig{ClientID: clientID}
}

// LoadGitHubConfig loads GitHub OAuth config.
// Priority: environment variables > build-time embedded values
func LoadGitHubConfig() GitHubConfig {
	clientID := os.Getenv("GITHUB_CLIENT_ID")
	if clientID == "" {
		clientID = githubClientID
	}

	clientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	if clientSecret == "" {
		clientSecret = githubClientSecret
	}

	return GitHubConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// FileSizeConfig holds file size limit configuration
type FileSizeConfig struct {
	MaxFileSizeBytes int64
}

// LoadFileSizeConfig loads file size config from environment variables.
// Default: 50MB if CHATML_MAX_FILE_SIZE_MB is not set.
func LoadFileSizeConfig() FileSizeConfig {
	maxSize := int64(50 * 1024 * 1024) // 50MB default
	if envSize := os.Getenv("CHATML_MAX_FILE_SIZE_MB"); envSize != "" {
		mb, err := strconv.ParseInt(envSize, 10, 64)
		if err != nil {
			logger.Config.Warnf("Invalid CHATML_MAX_FILE_SIZE_MB value %q (not a number), using default 50MB", envSize)
		} else if mb <= 0 {
			logger.Config.Warnf("Invalid CHATML_MAX_FILE_SIZE_MB value %d (must be positive), using default 50MB", mb)
		} else {
			maxSize = mb * 1024 * 1024
		}
	}
	return FileSizeConfig{MaxFileSizeBytes: maxSize}
}

// DirListingCacheConfig holds configuration for directory listing cache
type DirListingCacheConfig struct {
	TTL time.Duration
}

// LoadDirListingCacheConfig loads directory listing cache config from environment variables
func LoadDirListingCacheConfig() DirListingCacheConfig {
	ttl := 30 * time.Second // default
	if ttlStr := os.Getenv("CHATML_DIR_CACHE_TTL"); ttlStr != "" {
		if parsed, err := time.ParseDuration(ttlStr); err == nil && parsed > 0 {
			ttl = parsed
		}
	}
	return DirListingCacheConfig{TTL: ttl}
}
