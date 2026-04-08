package server

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// requestIDCtxKey is a distinct type for request ID context keys.
// logger/context.go defines its own contextKey type — using a separate type
// here ensures the two packages' keys can never collide.
type requestIDCtxKey string

const requestIDKey requestIDCtxKey = "request_id"

// RequestIDMiddleware generates a unique request ID for each request,
// stores it in the context, and sets it as a response header.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Use incoming header if present (e.g., from a load balancer)
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.New().String()[:8]
		}

		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext extracts the request ID from the context.
// Returns empty string if not set.
// RequestIDFromContext extracts the request ID from the context.
// Returns empty string if not set.
func RequestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}
