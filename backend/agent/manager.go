package agent

import (
	"context"
	"fmt"
	"log"
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
	ctx := context.Background()
	session, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	convID := uuid.New().String()[:8]

	// Count existing conversations of this type to generate name
	existingConvs, err := m.store.ListConversations(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversations: %w", err)
	}
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

	if err := m.store.AddConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("failed to add conversation: %w", err)
	}

	// Create and start process
	proc := NewProcess(convID, session.WorktreePath, convID)

	m.mu.Lock()
	m.convProcesses[convID] = proc
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		if updateErr := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
			c.Status = models.ConversationStatusIdle
		}); updateErr != nil {
			log.Printf("[manager] failed to update conversation status on start error: %v", updateErr)
		}
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
		if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
			ID:        uuid.New().String()[:8],
			Role:      "user",
			Content:   initialMessage,
			Timestamp: time.Now(),
		}); err != nil {
			log.Printf("[manager] failed to store initial user message: %v", err)
		}

		if err := proc.SendMessage(initialMessage); err != nil {
			return conv, fmt.Errorf("failed to send initial message: %w", err)
		}
	}

	return conv, nil
}

// handleConversationOutput processes output from the agent process.
// Note: Uses context.Background() as this runs in a background goroutine.
// Store errors are logged but not propagated since this is async processing.
func (m *Manager) handleConversationOutput(convID string, proc *Process) {
	ctx := context.Background()
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
			if err := m.store.AddToolActionToConversation(ctx, convID, models.ToolAction{
				ID:      event.ID,
				Tool:    event.Tool,
				Target:  event.Summary,
				Success: event.Success,
			}); err != nil {
				log.Printf("[manager] failed to store tool action for conv %s: %v", convID, err)
			}

		case EventTypeNameSuggestion:
			// Update conversation name
			if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
				c.Name = event.Name
				c.UpdatedAt = time.Now()
			}); err != nil {
				log.Printf("[manager] failed to update conversation name for %s: %v", convID, err)
			}

		case EventTypeComplete, EventTypeResult:
			// Store accumulated assistant message
			if currentAssistantMessage != "" {
				if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
					ID:        uuid.New().String()[:8],
					Role:      "assistant",
					Content:   currentAssistantMessage,
					Timestamp: time.Now(),
				}); err != nil {
					log.Printf("[manager] failed to store assistant message for conv %s: %v", convID, err)
				}
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
		if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
			ID:        uuid.New().String()[:8],
			Role:      "assistant",
			Content:   currentAssistantMessage,
			Timestamp: time.Now(),
		}); err != nil {
			log.Printf("[manager] failed to store final assistant message for conv %s: %v", convID, err)
		}
	}
}

// handleConversationCompletion handles process completion.
// Note: Uses context.Background() as this runs in a background goroutine.
func (m *Manager) handleConversationCompletion(convID string, proc *Process) {
	ctx := context.Background()
	<-proc.Done()

	var newStatus string
	if proc.ExitError() != nil {
		newStatus = models.ConversationStatusIdle // Error, but can retry
	} else {
		newStatus = models.ConversationStatusIdle // Completed turn, waiting for next message
	}

	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = newStatus
		c.UpdatedAt = time.Now()
	}); err != nil {
		log.Printf("[manager] failed to update conversation status on completion for %s: %v", convID, err)
	}

	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, newStatus)
	}
}

// SendConversationMessage sends a follow-up message to an existing conversation
func (m *Manager) SendConversationMessage(convID, message string) error {
	ctx := context.Background()
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || !proc.IsRunning() {
		// Process not running, need to restart it
		conv, err := m.store.GetConversation(ctx, convID)
		if err != nil {
			return fmt.Errorf("failed to get conversation: %w", err)
		}
		if conv == nil {
			return fmt.Errorf("conversation not found: %s", convID)
		}

		session, err := m.store.GetSession(ctx, conv.SessionID)
		if err != nil {
			return fmt.Errorf("failed to get session: %w", err)
		}
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
		if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
			c.Status = models.ConversationStatusActive
			c.UpdatedAt = time.Now()
		}); err != nil {
			log.Printf("[manager] failed to update conversation status to active: %v", err)
		}
		if m.onConversationStatus != nil {
			m.onConversationStatus(convID, models.ConversationStatusActive)
		}
	}

	// Store user message
	if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
		ID:        uuid.New().String()[:8],
		Role:      "user",
		Content:   message,
		Timestamp: time.Now(),
	}); err != nil {
		log.Printf("[manager] failed to store user message for conv %s: %v", convID, err)
	}

	// Send to process
	return proc.SendMessage(message)
}

