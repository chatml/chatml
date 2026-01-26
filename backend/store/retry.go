package store

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// RetryConfig holds configuration for database operation retries
type RetryConfig struct {
	MaxRetries int           // Maximum number of retry attempts (default: 5)
	BaseDelay  time.Duration // Initial delay between retries (default: 50ms)
	MaxDelay   time.Duration // Maximum delay between retries (default: 2s)
	JitterPct  float64       // Jitter percentage (0.0-1.0, default: 0.25)
}

// DefaultRetryConfig returns the default retry configuration
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries: 5,
		BaseDelay:  50 * time.Millisecond,
		MaxDelay:   2 * time.Second,
		JitterPct:  0.25,
	}
}

// IsTransientDBError checks if an error is a transient SQLite error that may succeed on retry.
// It detects SQLITE_BUSY (database locked) and similar transient conditions.
func IsTransientDBError(err error) bool {
	if err == nil {
		return false
	}

	// String-based detection for transient errors
	// This works reliably with wrapped errors and different SQLite drivers
	errStr := strings.ToLower(err.Error())
	transientPatterns := []string{
		"database is locked",
		"database table is locked",
		"sqlite_busy",
		"sqlite_locked",
	}
	for _, pattern := range transientPatterns {
		if strings.Contains(errStr, pattern) {
			return true
		}
	}

	return false
}

// RetryDBOperation executes a database operation with retry logic for transient errors.
// The operation function should be idempotent for writes.
func RetryDBOperation[T any](
	ctx context.Context,
	opName string,
	config RetryConfig,
	operation func(context.Context) (T, error),
) (T, error) {
	var result T
	var lastErr error

	totalAttempts := config.MaxRetries + 1

	for attempt := 0; attempt < totalAttempts; attempt++ {
		// Check context before attempting
		if ctx.Err() != nil {
			return result, fmt.Errorf("%s: context cancelled: %w", opName, ctx.Err())
		}

		result, lastErr = operation(ctx)
		if lastErr == nil {
			return result, nil
		}

		if !IsTransientDBError(lastErr) {
			// Non-transient error, don't retry
			return result, lastErr
		}

		if attempt < config.MaxRetries {
			delay := calculateBackoff(attempt, config)
			logger.DBRetry.Warnf("%s: transient error (attempt %d/%d), retrying in %v: %v",
				opName, attempt+1, totalAttempts, delay, lastErr)

			select {
			case <-time.After(delay):
				// Continue to next attempt
			case <-ctx.Done():
				return result, fmt.Errorf("%s: context cancelled during retry: %w", opName, ctx.Err())
			}
		}
	}

	return result, fmt.Errorf("%s: max retries exceeded: %w", opName, lastErr)
}

// RetryDBExec is a convenience wrapper for operations that don't return a value
func RetryDBExec(
	ctx context.Context,
	opName string,
	config RetryConfig,
	operation func(context.Context) error,
) error {
	_, err := RetryDBOperation(ctx, opName, config, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, operation(ctx)
	})
	return err
}

// calculateBackoff returns the delay for the given attempt with exponential backoff and jitter
func calculateBackoff(attempt int, config RetryConfig) time.Duration {
	// Exponential backoff: baseDelay * 2^attempt
	delay := float64(config.BaseDelay) * math.Pow(2, float64(attempt))

	// Cap at max delay
	if delay > float64(config.MaxDelay) {
		delay = float64(config.MaxDelay)
	}

	// Add jitter: +/- JitterPct
	if config.JitterPct > 0 {
		jitter := delay * config.JitterPct * (2*rand.Float64() - 1) // Range: -JitterPct to +JitterPct
		delay += jitter
	}

	// Ensure delay is never negative
	if delay < 0 {
		delay = 0
	}

	return time.Duration(delay)
}
