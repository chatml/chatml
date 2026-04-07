package context

import (
	"sync"
	"time"

	"github.com/chatml/chatml-core/provider"
)

// Threshold constants matching Claude Code's autoCompact.ts.
const (
	AutoCompactBufferTokens  = 13_000
	WarningThresholdTokens   = 20_000
	MaxOutputForSummary      = 20_000
	BlockingLimitBuffer      = 3_000
	MaxCompactFailures       = 3
)

// Manager tracks context window usage and determines when compaction is needed.
// All exported methods are goroutine-safe.
type Manager struct {
	mu                sync.Mutex
	contextWindow     int             // Total context window size for the model (immutable after creation)
	lastCompactTime   time.Time       // When the last compaction (micro or auto) occurred
	compactFailures   int             // Consecutive auto-compact failures (circuit breaker)
	lastTokenCount    int             // Last known token count from API usage
	microcompactCount int             // Number of tool results since last microcompact
	lastUsage         *provider.Usage // Last full API usage data (authoritative)
}

// NewManager creates a context manager for the given model's context window size.
func NewManager(contextWindow int) *Manager {
	return &Manager{
		contextWindow:   contextWindow,
		lastCompactTime: time.Now(),
	}
}

// ContextWindow returns the total context window size.
func (m *Manager) ContextWindow() int {
	return m.contextWindow
}

// UpdateTokenCount records the latest token count from API usage.
func (m *Manager) UpdateTokenCount(tokens int) {
	m.mu.Lock()
	m.lastTokenCount = tokens
	m.mu.Unlock()
}

// UpdateFromUsage records the full API usage data and updates the token count
// from the authoritative provider response (instead of heuristic estimation).
func (m *Manager) UpdateFromUsage(usage *provider.Usage) {
	if usage == nil {
		return
	}
	m.mu.Lock()
	m.lastUsage = usage
	m.lastTokenCount = ContextTokensFromUsage(usage)
	m.mu.Unlock()
}

// LastUsage returns a copy of the last full API usage data.
// Returns nil if no usage has been recorded yet.
func (m *Manager) LastUsage() *provider.Usage {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastUsage == nil {
		return nil
	}
	u := *m.lastUsage
	return &u
}

// LastTokenCount returns the last recorded token count.
func (m *Manager) LastTokenCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastTokenCount
}

// IncrementToolResults tracks tool result count for microcompact triggering.
func (m *Manager) IncrementToolResults(count int) {
	m.mu.Lock()
	m.microcompactCount += count
	m.mu.Unlock()
}

// autoCompactThreshold returns the token count that triggers auto-compaction.
// = contextWindow - maxOutputForSummary - buffer
func (m *Manager) autoCompactThreshold() int {
	return m.contextWindow - MaxOutputForSummary - AutoCompactBufferTokens
}

// warningThreshold returns the token count for context warning.
func (m *Manager) warningThreshold() int {
	return m.contextWindow - WarningThresholdTokens
}

// blockingLimit returns the token count where new input should be blocked.
func (m *Manager) blockingLimit() int {
	return m.contextWindow - BlockingLimitBuffer
}

// ShouldAutoCompact returns true if the current token count exceeds the
// auto-compact threshold AND the circuit breaker hasn't tripped.
func (m *Manager) ShouldAutoCompact(currentTokens int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.compactFailures >= MaxCompactFailures {
		return false // Circuit breaker tripped
	}
	return currentTokens >= m.autoCompactThreshold()
}

// ShouldMicrocompact returns true if enough tool results have accumulated
// or enough time has passed since the last compaction.
func (m *Manager) ShouldMicrocompact(minInterval time.Duration) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.microcompactCount < 5 {
		return false
	}
	return time.Since(m.lastCompactTime) >= minInterval
}

// ShouldWarn returns true if the context is approaching the limit.
func (m *Manager) ShouldWarn(currentTokens int) bool {
	// No lock needed — reads immutable contextWindow only via warningThreshold()
	return currentTokens >= m.warningThreshold()
}

// IsBlocked returns true if the context window is effectively full.
func (m *Manager) IsBlocked(currentTokens int) bool {
	// No lock needed — reads immutable contextWindow only via blockingLimit()
	return currentTokens >= m.blockingLimit()
}

// RecordCompaction records that a compaction (micro or auto) just occurred.
func (m *Manager) RecordCompaction() {
	m.mu.Lock()
	m.lastCompactTime = time.Now()
	m.microcompactCount = 0
	m.mu.Unlock()
}

// RecordCompactFailure increments the circuit breaker failure count.
func (m *Manager) RecordCompactFailure() {
	m.mu.Lock()
	m.compactFailures++
	m.mu.Unlock()
}

// ResetCompactFailures clears the circuit breaker.
func (m *Manager) ResetCompactFailures() {
	m.mu.Lock()
	m.compactFailures = 0
	m.mu.Unlock()
}

// CompactFailures returns the current failure count.
func (m *Manager) CompactFailures() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.compactFailures
}
