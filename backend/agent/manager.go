package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/session"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

const snapshotDebounceInterval = 500 * time.Millisecond

// Legacy handlers (for backwards compatibility)
type OutputHandler func(agentID string, line string)
type StatusHandler func(agentID string, status models.AgentStatus)

// New conversation event handlers
type ConversationEventHandler func(conversationID string, event *AgentEvent)
type ConversationStatusHandler func(conversationID string, status string)

// Session event handler for session-level updates
type SessionEventHandler func(sessionID string, event map[string]interface{})

type Manager struct {
	ctx             context.Context // app-level context for background goroutines
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

	// Session event handler
	onSessionEvent SessionEventHandler
}

func NewManager(ctx context.Context, s *store.SQLiteStore, wm *git.WorktreeManager) *Manager {
	return &Manager{
		ctx:             ctx,
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

func (m *Manager) SetSessionEventHandler(handler SessionEventHandler) {
	m.onSessionEvent = handler
}

// StartConversationOptions contains optional parameters for starting a conversation
type StartConversationOptions struct {
	MaxThinkingTokens int                 // Enable extended thinking with this token budget
	Attachments       []models.Attachment // File attachments for the initial message
	PlanMode          bool                // Start agent in plan mode
	Instructions      string              // Additional instructions (e.g., from conversation summaries)
	Model             string              // Model name override (e.g., "opus-4.5", "sonnet-4", "haiku-3.5")
}

// StartConversation creates and starts a new conversation within a session
func (m *Manager) StartConversation(ctx context.Context, sessionID, conversationType, initialMessage string, opts *StartConversationOptions) (*models.Conversation, error) {
	sessionWithWs, err := m.store.GetSessionWithWorkspace(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	if sessionWithWs == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}
	session := &sessionWithWs.Session

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
	if opts != nil && opts.Model != "" {
		conv.Model = opts.Model
	}

	if err := m.store.AddConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("failed to add conversation: %w", err)
	}

	// Build process options
	procOpts := ProcessOptions{
		ID:             convID,
		Workdir:        session.WorktreePath,
		ConversationID: convID,
	}

	// Always pass the effective target branch to the agent-runner so it doesn't
	// need to independently detect the base branch (which could disagree with the backend).
	procOpts.TargetBranch = sessionWithWs.EffectiveTargetBranch()

	// Apply optional parameters
	if opts != nil {
		procOpts.MaxThinkingTokens = opts.MaxThinkingTokens
		procOpts.PlanMode = opts.PlanMode
		procOpts.Instructions = opts.Instructions
		procOpts.Model = opts.Model
	}

	// Load custom environment variables from settings
	envVars, err := m.loadEnvVars(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load env vars from settings: %w", err)
	}
	if envVars != nil {
		procOpts.EnvVars = envVars
	}

	// Create and start process
	proc := NewProcessWithOptions(procOpts)

	m.mu.Lock()
	m.convProcesses[convID] = proc
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		if updateErr := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
			c.Status = models.ConversationStatusIdle
		}); updateErr != nil {
			logger.Manager.Errorf("Failed to update conversation status on start error: %v", updateErr)
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
		// Collect attachments from options
		var attachments []models.Attachment
		if opts != nil && len(opts.Attachments) > 0 {
			attachments = opts.Attachments
		}

		// Store user message with attachments
		msg := models.Message{
			ID:          uuid.New().String()[:8],
			Role:        "user",
			Content:     initialMessage,
			Attachments: attachments,
			Timestamp:   time.Now(),
		}
		if err := m.store.AddMessageToConversation(ctx, convID, msg); err != nil {
			logger.Manager.Errorf("Failed to store initial user message: %v", err)
		}

		// Save attachments to database if any
		if len(attachments) > 0 {
			if err := m.store.SaveAttachments(ctx, msg.ID, attachments); err != nil {
				logger.Manager.Errorf("Failed to save attachments: %v", err)
			}
		}

		if err := proc.SendMessageWithAttachments(initialMessage, attachments); err != nil {
			return conv, fmt.Errorf("failed to send initial message: %w", err)
		}
	}

	return conv, nil
}

