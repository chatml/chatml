package agent

import (
	"fmt"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

// Legacy handlers (for backwards compatibility)
type OutputHandler func(agentID string, line string)
type StatusHandler func(agentID string, status models.AgentStatus)

// New conversation event handlers
type ConversationEventHandler func(conversationID string, event *AgentEvent)
type ConversationStatusHandler func(conversationID string, status string)

type Manager struct {
	store           *store.SQLiteStore
	worktreeManager *git.WorktreeManager
	processes       map[string]*Process // keyed by agentID (legacy)
	convProcesses   map[string]*Process // keyed by conversationID
	mu              sync.RWMutex

	// Legacy handlers
	onOutput OutputHandler
	onStatus StatusHandler

	// New conversation handlers
	onConversationEvent  ConversationEventHandler
	onConversationStatus ConversationStatusHandler
}

func NewManager(s *store.SQLiteStore, wm *git.WorktreeManager) *Manager {
	return &Manager{
		store:           s,
		worktreeManager: wm,
		processes:       make(map[string]*Process),
		convProcesses:   make(map[string]*Process),
	}
}

// Legacy handler setters
func (m *Manager) SetOutputHandler(handler OutputHandler) {
	m.onOutput = handler
}

func (m *Manager) SetStatusHandler(handler StatusHandler) {
	m.onStatus = handler
}

// New conversation handler setters
func (m *Manager) SetConversationEventHandler(handler ConversationEventHandler) {
	m.onConversationEvent = handler
}

func (m *Manager) SetConversationStatusHandler(handler ConversationStatusHandler) {
	m.onConversationStatus = handler
}

// StartConversation creates and starts a new conversation within a session
func (m *Manager) StartConversation(sessionID, conversationType, initialMessage string) (*models.Conversation, error) {
	session := m.store.GetSession(sessionID)
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	convID := uuid.New().String()[:8]

	// Count existing conversations of this type to generate name
	existingConvs := m.store.ListConversations(sessionID)
	typeCount := 1
	for _, c := range existingConvs {
		if c.Type == conversationType {
			typeCount++
		}
	}

	// Generate initial name based on type
	var name string
	switch conversationType {
	case models.ConversationTypeTask:
		name = fmt.Sprintf("Task #%d", typeCount)
	case models.ConversationTypeReview:
		name = fmt.Sprintf("Review #%d", typeCount)
	case models.ConversationTypeChat:
		name = fmt.Sprintf("Chat #%d", typeCount)
	default:
		name = fmt.Sprintf("Conversation #%d", typeCount)
	}

	now := time.Now()
	conv := &models.Conversation{
		ID:          convID,
		SessionID:   sessionID,
		Type:        conversationType,
		Name:        name,
		Status:      models.ConversationStatusActive,
		Messages:    []models.Message{},
		ToolSummary: []models.ToolAction{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	m.store.AddConversation(conv)

	// Create and start process
	proc := NewProcess(convID, session.WorktreePath, convID)

	m.mu.Lock()
	m.convProcesses[convID] = proc
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		m.store.UpdateConversation(convID, func(c *models.Conversation) {
			c.Status = models.ConversationStatusIdle
		})
		if m.onConversationStatus != nil {
			m.onConversationStatus(convID, models.ConversationStatusIdle)
		}
		return conv, fmt.Errorf("failed to start agent process: %w", err)
	}

	// Handle output streaming
	go m.handleConversationOutput(convID, proc)

	// Handle completion
	go m.handleConversationCompletion(convID, proc)

	// Send the initial message if provided
	if initialMessage != "" {
		// Store user message
		m.store.AddMessageToConversation(convID, models.Message{
			ID:        uuid.New().String()[:8],
			Role:      "user",
			Content:   initialMessage,
			Timestamp: time.Now(),
		})

		if err := proc.SendMessage(initialMessage); err != nil {
			return conv, fmt.Errorf("failed to send initial message: %w", err)
		}
	}

	return conv, nil
}

// handleConversationOutput processes output from the agent process
func (m *Manager) handleConversationOutput(convID string, proc *Process) {
	var currentAssistantMessage string

	for line := range proc.Output() {
		event := ParseAgentLine(line)
		if event == nil {
			continue
		}

		// Handle specific event types
		switch event.Type {
		case EventTypeAssistantText:
			currentAssistantMessage += event.Content

		case EventTypeToolStart:
			// Record tool start (will be updated on tool_end)

		case EventTypeToolEnd:
			// Store tool action in summary
			m.store.AddToolActionToConversation(convID, models.ToolAction{
				ID:      event.ID,
				Tool:    event.Tool,
				Target:  event.Summary,
				Success: event.Success,
			})

		case EventTypeNameSuggestion:
			// Update conversation name
			m.store.UpdateConversation(convID, func(c *models.Conversation) {
				c.Name = event.Name
				c.UpdatedAt = time.Now()
			})

		case EventTypeComplete, EventTypeResult:
			// Store accumulated assistant message
			if currentAssistantMessage != "" {
				m.store.AddMessageToConversation(convID, models.Message{
					ID:        uuid.New().String()[:8],
					Role:      "assistant",
					Content:   currentAssistantMessage,
					Timestamp: time.Now(),
				})
				currentAssistantMessage = ""
			}
		}

		// Forward event to handler
		if m.onConversationEvent != nil {
			m.onConversationEvent(convID, event)
		}

		// Also support legacy output handler (for backwards compatibility)
		if m.onOutput != nil {
			legacy := ParseStreamLine(line)
			formatted := FormatEvent(legacy)
			if formatted != "" {
				m.onOutput(convID, formatted)
			}
		}
	}

	// Store any remaining assistant message
	if currentAssistantMessage != "" {
		m.store.AddMessageToConversation(convID, models.Message{
			ID:        uuid.New().String()[:8],
			Role:      "assistant",
			Content:   currentAssistantMessage,
			Timestamp: time.Now(),
		})
	}
}

// handleConversationCompletion handles process completion
func (m *Manager) handleConversationCompletion(convID string, proc *Process) {
	<-proc.Done()

	var newStatus string
	if proc.ExitError() != nil {
		newStatus = models.ConversationStatusIdle // Error, but can retry
	} else {
		newStatus = models.ConversationStatusIdle // Completed turn, waiting for next message
	}

	m.store.UpdateConversation(convID, func(c *models.Conversation) {
		c.Status = newStatus
		c.UpdatedAt = time.Now()
	})

	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, newStatus)
	}
}

