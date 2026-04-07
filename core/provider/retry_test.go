package provider

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fastRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 1 * time.Millisecond,
		MaxBackoff:     10 * time.Millisecond,
		JitterFraction: 0,
	}
}

func TestWithRetry_SucceedsFirstAttempt(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		return nil
	})
	assert.NoError(t, err)
	assert.Equal(t, 1, calls)
}

func TestWithRetry_SucceedsAfterRetries(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		if calls < 3 {
			return &APIError{StatusCode: 429, Message: "rate limited"}
		}
		return nil
	})
	assert.NoError(t, err)
	assert.Equal(t, 3, calls)
}

func TestWithRetry_ExhaustsRetries(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		return &APIError{StatusCode: 529, Message: "overloaded"}
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "max retries")
	assert.Equal(t, 4, calls) // 1 initial + 3 retries
}

func TestWithRetry_NonRetryableError(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		return &APIError{StatusCode: 400, Message: "bad request"}
	})
	assert.Error(t, err)
	assert.Equal(t, 1, calls) // No retries for 400
	assert.Contains(t, err.Error(), "bad request")
}

func TestWithRetry_401NotRetried(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		return &APIError{StatusCode: 401, Message: "unauthorized"}
	})
	assert.Error(t, err)
	assert.Equal(t, 1, calls)
}

func TestWithRetry_NetworkErrorRetried(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		if calls < 2 {
			return fmt.Errorf("connection reset by peer")
		}
		return nil
	})
	assert.NoError(t, err)
	assert.Equal(t, 2, calls)
}

func TestWithRetry_UnknownErrorNotRetried(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		return fmt.Errorf("some unknown error")
	})
	assert.Error(t, err)
	assert.Equal(t, 1, calls)
}

func TestWithRetry_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0

	// Cancel after first call
	err := WithRetry(ctx, RetryConfig{
		MaxRetries:     10,
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     1 * time.Second,
	}, func() error {
		calls++
		if calls == 1 {
			cancel()
		}
		return &APIError{StatusCode: 429, Message: "rate limited"}
	})

	assert.Error(t, err)
	assert.Equal(t, context.Canceled, err)
	assert.Equal(t, 1, calls)
}

func TestWithRetry_RetryAfterRespected(t *testing.T) {
	cfg := RetryConfig{
		MaxRetries:     2,
		InitialBackoff: 1 * time.Millisecond,
		MaxBackoff:     50 * time.Millisecond,
	}

	calls := 0
	start := time.Now()
	err := WithRetry(context.Background(), cfg, func() error {
		calls++
		if calls == 1 {
			return &APIError{StatusCode: 429, Message: "rate limited", RetryAfter: 20 * time.Millisecond}
		}
		return nil
	})

	elapsed := time.Since(start)
	assert.NoError(t, err)
	assert.Equal(t, 2, calls)
	assert.GreaterOrEqual(t, elapsed, 15*time.Millisecond) // Allow some timing slack
}

func TestWithRetry_502Retried(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastRetryConfig(), func() error {
		calls++
		if calls < 2 {
			return &APIError{StatusCode: 502, Message: "bad gateway"}
		}
		return nil
	})
	assert.NoError(t, err)
	assert.Equal(t, 2, calls)
}

func TestWithRetry_DefaultConfig(t *testing.T) {
	// Passing zero config should use defaults
	calls := 0
	err := WithRetry(context.Background(), RetryConfig{}, func() error {
		calls++
		return nil
	})
	assert.NoError(t, err)
	assert.Equal(t, 1, calls)
}

// --- APIError tests ---

func TestAPIError_IsRetryable(t *testing.T) {
	tests := []struct {
		code     int
		expected bool
	}{
		{429, true},
		{529, true},
		{502, true},
		{503, true},
		{504, true},
		{400, false},
		{401, false},
		{403, false},
		{404, false},
		{500, false},
	}

	for _, tt := range tests {
		err := &APIError{StatusCode: tt.code}
		assert.Equal(t, tt.expected, err.IsRetryable(), "status %d", tt.code)
	}
}

func TestAPIError_Error(t *testing.T) {
	err := &APIError{StatusCode: 429, Message: "rate limited"}
	assert.Equal(t, "API error 429: rate limited", err.Error())
}

// --- isNetworkError tests ---

func TestIsNetworkError(t *testing.T) {
	assert.True(t, isNetworkError(fmt.Errorf("connection reset by peer")))
	assert.True(t, isNetworkError(fmt.Errorf("write: broken pipe")))
	assert.True(t, isNetworkError(fmt.Errorf("ECONNRESET")))
	assert.True(t, isNetworkError(fmt.Errorf("unexpected EOF")))
	assert.True(t, isNetworkError(fmt.Errorf("connection refused")))
	assert.False(t, isNetworkError(fmt.Errorf("invalid json")))
	assert.False(t, isNetworkError(nil))
}

func TestIsNetworkError_NetTimeout(t *testing.T) {
	err := &net.DNSError{IsTimeout: true}
	assert.True(t, isNetworkError(err))
}

// --- ParseRetryAfter tests ---

func TestParseRetryAfter_Seconds(t *testing.T) {
	assert.Equal(t, 5*time.Second, ParseRetryAfter("5"))
	assert.Equal(t, time.Duration(1500*time.Millisecond), ParseRetryAfter("1.5"))
}

func TestParseRetryAfter_Empty(t *testing.T) {
	assert.Equal(t, time.Duration(0), ParseRetryAfter(""))
}

func TestParseRetryAfter_Invalid(t *testing.T) {
	assert.Equal(t, time.Duration(0), ParseRetryAfter("not-a-number"))
}

// --- calculateBackoff tests ---

func TestCalculateBackoff_Exponential(t *testing.T) {
	cfg := RetryConfig{
		InitialBackoff: 1 * time.Second,
		JitterFraction: 0, // No jitter for deterministic test
	}

	assert.Equal(t, 1*time.Second, calculateBackoff(0, cfg))
	assert.Equal(t, 2*time.Second, calculateBackoff(1, cfg))
	assert.Equal(t, 4*time.Second, calculateBackoff(2, cfg))
	assert.Equal(t, 8*time.Second, calculateBackoff(3, cfg))
}

func TestCalculateBackoff_WithJitter(t *testing.T) {
	cfg := RetryConfig{
		InitialBackoff: 1 * time.Second,
		JitterFraction: 0.5,
	}

	// With jitter, backoff should vary but be in a reasonable range
	backoff := calculateBackoff(0, cfg)
	require.Greater(t, backoff, time.Duration(0))
	// 1s ± 50% = 500ms to 1500ms
	assert.InDelta(t, float64(1*time.Second), float64(backoff), float64(600*time.Millisecond))
}
