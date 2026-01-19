package server

// AllowedOrigins defines the allowed origins for CORS and WebSocket connections.
// These must be kept in sync to prevent security misconfigurations.
var AllowedOrigins = []string{
	"tauri://localhost",
	"https://tauri.localhost",
	"http://localhost:3000", // Dev only - consider removing in production builds
}

// AllowedOriginsMap provides O(1) lookup for WebSocket origin validation.
var AllowedOriginsMap = func() map[string]bool {
	m := make(map[string]bool, len(AllowedOrigins))
	for _, origin := range AllowedOrigins {
		m[origin] = true
	}
	return m
}()