// StopConversation stops a running conversation
func (m *Manager) StopConversation(convID string) {
	ctx := context.Background()
	m.mu.Lock()
	proc, ok := m.convProcesses[convID]
	if !ok || !proc.IsRunning() {
		m.mu.Unlock()
		return
	}
	// Remove from map to prevent concurrent stop attempts
	delete(m.convProcesses, convID)
	m.mu.Unlock()

	// Now safe to stop without holding lock
	proc.SendStop()
	proc.Stop()

	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = models.ConversationStatusIdle
		c.UpdatedAt = time.Now()
	}); err != nil {
		log.Printf("[manager] failed to update conversation status on stop: %v", err)
	}
	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, models.ConversationStatusIdle)
	}
}

// CompleteConversation marks a conversation as completed
func (m *Manager) CompleteConversation(convID string) {
	ctx := context.Background()
	m.StopConversation(convID)

	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = models.ConversationStatusCompleted
		c.UpdatedAt = time.Now()
	}); err != nil {
		log.Printf("[manager] failed to update conversation status to completed: %v", err)
	}
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
	ctx := context.Background()
	agentID := uuid.New().String()[:8]
	sessionID := uuid.New().String()

	worktreePath, branchName, _, err := m.worktreeManager.Create(repoPath, agentID)
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

	if err := m.store.AddAgent(ctx, agent); err != nil {
		return nil, fmt.Errorf("failed to add agent: %w", err)
	}

	proc := NewProcess(agentID, worktreePath, sessionID)

	m.mu.Lock()
	m.processes[agentID] = proc
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		if updateErr := m.store.UpdateAgentStatus(ctx, agentID, models.StatusError); updateErr != nil {
			log.Printf("[manager] failed to update agent status on start error: %v", updateErr)
		}
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	if err := m.store.UpdateAgentStatus(ctx, agentID, models.StatusRunning); err != nil {
		log.Printf("[manager] failed to update agent status to running: %v", err)
	}
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
		bgCtx := context.Background()
		<-proc.Done()
		if proc.ExitError() != nil {
			if err := m.store.UpdateAgentStatus(bgCtx, agentID, models.StatusError); err != nil {
				log.Printf("[manager] failed to update agent status on error exit: %v", err)
			}
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusError)
			}
		} else {
			if err := m.store.UpdateAgentStatus(bgCtx, agentID, models.StatusDone); err != nil {
				log.Printf("[manager] failed to update agent status to done: %v", err)
			}
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusDone)
			}
		}
	}()

	if err := proc.SendMessage(task); err != nil {
		if updateErr := m.store.UpdateAgentStatus(ctx, agentID, models.StatusError); updateErr != nil {
			log.Printf("[manager] failed to update agent status on send error: %v", updateErr)
		}
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	return agent, nil
}

func (m *Manager) StopAgent(agentID string) {
	ctx := context.Background()
	m.mu.Lock()
	proc, ok := m.processes[agentID]
	if !ok {
		m.mu.Unlock()
		return
	}
	// Remove from map to prevent concurrent stop attempts
	delete(m.processes, agentID)
	m.mu.Unlock()

	// Now safe to stop without holding lock
	proc.Stop()
	if err := m.store.UpdateAgentStatus(ctx, agentID, models.StatusError); err != nil {
		log.Printf("[manager] failed to update agent status on stop: %v", err)
	}
	if m.onStatus != nil {
		m.onStatus(agentID, models.StatusError)
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
