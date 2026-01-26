package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsTransientDBError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
		{
			name:     "generic error",
			err:      errors.New("some random error"),
			expected: false,
		},
		{
			name:     "constraint error",
			err:      errors.New("UNIQUE constraint failed: sessions.id"),
			expected: false,
		},
		{
			name:     "database locked",
			err:      errors.New("database is locked"),
			expected: true,
		},
		{
			name:     "database locked uppercase",
			err:      errors.New("DATABASE IS LOCKED"),
			expected: true,
		},
		{
			name:     "database table locked",
			err:      errors.New("database table is locked"),
			expected: true,
		},
		{
			name:     "sqlite_busy",
			err:      errors.New("SQLITE_BUSY"),
			expected: true,
		},
		{
			name:     "sqlite_locked",
			err:      errors.New("SQLITE_LOCKED"),
			expected: true,
		},
		{
			name:     "wrapped database locked",
			err:      fmt.Errorf("AddSession: %w", errors.New("database is locked")),
			expected: true,
		},
		{
			name:     "deeply wrapped database locked",
			err:      fmt.Errorf("outer: %w", fmt.Errorf("inner: %w", errors.New("database is locked"))),
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsTransientDBError(tt.err)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCalculateBackoff(t *testing.T) {
	// Test without jitter for predictable results
	config := RetryConfig{
		BaseDelay: 100 * time.Millisecond,
		MaxDelay:  1 * time.Second,
		JitterPct: 0,
	}

	tests := []struct {
		attempt  int
		expected time.Duration
	}{
		{0, 100 * time.Millisecond},  // 100ms * 2^0 = 100ms
		{1, 200 * time.Millisecond},  // 100ms * 2^1 = 200ms
		{2, 400 * time.Millisecond},  // 100ms * 2^2 = 400ms
		{3, 800 * time.Millisecond},  // 100ms * 2^3 = 800ms
		{4, 1 * time.Second},         // Capped at MaxDelay
		{10, 1 * time.Second},        // Still capped
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("attempt_%d", tt.attempt), func(t *testing.T) {
			result := calculateBackoff(tt.attempt, config)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCalculateBackoff_WithJitter(t *testing.T) {
	config := RetryConfig{
		BaseDelay: 100 * time.Millisecond,
		MaxDelay:  1 * time.Second,
		JitterPct: 0.25,
	}

	// Run multiple times to verify jitter is being applied
	results := make(map[time.Duration]bool)
	for i := 0; i < 100; i++ {
		result := calculateBackoff(0, config)
		results[result] = true

		// Should be within 75ms to 125ms (100ms +/- 25%)
		assert.GreaterOrEqual(t, result, 75*time.Millisecond)
		assert.LessOrEqual(t, result, 125*time.Millisecond)
	}

	// With 100 iterations, we should see some variation
	assert.Greater(t, len(results), 1, "jitter should produce varying results")
}

func TestCalculateBackoff_NeverNegative(t *testing.T) {
	// Test with extreme jitter that could theoretically produce negative values
	config := RetryConfig{
		BaseDelay: 1 * time.Millisecond, // Very small base delay
		MaxDelay:  1 * time.Second,
		JitterPct: 0.99, // Nearly 100% jitter
	}

	// Run many times to catch edge cases
	for i := 0; i < 1000; i++ {
		result := calculateBackoff(0, config)
		assert.GreaterOrEqual(t, result, time.Duration(0), "delay should never be negative")
	}
}

func TestRetryDBOperation_SucceedsImmediately(t *testing.T) {
	ctx := context.Background()
	callCount := 0

	result, err := RetryDBOperation(ctx, "test", DefaultRetryConfig(), func(ctx context.Context) (string, error) {
		callCount++
		return "success", nil
	})

	require.NoError(t, err)
	assert.Equal(t, "success", result)
	assert.Equal(t, 1, callCount)
}

func TestRetryDBOperation_RetriesTransientError(t *testing.T) {
	ctx := context.Background()
	callCount := 0

	result, err := RetryDBOperation(ctx, "test", RetryConfig{
		MaxRetries: 3,
		BaseDelay:  1 * time.Millisecond, // Fast for tests
		MaxDelay:   10 * time.Millisecond,
		JitterPct:  0,
	}, func(ctx context.Context) (string, error) {
		callCount++
		if callCount < 3 {
			return "", errors.New("database is locked")
		}
		return "success", nil
	})

	require.NoError(t, err)
	assert.Equal(t, "success", result)
	assert.Equal(t, 3, callCount)
}

func TestRetryDBOperation_DoesNotRetryNonTransient(t *testing.T) {
	ctx := context.Background()
	callCount := 0

	_, err := RetryDBOperation(ctx, "test", DefaultRetryConfig(), func(ctx context.Context) (string, error) {
		callCount++
		return "", errors.New("UNIQUE constraint failed")
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "UNIQUE constraint failed")
	assert.Equal(t, 1, callCount) // No retries for constraint errors
}

func TestRetryDBOperation_RespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	callCount := 0

	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, err := RetryDBOperation(ctx, "test", RetryConfig{
		MaxRetries: 10,
		BaseDelay:  100 * time.Millisecond,
		MaxDelay:   1 * time.Second,
		JitterPct:  0,
	}, func(ctx context.Context) (string, error) {
		callCount++
		return "", errors.New("database is locked")
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "context cancelled")
	assert.Less(t, callCount, 10) // Should stop before max retries
}

func TestRetryDBOperation_ExhaustsRetries(t *testing.T) {
	ctx := context.Background()
	callCount := 0

	_, err := RetryDBOperation(ctx, "TestOp", RetryConfig{
		MaxRetries: 2,
		BaseDelay:  1 * time.Millisecond,
		MaxDelay:   10 * time.Millisecond,
		JitterPct:  0,
	}, func(ctx context.Context) (string, error) {
		callCount++
		return "", errors.New("database is locked")
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "max retries exceeded")
	assert.Contains(t, err.Error(), "TestOp")
	assert.Contains(t, err.Error(), "database is locked")
	assert.Equal(t, 3, callCount) // Initial + 2 retries
}

func TestRetryDBExec_SucceedsImmediately(t *testing.T) {
	ctx := context.Background()
	callCount := 0

	err := RetryDBExec(ctx, "test", DefaultRetryConfig(), func(ctx context.Context) error {
		callCount++
		return nil
	})

	require.NoError(t, err)
	assert.Equal(t, 1, callCount)
}

func TestRetryDBExec_RetriesAndSucceeds(t *testing.T) {
	ctx := context.Background()
	callCount := 0

	err := RetryDBExec(ctx, "test", RetryConfig{
		MaxRetries: 3,
		BaseDelay:  1 * time.Millisecond,
		MaxDelay:   10 * time.Millisecond,
		JitterPct:  0,
	}, func(ctx context.Context) error {
		callCount++
		if callCount < 2 {
			return errors.New("database is locked")
		}
		return nil
	})

	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
}

func TestRetryDBOperation_ContextAlreadyCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	callCount := 0
	_, err := RetryDBOperation(ctx, "test", DefaultRetryConfig(), func(ctx context.Context) (string, error) {
		callCount++
		return "success", nil
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "context cancelled")
	assert.Equal(t, 0, callCount) // Should never call operation
}

func TestDefaultRetryConfig(t *testing.T) {
	config := DefaultRetryConfig()

	assert.Equal(t, 5, config.MaxRetries)
	assert.Equal(t, 50*time.Millisecond, config.BaseDelay)
	assert.Equal(t, 2*time.Second, config.MaxDelay)
	assert.Equal(t, 0.25, config.JitterPct)
}
