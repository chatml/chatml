package github

import (
	"errors"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// Per-host circuit breaker constants. Tuned for the GitHub API outage shape
// observed in the field: DNS goes down for tens of minutes, every retry
// budget on every dependent endpoint serializes against it, and the user's
// UI freezes for 6–14 seconds per panel. Tripping after a small number of
// consecutive failures cuts that to <50ms while the network heals.
const (
	circuitFailureThreshold = 3
	circuitFailureWindow    = 30 * time.Second
	circuitOpenDuration     = 30 * time.Second
)

// ErrCircuitOpen is returned by the GitHub client's transport when the
// per-host circuit breaker has tripped. Callers should treat this the same as
// any other transient transport failure (e.g. fall back to cached values).
var ErrCircuitOpen = errors.New("github: circuit breaker open")

// circuitBreaker tracks per-host failure state so a sustained outage on one
// host (api.github.com) does not pay the retry budget on every request.
// State is keyed by URL host because the OAuth host (github.com) and the
// API host (api.github.com) can fail independently.
type circuitBreaker struct {
	now    func() time.Time // overridable for tests
	states sync.Map         // host (string) -> *circuitState
}

// newCircuitBreaker constructs a closed breaker with real-clock time.
func newCircuitBreaker() *circuitBreaker {
	return &circuitBreaker{now: time.Now}
}

func (cb *circuitBreaker) state(host string) *circuitState {
	if v, ok := cb.states.Load(host); ok {
		return v.(*circuitState)
	}
	s := &circuitState{}
	actual, _ := cb.states.LoadOrStore(host, s)
	return actual.(*circuitState)
}

// allow reports whether a request to host should proceed.
// Returns false while the breaker is open for this host.
func (cb *circuitBreaker) allow(host string) bool {
	s := cb.state(host)
	now := cb.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	return now.After(s.openedUntil)
}

// recordFailure increments the consecutive-failure counter for host. When the
// count reaches circuitFailureThreshold within circuitFailureWindow the
// breaker opens for circuitOpenDuration. If the previous failure is older
// than the window, the counter restarts so transient blips don't
// accumulate over hours into a trip.
func (cb *circuitBreaker) recordFailure(host string) {
	s := cb.state(host)
	now := cb.now()
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.firstFailureAt.IsZero() && now.Sub(s.firstFailureAt) > circuitFailureWindow {
		s.consecutiveFails = 0
		s.firstFailureAt = time.Time{}
	}

	s.consecutiveFails++
	if s.firstFailureAt.IsZero() {
		s.firstFailureAt = now
	}

	if s.consecutiveFails >= circuitFailureThreshold {
		s.openedUntil = now.Add(circuitOpenDuration)
		// Reset the counter so the next single success closes the breaker
		// cleanly without leaving stale failure history behind.
		s.consecutiveFails = 0
		s.firstFailureAt = time.Time{}
		logger.GitHub.Warnf("circuit breaker open for %s (cool-down %v)", host, circuitOpenDuration)
	}
}

// recordSuccess clears all failure state for host. Called after any
// successful round-trip (any HTTP response counts — even 5xx), since the
// failure mode the breaker exists to suppress is "host is unreachable",
// not "host returned an error".
func (cb *circuitBreaker) recordSuccess(host string) {
	s := cb.state(host)
	s.mu.Lock()
	s.consecutiveFails = 0
	s.firstFailureAt = time.Time{}
	s.openedUntil = time.Time{}
	s.mu.Unlock()
}

type circuitState struct {
	mu               sync.Mutex
	consecutiveFails int
	firstFailureAt   time.Time
	openedUntil      time.Time
}
