package provider

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net"
	"strconv"
	"strings"
	"time"
)

// RetryConfig controls retry behavior for API calls.
// A zero-value config (all fields zero) is replaced with DefaultRetryConfig().
// To explicitly disable retries, set MaxRetries to -1 (not 0, since 0 is the zero value).
type RetryConfig struct {
	MaxRetries     int           // Max retry attempts; 0=use defaults, -1=no retries, >0=that many retries
	InitialBackoff time.Duration // Starting backoff duration (default 1s)
	MaxBackoff     time.Duration // Maximum backoff duration (default 60s)
	JitterFraction float64       // Random jitter fraction 0-1 (default 0.1)
	OnAuthError    func() error  // Called on 401/403 to refresh tokens before retry (optional)
	QuerySource    string        // "foreground" (default) or "background" — background skips 529 retry
}

// DefaultRetryConfig returns sensible defaults matching Claude Code's withRetry.ts.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     10,
		InitialBackoff: 1 * time.Second,
		MaxBackoff:     60 * time.Second,
		JitterFraction: 0.1,
	}
}

// APIError represents an HTTP error from an LLM API.
type APIError struct {
	StatusCode int
	Message    string
	RetryAfter time.Duration // From Retry-After header, 0 if not present
}

func (e *APIError) Error() string {
	return fmt.Sprintf("API error %d: %s", e.StatusCode, e.Message)
}

// IsRetryable returns whether this error should be retried.
func (e *APIError) IsRetryable() bool {
	switch e.StatusCode {
	case 408: // Request timeout
		return true
	case 409: // Lock timeout / conflict
		return true
	case 429: // Rate limited
		return true
	case 529: // Overloaded
		return true
	case 502, 503, 504: // Gateway errors
		return true
	default:
		return false
	}
}

// isNetworkError checks for transient network errors (ECONNRESET, EPIPE, etc.)
func isNetworkError(err error) bool {
	if err == nil {
		return false
	}

	// Check for net.Error (timeouts, connection resets)
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return true
	}

	// Check for unexpected EOF (mid-stream connection drop).
	// Plain io.EOF is a normal end-of-stream and should NOT be retried.
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}

	// Check error message for common transient patterns
	msg := err.Error()
	return strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "ECONNRESET") ||
		strings.Contains(msg, "EPIPE") ||
		strings.Contains(msg, "unexpected EOF") || // string fallback for wrapped errors
		strings.Contains(msg, "connection refused")
}

// WithRetry wraps a function with retry logic using exponential backoff.
// The function fn should return an error; if the error is an *APIError with
// a retryable status code, or a transient network error, the call is retried.
func WithRetry(ctx context.Context, cfg RetryConfig, fn func() error) error {
	// Default when the entire config is zero-valued.
	// MaxRetries: 0=use defaults, -1=no retries, >0=explicit retry count.
	if cfg.MaxRetries == 0 && cfg.InitialBackoff == 0 && cfg.MaxBackoff == 0 {
		cfg = DefaultRetryConfig()
	}
	if cfg.MaxRetries < 0 {
		cfg.MaxRetries = 0 // -1 → single attempt (loop runs 0..0)
	}

	var lastErr error
	authRefreshed := false // Track whether OnAuthError was already called (at most once)
	for attempt := 0; attempt <= cfg.MaxRetries; attempt++ {
		lastErr = fn()
		if lastErr == nil {
			return nil
		}

		// Check if we should retry
		shouldRetry := false
		var backoff time.Duration

		if apiErr, ok := lastErr.(*APIError); ok {
			// 529 stratification: background sources fail immediately on overload
			// to prevent retry amplification during capacity outages
			if apiErr.StatusCode == 529 && cfg.QuerySource == "background" {
				return lastErr
			}

			// Auth errors: try token refresh once before giving up.
			// Only refresh once per WithRetry invocation to avoid hammering
			// the auth server with rapid refresh calls on persistent 401/403.
			if (apiErr.StatusCode == 401 || apiErr.StatusCode == 403) && cfg.OnAuthError != nil && !authRefreshed {
				if refreshErr := cfg.OnAuthError(); refreshErr == nil {
					authRefreshed = true
					shouldRetry = true // Token refreshed — retry
					backoff = 0        // Retry immediately after successful auth refresh
				} else {
					return lastErr // Refresh failed — give up
				}
			} else if apiErr.StatusCode == 401 || apiErr.StatusCode == 403 {
				return lastErr // Already refreshed once — token is invalid
			} else if !apiErr.IsRetryable() {
				return lastErr // Non-retryable API error
			} else {
				shouldRetry = true
			}

			// Use Retry-After if provided
			if apiErr.RetryAfter > 0 {
				backoff = apiErr.RetryAfter
			}
		} else if isNetworkError(lastErr) {
			shouldRetry = true
		}

		if !shouldRetry {
			return lastErr // Unknown error type — don't retry
		}

		// Don't sleep after the last attempt
		if attempt == cfg.MaxRetries {
			break
		}

		// Calculate backoff if not set by Retry-After
		if backoff == 0 {
			backoff = calculateBackoff(attempt, cfg)
		}

		// Cap at max backoff
		if backoff > cfg.MaxBackoff {
			backoff = cfg.MaxBackoff
		}

		// Wait with context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
			// Continue to next attempt
		}
	}

	return fmt.Errorf("max retries (%d) exceeded: %w", cfg.MaxRetries, lastErr)
}

// calculateBackoff returns exponential backoff with jitter.
// Uses math/rand (not crypto/rand) for jitter — this is intentional since
// the goal is just to spread retries, not provide cryptographic randomness.
// In Go 1.20+, math/rand functions use a per-goroutine source automatically.
func calculateBackoff(attempt int, cfg RetryConfig) time.Duration {
	// Exponential: initialBackoff * 2^attempt
	backoff := float64(cfg.InitialBackoff) * math.Pow(2, float64(attempt))

	// Add jitter
	if cfg.JitterFraction > 0 {
		jitter := backoff * cfg.JitterFraction * (rand.Float64()*2 - 1) // ±jitter
		backoff += jitter
	}

	if backoff < 0 {
		backoff = float64(cfg.InitialBackoff)
	}

	return time.Duration(backoff)
}

// ParseRetryAfter parses a Retry-After header value into a duration.
// Supports both seconds (integer) and HTTP-date formats.
func ParseRetryAfter(value string) time.Duration {
	if value == "" {
		return 0
	}

	// Try parsing as seconds
	if seconds, err := strconv.ParseFloat(value, 64); err == nil {
		return time.Duration(seconds * float64(time.Second))
	}

	// Try parsing as HTTP-date
	if t, err := time.Parse(time.RFC1123, value); err == nil {
		d := time.Until(t)
		if d > 0 {
			return d
		}
	}

	return 0
}
