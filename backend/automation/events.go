package automation

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/store"
)

// Well-known event names emitted by ChatML.
const (
	EventSessionCompleted = "session_completed"
	EventPRCreated        = "pr_created"
	EventPRMerged         = "pr_merged"
	EventBranchChanged    = "branch_changed"
	EventCheckFailure     = "check_failure"
)

// EventBus routes internal ChatML events to matching workflow triggers.
type EventBus struct {
	engine *Engine
	store  *store.SQLiteStore
	// eventName -> list of {triggerID, workflowID}
	index map[string][]triggerRef
	mu    sync.RWMutex
}

type triggerRef struct {
	TriggerID  string
	WorkflowID string
}

// NewEventBus creates an EventBus and loads the trigger index from DB.
func NewEventBus(ctx context.Context, engine *Engine, s *store.SQLiteStore) *EventBus {
	eb := &EventBus{
		engine: engine,
		store:  s,
		index:  make(map[string][]triggerRef),
	}
	eb.Reindex(ctx)
	return eb
}

// Reindex rebuilds the in-memory index of event triggers from the database.
func (eb *EventBus) Reindex(ctx context.Context) {
	triggers, err := eb.store.ListTriggersByType(ctx, "event")
	if err != nil {
		logger.Automation.Errorf("EventBus: failed to load event triggers: %v", err)
		return
	}

	newIndex := make(map[string][]triggerRef)
	for _, t := range triggers {
		if !t.Enabled {
			continue
		}
		var cfg struct {
			EventName string `json:"eventName"`
		}
		if err := json.Unmarshal([]byte(t.Config), &cfg); err != nil || cfg.EventName == "" {
			continue
		}
		newIndex[cfg.EventName] = append(newIndex[cfg.EventName], triggerRef{
			TriggerID:  t.ID,
			WorkflowID: t.WorkflowID,
		})
	}

	eb.mu.Lock()
	eb.index = newIndex
	eb.mu.Unlock()

	logger.Automation.Infof("EventBus: indexed %d event triggers", len(triggers))
}

// Emit fires an event and starts workflow runs for all matching triggers.
func (eb *EventBus) Emit(eventName string, data map[string]interface{}) {
	eb.mu.RLock()
	refs := eb.index[eventName]
	eb.mu.RUnlock()

	if len(refs) == 0 {
		return
	}

	logger.Automation.Infof("EventBus: event %q matched %d trigger(s)", eventName, len(refs))

	ctx := context.Background()
	for _, ref := range refs {
		inputData := map[string]interface{}{
			"event":     eventName,
			"eventData": data,
		}
		if _, err := eb.engine.StartRun(ctx, ref.WorkflowID, ref.TriggerID, "event", inputData); err != nil {
			logger.Automation.Errorf("EventBus: failed to start run for trigger %s: %v", ref.TriggerID, err)
		}
	}
}
