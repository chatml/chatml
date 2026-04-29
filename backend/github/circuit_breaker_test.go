package github

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCircuitBreaker_AllowsInitially(t *testing.T) {
	cb := newCircuitBreaker()
	assert.True(t, cb.allow("api.github.com"))
}

func TestCircuitBreaker_OpensAfterThresholdConsecutiveFailures(t *testing.T) {
	cb := newCircuitBreaker()

	for i := 0; i < circuitFailureThreshold; i++ {
		cb.recordFailure("api.github.com")
	}

	assert.False(t, cb.allow("api.github.com"), "breaker should be open after threshold failures")
}

func TestCircuitBreaker_PerHostIsolation(t *testing.T) {
	// A failing host must not open the circuit for an unrelated host.
	cb := newCircuitBreaker()

	for i := 0; i < circuitFailureThreshold; i++ {
		cb.recordFailure("api.github.com")
	}

	assert.False(t, cb.allow("api.github.com"))
	assert.True(t, cb.allow("github.com"), "unrelated host should remain closed")
}

func TestCircuitBreaker_SuccessResetsFailureCount(t *testing.T) {
	cb := newCircuitBreaker()

	cb.recordFailure("api.github.com")
	cb.recordFailure("api.github.com")
	cb.recordSuccess("api.github.com")
	cb.recordFailure("api.github.com")
	cb.recordFailure("api.github.com")

	// Two failures since the success — should still be closed (need 3 consecutive).
	assert.True(t, cb.allow("api.github.com"))
}

func TestCircuitBreaker_ClosesAfterCooldown(t *testing.T) {
	// Use a controllable clock so the test doesn't depend on wall time.
	now := time.Now()
	cb := newCircuitBreaker()
	cb.now = func() time.Time { return now }

	for i := 0; i < circuitFailureThreshold; i++ {
		cb.recordFailure("api.github.com")
	}
	require.False(t, cb.allow("api.github.com"))

	// Advance past the cooldown window.
	now = now.Add(circuitOpenDuration + time.Second)
	assert.True(t, cb.allow("api.github.com"), "breaker should close after cooldown")
}

func TestCircuitBreaker_FailureWindowResets(t *testing.T) {
	// Failures spread out over more than the failure window must not
	// accumulate into a trip — the breaker only protects against bursts.
	now := time.Now()
	cb := newCircuitBreaker()
	cb.now = func() time.Time { return now }

	cb.recordFailure("api.github.com")
	now = now.Add(circuitFailureWindow + time.Second)
	cb.recordFailure("api.github.com")
	cb.recordFailure("api.github.com")

	// Only the last two failures are within the window — below threshold.
	assert.True(t, cb.allow("api.github.com"))
}

// failingTransport always returns the configured error. Used to drive the
// retryTransport's circuit-breaker integration without real network.
type failingTransport struct {
	calls atomic.Int32
	err   error
}

func (f *failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	f.calls.Add(1)
	return nil, f.err
}

func TestRetryTransport_CircuitBreakerShortCircuitsAfterThresholdFailures(t *testing.T) {
	// Drive the breaker through the public RoundTrip API to verify the wiring.
	// Each RoundTrip records one outcome regardless of how many internal
	// retries it ran, so threshold round-trips trip the breaker.
	failing := &failingTransport{err: errors.New("dial tcp: lookup api.github.com: no such host")}
	rt := &retryTransport{
		base:       failing,
		maxRetries: 0, // skip retries to keep the test fast
		baseDelay:  1 * time.Millisecond,
		breaker:    newCircuitBreaker(),
	}

	req, _ := http.NewRequestWithContext(context.Background(), "GET", "https://api.github.com/x", nil)

	// Trip the breaker.
	for i := 0; i < circuitFailureThreshold; i++ {
		_, err := rt.RoundTrip(req)
		require.Error(t, err)
	}

	beforeCalls := failing.calls.Load()
	_, err := rt.RoundTrip(req)
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrCircuitOpen), "breaker should short-circuit with ErrCircuitOpen, got %v", err)
	assert.Equal(t, beforeCalls, failing.calls.Load(), "breaker-open path must not invoke the underlying transport")
}

func TestRetryTransport_CircuitBreakerDoesNotCountContextCancellation(t *testing.T) {
	// Context cancel/deadline reflect the caller's lifecycle, not host health.
	// They must not move the breaker toward open.
	failing := &failingTransport{err: context.Canceled}
	rt := &retryTransport{
		base:       failing,
		maxRetries: 0,
		baseDelay:  1 * time.Millisecond,
		breaker:    newCircuitBreaker(),
	}

	req, _ := http.NewRequestWithContext(context.Background(), "GET", "https://api.github.com/x", nil)

	for i := 0; i < circuitFailureThreshold+2; i++ {
		_, _ = rt.RoundTrip(req)
	}
	assert.True(t, rt.breaker.allow("api.github.com"), "context cancellations must not trip the breaker")
}