// handleConversationOutput processes output from the agent process.
// Note: Uses the app-level context so background work is cancelled on shutdown.
// Store errors are logged but not propagated since this is async processing.
func (m *Manager) handleConversationOutput(convID string, proc *Process) {
	ctx := m.ctx
	var currentAssistantMessage string
	var lastReportedDrops uint64

	// Streaming snapshot state for reconnection recovery
	activeToolsMap := make(map[string]ActiveToolEntry)
	var currentThinking string
	var isThinking bool
	var snapshotDirty bool

	// Debounced snapshot flush: 500ms after last state change
	snapshotTimer := time.NewTimer(snapshotDebounceInterval)
	snapshotTimer.Stop() // Don't start until first state change
	defer snapshotTimer.Stop()

	// flushSnapshot writes the current streaming state to the DB
	flushSnapshot := func() {
		if !snapshotDirty {
			return
		}
		// Build active tools slice from map
		tools := make([]ActiveToolEntry, 0, len(activeToolsMap))
		for _, t := range activeToolsMap {
			tools = append(tools, t)
		}
		snapshot := StreamingSnapshot{
			Text:           currentAssistantMessage,
			ActiveTools:    tools,
			Thinking:       currentThinking,
			IsThinking:     isThinking,
			PlanModeActive: proc.IsPlanModeActive(),
		}
		data, err := json.Marshal(snapshot)
		if err != nil {
			logger.Manager.Errorf("Failed to marshal streaming snapshot for conv %s: %v", convID, err)
			return
		}
		if err := m.store.SetStreamingSnapshot(ctx, convID, data); err != nil {
			logger.Manager.Errorf("Failed to store streaming snapshot for conv %s: %v", convID, err)
			return
		}
		snapshotDirty = false
	}

	// markSnapshotDirty sets the dirty flag and resets the debounce timer.
	// We drain before reset to avoid the documented timer.Reset footgun: if the
	// timer already fired, the channel has a pending value that could cause a
	// spurious flush on the next select iteration. In practice flushSnapshot()
	// is a no-op when !snapshotDirty so a double-flush is harmless, but draining
	// keeps the behavior predictable.
	markSnapshotDirty := func() {
		snapshotDirty = true
		if !snapshotTimer.Stop() {
			select {
			case <-snapshotTimer.C:
			default:
			}
		}
		snapshotTimer.Reset(snapshotDebounceInterval)
	}

	// Periodically check for dropped messages and emit warnings out-of-band.
	// This bypasses the process output channel, so warnings are delivered even
	// when the output channel is congested (which is exactly when drops occur).
	dropCheckTicker := time.NewTicker(2 * time.Second)
	defer dropCheckTicker.Stop()

	outputCh := proc.Output()
outer:
	for {
		select {
		case line, ok := <-outputCh:
			if !ok {
				// Channel closed - process ended
				break outer
			}

			event := ParseAgentLine(line)
			if event == nil {
				continue
			}

			// Handle specific event types
			switch event.Type {
			case EventTypeAssistantText:
				currentAssistantMessage += event.Content
				markSnapshotDirty()

			case EventTypeToolStart:
				activeToolsMap[event.ID] = ActiveToolEntry{
					ID:        event.ID,
					Tool:      event.Tool,
					StartTime: time.Now().Unix(),
				}
				markSnapshotDirty()

			case EventTypeSessionIdUpdate:
				// Track the session ID so restarts can resume the correct session
				if event.SessionID != "" {
					proc.SetSessionID(event.SessionID)
				}

			case EventTypePermModeChanged:
				// Keep plan mode state in sync with agent-runner
				proc.SetPlanModeFromEvent(event.Mode == "plan")
				markSnapshotDirty()

			case EventTypeThinking, EventTypeThinkingDelta:
				currentThinking += event.Content
				isThinking = true
				markSnapshotDirty()

			case EventTypeToolEnd:
				delete(activeToolsMap, event.ID)
				markSnapshotDirty()

				// Store tool action in summary
				if err := m.store.AddToolActionToConversation(ctx, convID, models.ToolAction{
					ID:      event.ID,
					Tool:    event.Tool,
					Target:  event.Summary,
					Success: event.Success,
				}); err != nil {
					logger.Manager.Errorf("Failed to store tool action for conv %s: %v", convID, err)
				}

			case EventTypeNameSuggestion:
				// Update conversation name
				var sessionID string
				if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
					c.Name = event.Name
					c.UpdatedAt = time.Now()
					sessionID = c.SessionID
				}); err != nil {
					logger.Manager.Errorf("Failed to update conversation name for %s: %v", convID, err)
				}

				// Also update session name if it hasn't been auto-named yet
				if sessionID != "" && event.Name != "" {
					m.tryAutoNameSession(ctx, sessionID, event.Name)
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
						logger.Manager.Errorf("Failed to store assistant message for conv %s: %v", convID, err)
					}
					currentAssistantMessage = ""
				}
				// Clear thinking on completion
				currentThinking = ""
				isThinking = false
				activeToolsMap = make(map[string]ActiveToolEntry)
				snapshotDirty = false // No need to flush — we're about to clear

				// Clear snapshot directly (skipping flush: the snapshot is about to be
				// removed anyway, so writing an intermediate state is wasted I/O).
				if err := m.store.ClearStreamingSnapshot(ctx, convID); err != nil {
					logger.Manager.Errorf("Failed to clear streaming snapshot for conv %s: %v", convID, err)
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

		case <-snapshotTimer.C:
			// Debounce timer fired — flush snapshot to DB
			flushSnapshot()

		case <-dropCheckTicker.C:
			// Check for new drops and emit warning out-of-band
			currentDrops := proc.DroppedMessages()
			if currentDrops > lastReportedDrops {
				newDrops := currentDrops - lastReportedDrops
				lastReportedDrops = currentDrops
				logger.Manager.Warnf("Conversation %s: %d new message drops detected (total: %d)", convID, newDrops, currentDrops)
				if m.onConversationEvent != nil {
					m.onConversationEvent(convID, &AgentEvent{
						Type:    "streaming_warning",
						Source:  "process",
						Reason:  "buffer_full",
						Message: fmt.Sprintf("%d streaming events were dropped due to slow processing", newDrops),
					})
				}
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
			logger.Manager.Errorf("Failed to store final assistant message for conv %s: %v", convID, err)
		}
	}

	// Clear snapshot on process exit — but only if this process is still the current
	// one in the map. If a new process has already been started (via SendConversationMessage),
	// clearing now would wipe the new process's snapshot.
	m.mu.RLock()
	currentProc, exists := m.convProcesses[convID]
	isStaleHandler := exists && currentProc != proc
	m.mu.RUnlock()
	if !isStaleHandler {
		if err := m.store.ClearStreamingSnapshot(ctx, convID); err != nil {
			logger.Manager.Errorf("Failed to clear streaming snapshot on exit for conv %s: %v", convID, err)
		}
	}

	// Emit final drop stats if any drops occurred
	finalDrops := proc.DroppedMessages()
	if finalDrops > 0 {
		logger.Manager.Warnf("Conversation %s: process ended with %d total dropped messages", convID, finalDrops)
		if finalDrops > lastReportedDrops && m.onConversationEvent != nil {
			newDrops := finalDrops - lastReportedDrops
			m.onConversationEvent(convID, &AgentEvent{
				Type:    "streaming_warning",
				Source:  "process",
				Reason:  "buffer_full",
				Message: fmt.Sprintf("%d streaming events were dropped due to slow processing", newDrops),
			})
		}
	}
}

