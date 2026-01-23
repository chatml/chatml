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
// The /health endpoint is always allowed without authentication.
func TokenAuthMiddleware(next http.Handler) http.Handler {
	expectedToken := os.Getenv("CHATML_AUTH_TOKEN")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always allow health checks without authentication
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		// If no token configured, skip validation (dev mode without Tauri)
		if expectedToken == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Extract Bearer token from Authorization header
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		token := strings.TrimPrefix(auth, "Bearer ")

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
