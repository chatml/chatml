package automation

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/store"
	"github.com/robfig/cron/v3"
)

// Scheduler manages cron-based workflow triggers.
type Scheduler struct {
	engine  *Engine
	store   *store.SQLiteStore
	cron    *cron.Cron
	entries map[string]cron.EntryID // triggerID -> cron entry ID
	mu      sync.Mutex
}

// NewScheduler creates a scheduler and loads existing cron triggers.
func NewScheduler(ctx context.Context, engine *Engine, s *store.SQLiteStore) *Scheduler {
	c := cron.New(cron.WithSeconds())
	sched := &Scheduler{
		engine:  engine,
		store:   s,
		cron:    c,
		entries: make(map[string]cron.EntryID),
	}
	sched.Reindex(ctx)
	return sched
}

// Start begins the cron scheduler.
func (s *Scheduler) Start() {
	s.cron.Start()
	logger.Automation.Infof("Cron scheduler started with %d entries", len(s.entries))
}

// Stop halts the cron scheduler.
func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
}

// Reindex rebuilds cron entries from the database.
func (s *Scheduler) Reindex(ctx context.Context) {
	triggers, err := s.store.ListTriggersByType(ctx, "cron")
	if err != nil {
		logger.Automation.Errorf("Scheduler: failed to load cron triggers: %v", err)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove all existing entries
	for _, entryID := range s.entries {
		s.cron.Remove(entryID)
	}
	s.entries = make(map[string]cron.EntryID)

	// Add new entries
	for _, t := range triggers {
		if !t.Enabled {
			continue
		}
		var cfg cronConfig
		if err := json.Unmarshal([]byte(t.Config), &cfg); err != nil || cfg.Expression == "" {
			logger.Automation.Warnf("Scheduler: invalid config for trigger %s: %v", t.ID, err)
			continue
		}

		triggerID := t.ID
		workflowID := t.WorkflowID
		expression := cfg.Expression

		entryID, err := s.cron.AddFunc(expression, func() {
			inputData := map[string]interface{}{
				"trigger":   "cron",
				"schedule":  expression,
				"timestamp": time.Now().UnixMilli(),
			}
			if _, err := s.engine.StartRun(context.Background(), workflowID, triggerID, "cron", inputData); err != nil {
				logger.Automation.Errorf("Scheduler: failed to start run for trigger %s: %v", triggerID, err)
			}
		})
		if err != nil {
			logger.Automation.Warnf("Scheduler: invalid cron expression %q for trigger %s: %v", expression, t.ID, err)
			continue
		}
		s.entries[triggerID] = entryID
	}

	logger.Automation.Infof("Scheduler: indexed %d cron triggers", len(s.entries))
}

type cronConfig struct {
	Expression string `json:"expression"`
	Timezone   string `json:"timezone,omitempty"`
}