// handleConversationCompletion handles process completion.
// Note: Uses the app-level context so background work is cancelled on shutdown.
func (m *Manager) handleConversationCompletion(convID string, proc *Process) {
	ctx := m.ctx
	select {
	case <-proc.Done():
	case <-ctx.Done():
		logger.Manager.Warnf("App shutting down, abandoning completion wait for conversation %s", convID)
		return
	}

	exitErr := proc.ExitError()
	if exitErr != nil {
		logger.Manager.Warnf("Conversation %s process exited with error: %v", convID, exitErr)
	} else {
		logger.Manager.Infof("Conversation %s process exited cleanly", convID)
	}

	// Remove completed process from map to prevent unbounded growth.
	// The process is kept accessible via the local variable for status updates.
	m.mu.Lock()
	// Only remove if this is still the same process (another restart may have replaced it)
	if current, ok := m.convProcesses[convID]; ok && current == proc {
		delete(m.convProcesses, convID)
	}
	m.mu.Unlock()

	newStatus := models.ConversationStatusIdle

	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = newStatus
		c.UpdatedAt = time.Now()
	}); err != nil {
		logger.Manager.Errorf("Failed to update conversation status on completion for %s: %v", convID, err)
	}

	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, newStatus)
	}
}

// SendConversationMessage sends a follow-up message to an existing conversation
func (m *Manager) SendConversationMessage(ctx context.Context, convID, message string, attachments []models.Attachment) error {
	// Use full Lock for the check-and-restart sequence to prevent two concurrent
	// callers from both seeing a dead process and each creating a new one (race condition).
	m.mu.Lock()
	proc, ok := m.convProcesses[convID]
	needsRestart := !ok || proc.IsStopped() || !proc.IsRunning()

	if needsRestart {
		// Capture previous exit error for logging before we replace the process
		var prevExitErr error
		if ok && proc != nil {
			prevExitErr = proc.ExitError()
		}

		// Retrieve original options from the old process (if any) so we preserve
		// configuration like model, target branch, tool preset, budget limits, etc.
		var restartOpts ProcessOptions
		if ok && proc != nil {
			restartOpts = proc.Options()
		}

		// Release lock for DB calls. Note: two concurrent callers can both reach
		// this point. The double-check after re-acquiring the lock (below) ensures
		// only one actually starts a new process.
		m.mu.Unlock()

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

		// Build restart options: reuse original config but update workdir and
		// set up session resume using the last known session ID.
		if restartOpts.ID == "" {
			// No previous process options (first start via this path) — use minimal config
			restartOpts.ID = convID
			restartOpts.ConversationID = convID
		}
		restartOpts.Workdir = session.WorktreePath
		// Clear instructions: the temp file has been cleaned up and the content is not
		// preserved. This is acceptable because --resume carries the SDK's full context
		// (including original instructions). If the session ID is also unavailable
		// (e.g., process crashed before emitting session_id_update), the restart will
		// lack original instructions — an acceptable degradation for a crash scenario.
		restartOpts.Instructions = ""
		// Resume the previous session if we have a session ID
		if ok && proc != nil {
			if sid := proc.GetSessionID(); sid != "" {
				restartOpts.ResumeSession = sid
			}
		}

		logger.Manager.Infof("Auto-restarting process for conversation %s (previous exit error: %v)", convID, prevExitErr)

		// Cancel any pending user questions from the old process so the frontend
		// doesn't show a stale question UI pointing at the dead process.
		if m.onConversationEvent != nil {
			m.onConversationEvent(convID, &AgentEvent{
				Type:   "user_question_cancelled",
				Reason: "process_restart",
			})
		}

		newProc := NewProcessWithOptions(restartOpts)

		m.mu.Lock()
		// Check again — another goroutine may have restarted while we were doing DB calls
		if existingProc, exists := m.convProcesses[convID]; exists && existingProc.IsRunning() {
			m.mu.Unlock()
			// Another goroutine already restarted — use that process instead
			proc = existingProc
		} else {
			m.convProcesses[convID] = newProc
			m.mu.Unlock()

			if err := newProc.Start(); err != nil {
				return fmt.Errorf("failed to restart agent process: %w", err)
			}

			// Set up handlers for the new process
			go m.handleConversationOutput(convID, newProc)
			go m.handleConversationCompletion(convID, newProc)

			// Update status
			if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
				c.Status = models.ConversationStatusActive
				c.UpdatedAt = time.Now()
			}); err != nil {
				logger.Manager.Errorf("Failed to update conversation status to active: %v", err)
			}
			if m.onConversationStatus != nil {
				m.onConversationStatus(convID, models.ConversationStatusActive)
			}

			proc = newProc
		}
	} else {
		m.mu.Unlock()
	}

	// Store user message with attachments
	msg := models.Message{
		ID:          uuid.New().String()[:8],
		Role:        "user",
		Content:     message,
		Attachments: attachments,
		Timestamp:   time.Now(),
	}
	if err := m.store.AddMessageToConversation(ctx, convID, msg); err != nil {
		logger.Manager.Errorf("Failed to store user message for conv %s: %v", convID, err)
	}

	// Save attachments to database if any
	if len(attachments) > 0 {
		if err := m.store.SaveAttachments(ctx, msg.ID, attachments); err != nil {
			logger.Manager.Errorf("Failed to save attachments: %v", err)
		}
	}

	// Send to process with attachments
	return proc.SendMessageWithAttachments(message, attachments)
}