// SendConversationMessage sends a follow-up message to an existing conversation
func (m *Manager) SendConversationMessage(convID, message string) error {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || !proc.IsRunning() {
		// Process not running, need to restart it
		conv := m.store.GetConversation(convID)
		if conv == nil {
			return fmt.Errorf("conversation not found: %s", convID)
		}

		session := m.store.GetSession(conv.SessionID)
		if session == nil {
			return fmt.Errorf("session not found: %s", conv.SessionID)
		}

		// Create new process
		proc = NewProcess(convID, session.WorktreePath, convID)

		m.mu.Lock()
		m.convProcesses[convID] = proc
		m.mu.Unlock()

		if err := proc.Start(); err != nil {
			return fmt.Errorf("failed to restart agent process: %w", err)
		}

		// Set up handlers for the new process
		go m.handleConversationOutput(convID, proc)
		go m.handleConversationCompletion(convID, proc)

		// Update status
		m.store.UpdateConversation(convID, func(c *models.Conversation) {
			c.Status = models.ConversationStatusActive
			c.UpdatedAt = time.Now()
		})
		if m.onConversationStatus != nil {
			m.onConversationStatus(convID, models.ConversationStatusActive)
		}
	}

	// Store user message
	m.store.AddMessageToConversation(convID, models.Message{
		ID:        uuid.New().String()[:8],
		Role:      "user",
		Content:   message,
		Timestamp: time.Now(),
	})

	// Send to process
	return proc.SendMessage(message)
}

// StopConversation stops a running conversation
func (m *Manager) StopConversation(convID string) {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if ok && proc.IsRunning() {
		proc.SendStop()
		proc.Stop()

		m.store.UpdateConversation(convID, func(c *models.Conversation) {
			c.Status = models.ConversationStatusIdle
			c.UpdatedAt = time.Now()
		})
		if m.onConversationStatus != nil {
			m.onConversationStatus(convID, models.ConversationStatusIdle)
		}
	}
}

// CompleteConversation marks a conversation as completed
func (m *Manager) CompleteConversation(convID string) {
	m.StopConversation(convID)

	m.store.UpdateConversation(convID, func(c *models.Conversation) {
		c.Status = models.ConversationStatusCompleted
		c.UpdatedAt = time.Now()
	})
	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, models.ConversationStatusCompleted)
	}
}

// GetConversationProcess returns the process for a conversation
func (m *Manager) GetConversationProcess(convID string) *Process {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.convProcesses[convID]
}

// ========== Legacy Agent Methods (for backwards compatibility) ==========

func (m *Manager) SpawnAgent(repoPath, repoID, task string) (*models.Agent, error) {
	agentID := uuid.New().String()[:8]
	sessionID := uuid.New().String()

	worktreePath, branchName, err := m.worktreeManager.Create(repoPath, agentID)
	if err != nil {
		return nil, err
	}

	agent := &models.Agent{
		ID:        agentID,
		RepoID:    repoID,
		Task:      task,
		Status:    string(models.StatusPending),
		Worktree:  worktreePath,
		Branch:    branchName,
		CreatedAt: time.Now(),
	}

	m.store.AddAgent(agent)

	proc := NewProcess(agentID, worktreePath, sessionID)

	m.mu.Lock()
	m.processes[agentID] = proc
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		m.store.UpdateAgentStatus(agentID, models.StatusError)
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	m.store.UpdateAgentStatus(agentID, models.StatusRunning)
	if m.onStatus != nil {
		m.onStatus(agentID, models.StatusRunning)
	}

	go func() {
		for line := range proc.Output() {
			if m.onOutput != nil {
				event := ParseStreamLine(line)
				formatted := FormatEvent(event)
				if formatted != "" {
					m.onOutput(agentID, formatted)
				}
			}
		}
	}()

	go func() {
		<-proc.Done()
		if proc.ExitError() != nil {
			m.store.UpdateAgentStatus(agentID, models.StatusError)
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusError)
			}
		} else {
			m.store.UpdateAgentStatus(agentID, models.StatusDone)
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusDone)
			}
		}
	}()

	if err := proc.SendMessage(task); err != nil {
		m.store.UpdateAgentStatus(agentID, models.StatusError)
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	return agent, nil
}

func (m *Manager) StopAgent(agentID string) {
	m.mu.RLock()
	proc, ok := m.processes[agentID]
	m.mu.RUnlock()

	if ok {
		proc.Stop()
		m.store.UpdateAgentStatus(agentID, models.StatusError)
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
	}
}

func (m *Manager) GetProcess(agentID string) *Process {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.processes[agentID]
}

func (m *Manager) SendMessage(agentID, message string) error {
	m.mu.RLock()
	proc, ok := m.processes[agentID]
	m.mu.RUnlock()

	if !ok {
		return nil
	}

	return proc.SendMessage(message)
}
