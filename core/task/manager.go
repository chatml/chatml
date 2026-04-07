// Package task provides background task management for the native Go loop.
// Tasks are goroutine-based units of work (sub-agents, background bash commands)
// that can be created, monitored, updated, and stopped by the LLM.
package task

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Status represents the lifecycle state of a task.
type Status string

const (
	StatusPending    Status = "pending"
	StatusInProgress Status = "in_progress"
	StatusCompleted  Status = "completed"
	StatusFailed     Status = "failed"
	StatusStopped    Status = "stopped"
)

// Task represents a background unit of work.
type Task struct {
	mu sync.Mutex

	ID          string                 `json:"id"`
	Subject     string                 `json:"subject"`
	Description string                 `json:"description"`
	ActiveForm  string                 `json:"active_form,omitempty"` // Present continuous (e.g., "Running tests")
	Status      Status                 `json:"status"`
	Owner       string                 `json:"owner,omitempty"` // Agent name for swarm mode
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	Output      string                 `json:"output,omitempty"`
	Error       string                 `json:"error,omitempty"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`

	// Blocking relationships
	Blocks    []string `json:"blocks,omitempty"`     // Task IDs this task blocks
	BlockedBy []string `json:"blocked_by,omitempty"` // Task IDs that block this task

	// Internal: cancellation
	cancel context.CancelFunc
}

// IsTerminal returns true if the task is in a final state.
func (t *Task) IsTerminal() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.Status == StatusCompleted || t.Status == StatusFailed || t.Status == StatusStopped
}

// Manager tracks all tasks for a session.
type Manager struct {
	mu     sync.RWMutex
	tasks  map[string]*Task
	order  []string // Preserves creation order
	nextID int
}

// NewManager creates an empty task manager.
func NewManager() *Manager {
	return &Manager{
		tasks: make(map[string]*Task),
	}
}

// Create adds a new task and returns its ID.
func (m *Manager) Create(subject, description, activeForm string, metadata map[string]interface{}) *Task {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.nextID++
	id := fmt.Sprintf("task-%d", m.nextID)

	now := time.Now()
	t := &Task{
		ID:          id,
		Subject:     subject,
		Description: description,
		ActiveForm:  activeForm,
		Status:      StatusPending,
		Metadata:    metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	m.tasks[id] = t
	m.order = append(m.order, id)
	return t
}

// Get returns a task by ID, or nil if not found.
func (m *Manager) Get(id string) *Task {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tasks[id]
}

// List returns all tasks in creation order.
func (m *Manager) List() []*Task {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*Task, 0, len(m.order))
	for _, id := range m.order {
		if t, ok := m.tasks[id]; ok {
			result = append(result, t)
		}
	}
	return result
}

// Update modifies a task's fields. Only non-zero values are applied.
// NOTE: This means empty strings cannot be used to clear a field — the zero
// value is indistinguishable from "not provided". A pointer-based or sentinel
// approach would be needed to support clearing.
func (m *Manager) Update(id string, opts UpdateOpts) error {
	m.mu.RLock()
	t, ok := m.tasks[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("task %q not found", id)
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if opts.Subject != "" {
		t.Subject = opts.Subject
	}
	if opts.Description != "" {
		t.Description = opts.Description
	}
	if opts.ActiveForm != "" {
		t.ActiveForm = opts.ActiveForm
	}
	if opts.Status != "" {
		t.Status = opts.Status
	}
	if opts.Owner != "" {
		t.Owner = opts.Owner
	}
	if opts.Output != "" {
		t.Output = opts.Output
	}
	if opts.Error != "" {
		t.Error = opts.Error
	}
	if opts.Metadata != nil {
		if t.Metadata == nil {
			t.Metadata = make(map[string]interface{})
		}
		for k, v := range opts.Metadata {
			if v == nil {
				delete(t.Metadata, k)
			} else {
				t.Metadata[k] = v
			}
		}
	}
	if len(opts.AddBlocks) > 0 {
		t.Blocks = appendUnique(t.Blocks, opts.AddBlocks...)
	}
	if len(opts.AddBlockedBy) > 0 {
		t.BlockedBy = appendUnique(t.BlockedBy, opts.AddBlockedBy...)
	}

	t.UpdatedAt = time.Now()
	return nil
}

// UpdateOpts holds optional fields for task update.
type UpdateOpts struct {
	Subject      string
	Description  string
	ActiveForm   string
	Status       Status
	Owner        string
	Output       string
	Error        string
	Metadata     map[string]interface{}
	AddBlocks    []string
	AddBlockedBy []string
}

// Delete removes a task.
func (m *Manager) Delete(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	t, ok := m.tasks[id]
	if !ok {
		return false
	}

	// Cancel if running
	t.mu.Lock()
	if t.cancel != nil {
		t.cancel()
	}
	t.mu.Unlock()

	delete(m.tasks, id)
	for i, oid := range m.order {
		if oid == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	return true
}

// Stop cancels a running task's context.
func (m *Manager) Stop(id string) error {
	m.mu.RLock()
	t, ok := m.tasks[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("task %q not found", id)
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cancel != nil {
		t.cancel()
	}
	t.Status = StatusStopped
	t.UpdatedAt = time.Now()
	return nil
}

// SetCancel sets the cancellation function for a running task.
func (m *Manager) SetCancel(id string, cancel context.CancelFunc) {
	m.mu.RLock()
	t, ok := m.tasks[id]
	m.mu.RUnlock()
	if !ok {
		return
	}
	t.mu.Lock()
	t.cancel = cancel
	t.mu.Unlock()
}

// FormatList returns a human-readable task list.
func FormatList(tasks []*Task) string {
	if len(tasks) == 0 {
		return "No tasks."
	}
	var sb strings.Builder
	for _, t := range tasks {
		icon := statusIcon(t.Status)
		sb.WriteString(fmt.Sprintf("%s [%s] %s — %s", icon, t.ID, t.Subject, t.Status))
		if t.Owner != "" {
			sb.WriteString(fmt.Sprintf(" (owner: %s)", t.Owner))
		}
		// Show non-completed blockers
		if len(t.BlockedBy) > 0 {
			sb.WriteString(fmt.Sprintf(" [blocked by: %s]", strings.Join(t.BlockedBy, ", ")))
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func statusIcon(s Status) string {
	switch s {
	case StatusPending:
		return "○"
	case StatusInProgress:
		return "◉"
	case StatusCompleted:
		return "✓"
	case StatusFailed:
		return "✗"
	case StatusStopped:
		return "■"
	default:
		return "?"
	}
}

func appendUnique(slice []string, items ...string) []string {
	set := make(map[string]bool, len(slice))
	for _, s := range slice {
		set[s] = true
	}
	for _, item := range items {
		if !set[item] {
			slice = append(slice, item)
			set[item] = true
		}
	}
	return slice
}