// RewindConversationFiles rewinds file changes in a conversation to a checkpoint
func (m *Manager) RewindConversationFiles(convID, checkpointUuid string) error {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || proc.IsStopped() || !proc.IsRunning() {
		return fmt.Errorf("conversation process not running: %s", convID)
	}

	return proc.RewindFiles(checkpointUuid)
}

// SetConversationPlanMode sets the permission mode for a conversation
// When enabled=true, sets "plan" mode; when enabled=false, sets "bypassPermissions"
func (m *Manager) SetConversationPlanMode(convID string, enabled bool) error {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || proc.IsStopped() || !proc.IsRunning() {
		return fmt.Errorf("conversation process not running: %s", convID)
	}

	mode := "bypassPermissions"
	if enabled {
		mode = "plan"
	}

	return proc.SetPermissionMode(mode)
}

// IsConversationInPlanMode returns whether the conversation process is in plan mode
func (m *Manager) IsConversationInPlanMode(convID string) bool {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || proc.IsStopped() || !proc.IsRunning() {
		return false
	}

	return proc.IsPlanModeActive()
}

// GetConversationDropStats returns the number of messages dropped for a conversation's process.
// Returns nil if no process is running for the given conversation.
func (m *Manager) GetConversationDropStats(convID string) map[string]uint64 {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok {
		return nil
	}

	return map[string]uint64{
		"droppedMessages": proc.DroppedMessages(),
	}
}

