package server

import (
	"log"
	"os"
	"strconv"
	"time"
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

// LoadGitHubConfig loads GitHub OAuth config from environment variables
func LoadGitHubConfig() GitHubConfig {
	return GitHubConfig{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
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
			log.Printf("[config] Warning: invalid CHATML_MAX_FILE_SIZE_MB value %q (not a number), using default 50MB", envSize)
		} else if mb <= 0 {
			log.Printf("[config] Warning: invalid CHATML_MAX_FILE_SIZE_MB value %d (must be positive), using default 50MB", mb)
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
