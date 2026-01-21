package orchestrator

import (
	"context"
	"log"
	"sync"
	"time"
)

// SchedulerCallback is called when a scheduled agent should run
type SchedulerCallback func(agentID string)

// Scheduler manages polling tickers for agents
type Scheduler struct {
	mu       sync.RWMutex
	tickers  map[string]*agentTicker
	callback SchedulerCallback
	ctx      context.Context
	cancel   context.CancelFunc
}

// agentTicker holds the ticker and control for a single agent
type agentTicker struct {
	ticker   *time.Ticker
	interval time.Duration
	stopCh   chan struct{}
}

// NewScheduler creates a new scheduler
func NewScheduler(callback SchedulerCallback) *Scheduler {
	ctx, cancel := context.WithCancel(context.Background())
	return &Scheduler{
		tickers:  make(map[string]*agentTicker),
		callback: callback,
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Schedule starts or updates polling for an agent
func (s *Scheduler) Schedule(agentID string, intervalMs int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop existing ticker if any
	if existing, ok := s.tickers[agentID]; ok {
		existing.ticker.Stop()
		close(existing.stopCh)
		delete(s.tickers, agentID)
	}

	if intervalMs <= 0 {
		log.Printf("[scheduler] Agent %s has no polling interval, skipping", agentID)
		return
	}

	interval := time.Duration(intervalMs) * time.Millisecond
	ticker := time.NewTicker(interval)
	stopCh := make(chan struct{})

	at := &agentTicker{
		ticker:   ticker,
		interval: interval,
		stopCh:   stopCh,
	}
	s.tickers[agentID] = at

	// Start the ticker goroutine
	go s.runTicker(agentID, at)

	log.Printf("[scheduler] Scheduled agent %s with interval %v", agentID, interval)
}

// runTicker runs the ticker loop for an agent
func (s *Scheduler) runTicker(agentID string, at *agentTicker) {
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-at.stopCh:
			return
		case <-at.ticker.C:
			if s.callback != nil {
				s.callback(agentID)
			}
		}
	}
}

// Unschedule stops polling for an agent
func (s *Scheduler) Unschedule(agentID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if at, ok := s.tickers[agentID]; ok {
		at.ticker.Stop()
		close(at.stopCh)
		delete(s.tickers, agentID)
		log.Printf("[scheduler] Unscheduled agent %s", agentID)
	}
}

// UpdateInterval changes the polling interval for an agent
func (s *Scheduler) UpdateInterval(agentID string, intervalMs int) {
	// Simply reschedule with the new interval
	s.Schedule(agentID, intervalMs)
}

// TriggerNow immediately triggers an agent run (outside of schedule)
func (s *Scheduler) TriggerNow(agentID string) {
	if s.callback != nil {
		go s.callback(agentID)
	}
}

// IsScheduled returns whether an agent is currently scheduled
func (s *Scheduler) IsScheduled(agentID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.tickers[agentID]
	return ok
}

// GetInterval returns the current polling interval for an agent
func (s *Scheduler) GetInterval(agentID string) time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if at, ok := s.tickers[agentID]; ok {
		return at.interval
	}
	return 0
}

// ListScheduled returns all scheduled agent IDs
func (s *Scheduler) ListScheduled() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.tickers))
	for id := range s.tickers {
		ids = append(ids, id)
	}
	return ids
}

// Stop stops all tickers and shuts down the scheduler
func (s *Scheduler) Stop() {
	s.cancel()

	s.mu.Lock()
	defer s.mu.Unlock()

	for agentID, at := range s.tickers {
		at.ticker.Stop()
		close(at.stopCh)
		delete(s.tickers, agentID)
	}

	log.Printf("[scheduler] Stopped all agents")
}