// StopConversation stops a running conversation
func (m *Manager) StopConversation(ctx context.Context, convID string) {

	m.mu.Lock()
	proc, ok := m.convProcesses[convID]
	if !ok {
		m.mu.Unlock()
		return
	}
	// Remove from map to prevent new lookups finding this process
	delete(m.convProcesses, convID)
	m.mu.Unlock()

	// Send graceful stop signal first (best effort, may fail if process already exited)
	proc.SendStop()

	// TryStop atomically claims ownership of the stop operation.
	// Returns false if another goroutine already stopped this process.
	if !proc.TryStop() {
		return // Another goroutine is handling the stop
	}

	// Update status only if we performed the stop
	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = models.ConversationStatusIdle
		c.UpdatedAt = time.Now()
	}); err != nil {
		logger.Manager.Errorf("Failed to update conversation status on stop: %v", err)
	}
	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, models.ConversationStatusIdle)
	}
}

// CompleteConversation marks a conversation as completed
func (m *Manager) CompleteConversation(ctx context.Context, convID string) {
	m.StopConversation(ctx, convID)

	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = models.ConversationStatusCompleted
		c.UpdatedAt = time.Now()
	}); err != nil {
		logger.Manager.Errorf("Failed to update conversation status to completed: %v", err)
	}
	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, models.ConversationStatusCompleted)
	}
}

// InsertProcessForTest inserts a process into the conversation map for testing purposes.
// This bypasses the normal spawn flow and should only be used in tests.
func (m *Manager) InsertProcessForTest(convID string, proc *Process) {
	m.mu.Lock()
	m.convProcesses[convID] = proc
	m.mu.Unlock()
}

// GetConversationProcess returns the process for a conversation
func (m *Manager) GetConversationProcess(convID string) *Process {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.convProcesses[convID]
}

