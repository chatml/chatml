package provider

import (
	"crypto/sha256"
	"fmt"
	"log"
	"sync"
)

// CacheBreakDetector monitors system prompt changes that would invalidate
// Anthropic's prompt caching. Warns when the system prompt changes between turns.
type CacheBreakDetector struct {
	mu           sync.Mutex
	lastHash     string
	breakCount   int
	turnCount    int
	notifyFn     func(msg string) // Optional callback for warnings
}

// NewCacheBreakDetector creates a new detector.
func NewCacheBreakDetector(notifyFn func(string)) *CacheBreakDetector {
	return &CacheBreakDetector{notifyFn: notifyFn}
}

// CheckSystemPrompt records the current system prompt hash and detects breaks.
// Should be called at the start of each API turn.
func (d *CacheBreakDetector) CheckSystemPrompt(systemPrompt string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.turnCount++
	currentHash := hashString(systemPrompt)

	if d.lastHash != "" && d.lastHash != currentHash {
		d.breakCount++
		msg := fmt.Sprintf("Prompt cache break detected (turn %d, total breaks: %d). System prompt changed — cache invalidated.", d.turnCount, d.breakCount)
		log.Printf("[cache] %s", msg)
		if d.notifyFn != nil {
			d.notifyFn(msg)
		}
	}

	d.lastHash = currentHash
}

// Stats returns cache break statistics.
func (d *CacheBreakDetector) Stats() (turns, breaks int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.turnCount, d.breakCount
}

// BreakRate returns the fraction of turns that had cache breaks.
func (d *CacheBreakDetector) BreakRate() float64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.turnCount <= 1 {
		return 0
	}
	return float64(d.breakCount) / float64(d.turnCount-1) // First turn can't have a break
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h[:16])
}
