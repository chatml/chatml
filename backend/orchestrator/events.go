package orchestrator

import (
	"sync"
	"time"

	"github.com/chatml/chatml-backend/models"
)

// Event types for agent orchestration
const (
	EventAgentStateChanged  = "agent.state.changed"
	EventAgentRunStarted    = "agent.run.started"
	EventAgentRunProgress   = "agent.run.progress"
	EventAgentRunCompleted  = "agent.run.completed"
	EventAgentSessionCreated = "agent.session.created"
)

// Event represents an orchestrator event
type Event struct {
	Type      string      `json:"type"`
	AgentID   string      `json:"agentId"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data,omitempty"`
}

// AgentStateChangedData contains data for state change events
type AgentStateChangedData struct {
	Enabled   bool   `json:"enabled"`
	LastError string `json:"lastError,omitempty"`
}

// AgentRunStartedData contains data for run start events
type AgentRunStartedData struct {
	RunID   string `json:"runId"`
	Trigger string `json:"trigger"`
}

// AgentRunProgressData contains data for run progress events
type AgentRunProgressData struct {
	RunID   string `json:"runId"`
	Message string `json:"message"`
}

// AgentRunCompletedData contains data for run completion events
type AgentRunCompletedData struct {
	RunID           string   `json:"runId"`
	Status          string   `json:"status"`
	ResultSummary   string   `json:"resultSummary,omitempty"`
	SessionsCreated []string `json:"sessionsCreated,omitempty"`
	Cost            float64  `json:"cost"`
	DurationMs      int64    `json:"durationMs"`
}

// AgentSessionCreatedData contains data for session creation events
type AgentSessionCreatedData struct {
	RunID     string `json:"runId"`
	SessionID string `json:"sessionId"`
}

// EventHandler is a function that handles orchestrator events
type EventHandler func(event Event)

// EventBus manages event subscriptions and dispatching
type EventBus struct {
	mu       sync.RWMutex
	handlers []EventHandler
}

// NewEventBus creates a new event bus
func NewEventBus() *EventBus {
	return &EventBus{
		handlers: make([]EventHandler, 0),
	}
}

// Subscribe adds an event handler
func (eb *EventBus) Subscribe(handler EventHandler) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	eb.handlers = append(eb.handlers, handler)
}

// Publish sends an event to all subscribers
func (eb *EventBus) Publish(event Event) {
	eb.mu.RLock()
	handlers := make([]EventHandler, len(eb.handlers))
	copy(handlers, eb.handlers)
	eb.mu.RUnlock()

	for _, handler := range handlers {
		go handler(event)
	}
}

// PublishAgentStateChanged publishes a state change event
func (eb *EventBus) PublishAgentStateChanged(agentID string, enabled bool, lastError string) {
	eb.Publish(Event{
		Type:      EventAgentStateChanged,
		AgentID:   agentID,
		Timestamp: time.Now(),
		Data: AgentStateChangedData{
			Enabled:   enabled,
			LastError: lastError,
		},
	})
}

// PublishAgentRunStarted publishes a run start event
func (eb *EventBus) PublishAgentRunStarted(agentID string, runID string, trigger string) {
	eb.Publish(Event{
		Type:      EventAgentRunStarted,
		AgentID:   agentID,
		Timestamp: time.Now(),
		Data: AgentRunStartedData{
			RunID:   runID,
			Trigger: trigger,
		},
	})
}

// PublishAgentRunProgress publishes a run progress event
func (eb *EventBus) PublishAgentRunProgress(agentID string, runID string, message string) {
	eb.Publish(Event{
		Type:      EventAgentRunProgress,
		AgentID:   agentID,
		Timestamp: time.Now(),
		Data: AgentRunProgressData{
			RunID:   runID,
			Message: message,
		},
	})
}

// PublishAgentRunCompleted publishes a run completion event
func (eb *EventBus) PublishAgentRunCompleted(agentID string, run *models.AgentRun, durationMs int64) {
	eb.Publish(Event{
		Type:      EventAgentRunCompleted,
		AgentID:   agentID,
		Timestamp: time.Now(),
		Data: AgentRunCompletedData{
			RunID:           run.ID,
			Status:          run.Status,
			ResultSummary:   run.ResultSummary,
			SessionsCreated: run.SessionsCreated,
			Cost:            run.Cost,
			DurationMs:      durationMs,
		},
	})
}

// PublishAgentSessionCreated publishes a session creation event
func (eb *EventBus) PublishAgentSessionCreated(agentID string, runID string, sessionID string) {
	eb.Publish(Event{
		Type:      EventAgentSessionCreated,
		AgentID:   agentID,
		Timestamp: time.Now(),
		Data: AgentSessionCreatedData{
			RunID:     runID,
			SessionID: sessionID,
		},
	})
}