// GetActiveStreamingConversations returns the IDs of conversations that currently
// have an active (running) agent process. Used by the frontend to reconcile
// stale streaming state after WebSocket reconnection.
func (m *Manager) GetActiveStreamingConversations() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var active []string
	for convID, proc := range m.convProcesses {
		if proc.IsRunning() {
			active = append(active, convID)
		}
	}
	return active
}

// formatSessionName converts a human-readable name into a branch-friendly format.
// Example: "Fix the login bug" -> "login-bug"
// Returns empty string for generic/non-specific names that shouldn't be used.
func formatSessionName(name string) string {
	// Convert to lowercase
	name = strings.ToLower(name)

	// Remove generic phrases first (before word-level filtering)
	genericPhrases := []string{
		"explore session", "explore codebase", "explore the codebase",
		"understand how", "understand the", "learn about", "look at",
		"investigate the", "investigate how", "check out", "review the",
		"examine the", "analyze the", "study the", "research the",
		"get familiar", "familiarize with", "dive into",
	}
	for _, phrase := range genericPhrases {
		name = strings.ReplaceAll(name, phrase, " ")
	}

	// Remove common filler words
	fillerWords := []string{
		"the", "a", "an", "to", "for", "with", "and", "or", "in", "on", "at",
		"help", "implement", "create", "add", "update", "fix", "make", "build",
		"i'll", "i will", "let me", "going to", "need to", "want to",
		"you", "me", "your", "my", "this", "that", "some", "new",
		"explore", "understand", "how", "works", "work", "does",
		"codebase", "code", "base", "project", "repo", "repository",
		"session", "task", "feature", "thing", "stuff",
	}

	// First pass: remove filler phrases
	for _, word := range fillerWords {
		// Remove as whole word with word boundaries
		pattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(word) + `\b`)
		name = pattern.ReplaceAllString(name, " ")
	}

	// Replace non-alphanumeric characters with spaces
	nonAlphaNum := regexp.MustCompile(`[^a-z0-9]+`)
	name = nonAlphaNum.ReplaceAllString(name, " ")

	// Split into words and filter empty ones
	words := strings.Fields(name)

	// Limit to first 4-5 meaningful words
	maxWords := 5
	if len(words) > maxWords {
		words = words[:maxWords]
	}

	// Join with hyphens
	result := strings.Join(words, "-")

	// Truncate if still too long (max 40 chars for branch names)
	if len(result) > 40 {
		result = result[:40]
		// Clean up trailing hyphen if we cut mid-word
		result = strings.TrimSuffix(result, "-")
	}

	// If we ended up with nothing meaningful, return empty to skip
	if len(result) < 3 {
		return ""
	}

	// Reject overly generic results
	genericResults := map[string]bool{
		"explore": true, "session": true, "codebase": true,
		"understand": true, "how": true, "works": true,
		"investigate": true, "analyze": true, "review": true,
	}
	if genericResults[result] {
		return ""
	}

	return result
}

// tryAutoNameSession attempts to auto-name a session based on the first conversation's name suggestion.
// It only updates the session name if the session hasn't been auto-named yet.
// The name is formatted like a branch name (lowercase, hyphenated).
// This also renames the git branch and updates the .session.json metadata file.
func (m *Manager) tryAutoNameSession(ctx context.Context, sessionID, suggestedName string) {
	sess, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		logger.Manager.Errorf("Failed to get session %s for auto-naming: %v", sessionID, err)
		return
	}
	if sess == nil {
		return
	}

	// Skip if session has already been auto-named
	if sess.AutoNamed {
		return
	}

	// Format the name like a branch name
	formattedName := formatSessionName(suggestedName)
	if formattedName == "" {
		logger.Manager.Infof("Skipping auto-name for session %s: could not extract meaningful name from %q", sessionID, suggestedName)
		return
	}

	// Rename the git branch
	oldBranchName := sess.Branch
	newBranchName := fmt.Sprintf("session/%s", formattedName)

	if err := m.worktreeManager.RenameBranch(ctx, sess.WorktreePath, oldBranchName, newBranchName); err != nil {
		logger.Manager.Errorf("Failed to rename branch for session %s: %v", sessionID, err)
		// Continue anyway - the session name update is still useful
	} else {
		logger.Manager.Infof("Renamed branch for session %s: %q -> %q", sessionID, oldBranchName, newBranchName)
	}

	// Update session name, branch, and mark as auto-named
	now := time.Now()
	if err := m.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.Name = formattedName
		s.Branch = newBranchName
		s.AutoNamed = true
		s.UpdatedAt = now
	}); err != nil {
		logger.Manager.Errorf("Failed to auto-name session %s: %v", sessionID, err)
		return
	}

	// Update the session metadata file
	if meta, err := session.ReadMetadata(sessionID); err == nil {
		meta.Name = formattedName
		meta.Branch = newBranchName
		if err := session.WriteMetadata(meta); err != nil {
			logger.Manager.Errorf("Failed to update session metadata for %s: %v", sessionID, err)
		}
	}

	logger.Manager.Infof("Auto-named session %s: %q (from %q)", sessionID, formattedName, suggestedName)

	// Emit session event for WebSocket broadcast
	if m.onSessionEvent != nil {
		m.onSessionEvent(sessionID, map[string]interface{}{
			"type":   "session_name_update",
			"name":   formattedName,
			"branch": newBranchName,
		})
	}
}

