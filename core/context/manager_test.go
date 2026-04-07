package context

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestNewManager(t *testing.T) {
	m := NewManager(200_000)
	assert.Equal(t, 200_000, m.ContextWindow())
	assert.Equal(t, 0, m.LastTokenCount())
	assert.Equal(t, 0, m.CompactFailures())
}

func TestManager_UpdateTokenCount(t *testing.T) {
	m := NewManager(200_000)
	m.UpdateTokenCount(50_000)
	assert.Equal(t, 50_000, m.LastTokenCount())
}

func TestManager_ShouldAutoCompact_BelowThreshold(t *testing.T) {
	m := NewManager(200_000)
	// Threshold = 200K - 20K - 13K = 167K
	assert.False(t, m.ShouldAutoCompact(100_000))
}

func TestManager_ShouldAutoCompact_AboveThreshold(t *testing.T) {
	m := NewManager(200_000)
	// Threshold = 200K - 20K - 13K = 167K
	assert.True(t, m.ShouldAutoCompact(170_000))
}

func TestManager_ShouldAutoCompact_CircuitBreaker(t *testing.T) {
	m := NewManager(200_000)

	// Trip the circuit breaker
	for i := 0; i < MaxCompactFailures; i++ {
		m.RecordCompactFailure()
	}

	// Even though tokens are high, circuit breaker prevents compaction
	assert.False(t, m.ShouldAutoCompact(190_000))
}

func TestManager_ShouldAutoCompact_CircuitBreakerReset(t *testing.T) {
	m := NewManager(200_000)

	for i := 0; i < MaxCompactFailures; i++ {
		m.RecordCompactFailure()
	}
	assert.False(t, m.ShouldAutoCompact(190_000))

	// Reset circuit breaker
	m.ResetCompactFailures()
	assert.True(t, m.ShouldAutoCompact(190_000))
}

func TestManager_ShouldMicrocompact(t *testing.T) {
	m := NewManager(200_000)
	m.lastCompactTime = time.Now().Add(-5 * time.Minute)

	// Not enough tool results (internal counter at 0)
	assert.False(t, m.ShouldMicrocompact(time.Minute))

	// Add enough tool results via IncrementToolResults
	m.IncrementToolResults(10)
	assert.True(t, m.ShouldMicrocompact(time.Minute))
}

func TestManager_ShouldMicrocompact_TooSoon(t *testing.T) {
	m := NewManager(200_000)
	// lastCompactTime is now (set in constructor)
	m.IncrementToolResults(100)

	// Even with many results, too soon since last compact
	assert.False(t, m.ShouldMicrocompact(5*time.Minute))
}

func TestManager_ShouldWarn(t *testing.T) {
	m := NewManager(200_000)
	// Warning = 200K - 20K = 180K
	assert.False(t, m.ShouldWarn(170_000))
	assert.True(t, m.ShouldWarn(185_000))
}

func TestManager_IsBlocked(t *testing.T) {
	m := NewManager(200_000)
	// Blocking = 200K - 3K = 197K
	assert.False(t, m.IsBlocked(195_000))
	assert.True(t, m.IsBlocked(198_000))
}

func TestManager_RecordCompaction(t *testing.T) {
	m := NewManager(200_000)
	m.microcompactCount = 50
	m.lastCompactTime = time.Now().Add(-10 * time.Minute)

	m.RecordCompaction()
	assert.Equal(t, 0, m.microcompactCount)
	assert.WithinDuration(t, time.Now(), m.lastCompactTime, time.Second)
}

func TestManager_IncrementToolResults(t *testing.T) {
	m := NewManager(200_000)
	m.IncrementToolResults(3)
	m.IncrementToolResults(2)
	assert.Equal(t, 5, m.microcompactCount)
}
