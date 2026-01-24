package server

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
)

// TokenAuthMiddleware validates the authentication token from Tauri.
// If CHATML_AUTH_TOKEN is not set (dev mode), all requests are allowed.
// Otherwise, requests must include a valid Bearer token in the Authorization header.
// Certain paths are always allowed without authentication:
// - /health (health checks)
// - /api/auth/* (OAuth flow endpoints - they have their own auth via GitHub tokens)
func TokenAuthMiddleware(next http.Handler) http.Handler {
	expectedToken := os.Getenv("CHATML_AUTH_TOKEN")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always allow health checks without authentication
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		// Allow auth endpoints without internal token (OAuth has its own auth)
		if strings.HasPrefix(r.URL.Path, "/api/auth/") {
			next.ServeHTTP(w, r)
			return
		}

		// If no token configured, skip validation (dev mode without Tauri)
		if expectedToken == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Extract token from Authorization header or query parameter (for WebSocket)
		var token string
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		} else if queryToken := r.URL.Query().Get("token"); queryToken != "" {
			// WebSocket connections pass token via query parameter
			token = queryToken
		}

		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