// ========== Legacy Agent Methods (for backwards compatibility) ==========

func (m *Manager) SpawnAgent(ctx context.Context, repoPath, repoID, task string) (*models.Agent, error) {
	agentID := uuid.New().String()[:8]
	sessionID := uuid.New().String()

	worktreePath, branchName, _, err := m.worktreeManager.Create(ctx, repoPath, agentID)
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
			logger.Manager.Errorf("Failed to update agent status on start error: %v", updateErr)
		}
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	if err := m.store.UpdateAgentStatus(ctx, agentID, models.StatusRunning); err != nil {
		logger.Manager.Errorf("Failed to update agent status to running: %v", err)
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
		bgCtx := m.ctx
		select {
		case <-proc.Done():
		case <-bgCtx.Done():
			logger.Manager.Warnf("App shutting down, abandoning completion wait for agent %s", agentID)
			return
		}
		if proc.ExitError() != nil {
			if err := m.store.UpdateAgentStatus(bgCtx, agentID, models.StatusError); err != nil {
				logger.Manager.Errorf("Failed to update agent status on error exit: %v", err)
			}
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusError)
			}
		} else {
			if err := m.store.UpdateAgentStatus(bgCtx, agentID, models.StatusDone); err != nil {
				logger.Manager.Errorf("Failed to update agent status to done: %v", err)
			}
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusDone)
			}
		}
	}()

	if err := proc.SendMessage(task); err != nil {
		if updateErr := m.store.UpdateAgentStatus(ctx, agentID, models.StatusError); updateErr != nil {
			logger.Manager.Errorf("Failed to update agent status on send error: %v", updateErr)
		}
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	return agent, nil
}

func (m *Manager) StopAgent(ctx context.Context, agentID string) {

	m.mu.Lock()
	proc, ok := m.processes[agentID]
	if !ok {
		m.mu.Unlock()
		return
	}
	// Remove from map to prevent new lookups finding this process
	delete(m.processes, agentID)
	m.mu.Unlock()

	// TryStop atomically claims ownership of the stop operation.
	// Returns false if another goroutine already stopped this process.
	if !proc.TryStop() {
		return // Another goroutine is handling the stop
	}

	// Update status only if we performed the stop
	if err := m.store.UpdateAgentStatus(ctx, agentID, models.StatusError); err != nil {
		logger.Manager.Errorf("Failed to update agent status on stop: %v", err)
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

// SetConversationModel switches the model for a running conversation process.
func (m *Manager) SetConversationModel(convID, model string) error {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || !proc.IsRunning() {
		return fmt.Errorf("no active process for conversation %s", convID)
	}
	return proc.SetModel(model)
}

// loadEnvVars reads custom environment variables from the settings store.
func (m *Manager) loadEnvVars(ctx context.Context) (map[string]string, error) {
	raw, found, err := m.store.GetSetting(ctx, "env-vars")
	if err != nil {
		return nil, err
	}
	if !found || raw == "" {
		return nil, nil
	}
	return store.ParseEnvVars(raw), nil
}
