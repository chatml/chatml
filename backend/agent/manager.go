package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

const snapshotDebounceInterval = 500 * time.Millisecond

// prURLPattern matches GitHub PR URLs in tool output (e.g., "https://github.com/owner/repo/pull/123")
var prURLPattern = regexp.MustCompile(`github\.com/[^/]+/[^/]+/pull/\d+`)

// dangerousSuggestionPattern matches destructive operations that should never appear in suggestions.
// These operations could break the worktree-based session model or destroy work.
var dangerousSuggestionPattern = regexp.MustCompile(`(?i)(delete\s.*branch|git\s+branch\s+-[dD]|rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|git\s+clean\s+-[fd])`)

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

	// Callback fired when agent creates a PR via bash (sessionID)
	onPRCreated func(sessionID string)
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

func (m *Manager) SetOnPRCreated(handler func(sessionID string)) {
	m.onPRCreated = handler
}

// StartConversationOptions contains optional parameters for starting a conversation
type StartConversationOptions struct {
	MaxThinkingTokens int                 // Enable extended thinking with this token budget
	Effort            string              // Reasoning effort: low, medium, high, max
	Attachments       []models.Attachment // File attachments for the initial message
	PlanMode          bool                // Start agent in plan mode
	Instructions      string              // Additional instructions (e.g., from conversation summaries)
	Model             string              // Model name override (e.g., "claude-opus-4-5-20251101", "claude-sonnet-4-20250514")
}

// StartConversation creates and starts a new conversation within a session
func (m *Manager) StartConversation(ctx context.Context, sessionID, conversationType, initialMessage string, opts *StartConversationOptions) (*models.Conversation, error) {
	if opts != nil && opts.Model != "" {
		logger.Manager.Debugf("StartConversation: model=%s", opts.Model)
	}

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

	// Set status based on whether there's an initial message.
	// Without a message the agent has nothing to do, so start idle.
	status := models.ConversationStatusIdle
	if initialMessage != "" {
		status = models.ConversationStatusActive
	}

	conv := &models.Conversation{
		ID:          convID,
		SessionID:   sessionID,
		Type:        conversationType,
		Name:        name,
		Status:      status,
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

	// When there's no initial message, add a setupInfo system message so the
	// frontend can render the session card, then return without spawning an
	// agent process. SendConversationMessage will auto-start the process when
	// the user sends their first message.
	if initialMessage == "" {
		originBranch := sessionWithWs.WorkspaceBranch
		if originBranch == "" {
			originBranch = "main"
		}
		setupMsg := models.Message{
			ID:   uuid.New().String()[:8],
			Role: "system",
			SetupInfo: &models.SetupInfo{
				SessionName:  session.Name,
				BranchName:   session.Branch,
				OriginBranch: originBranch,
			},
			Timestamp: now,
		}
		if err := m.store.AddMessageToConversation(ctx, convID, setupMsg); err != nil {
			return nil, fmt.Errorf("failed to add setup message to conversation %s: %w", convID, err)
		}
		conv.Messages = append(conv.Messages, setupMsg)
		return conv, nil
	}

	// Build process options
	procOpts := ProcessOptions{
		ID:                  convID,
		Workdir:             session.WorktreePath,
		ConversationID:      convID,
		SdkSessionID:        uuid.New().String(), // Full UUID required by SDK
		EnableCheckpointing: true,
	}

	// Always pass the effective target branch to the agent-runner so it doesn't
	// need to independently detect the base branch (which could disagree with the backend).
	procOpts.TargetBranch = sessionWithWs.EffectiveTargetBranch()

	// Apply optional parameters
	if opts != nil {
		procOpts.MaxThinkingTokens = opts.MaxThinkingTokens
		procOpts.Effort = opts.Effort
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

	// Load workspace MCP server configs from settings
	mcpJSON, err := m.loadMcpServers(ctx, session.WorkspaceID)
	if err != nil {
		logger.Manager.Errorf("Failed to load MCP servers for workspace %s: %v", session.WorkspaceID, err)
		// Non-fatal: continue without user-configured MCP servers
	}
	if mcpJSON != "" {
		procOpts.McpServersJSON = mcpJSON
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

		// Generate session title from the user's first message
		if !session.AutoNamed {
			go m.generateAndApplySessionTitle(sessionID, convID, initialMessage)
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
	activeSubAgents := make(map[string]*SubAgentEntry)
	// Buffer tools that arrive before their sub-agent registers (race recovery)
	pendingSubAgentTools := make(map[string][]ActiveToolEntry)
	var currentThinking string
	var pendingPlanContent string
	var isThinking bool
	var snapshotDirty bool

	// Per-turn accumulation for message persistence (Phase 3)
	var completedTools []models.ToolUsageRecord
	toolStartTimes := make(map[string]time.Time)
	type textSegment struct {
		content   string
		timestamp time.Time
	}
	var textSegments []textSegment
	var currentSegmentText string
	var currentSegmentStart *time.Time
	turnStartTime := time.Now()

	// maxOutputSize limits stdout/stderr stored per tool to prevent DB bloat
	const maxOutputSize = 10 * 1024
	truncateOutput := func(s string) string {
		if len(s) > maxOutputSize {
			return s[:maxOutputSize] + "\n... (truncated)"
		}
		return s
	}

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
		// Build sub-agents slice from map
		var subAgents []SubAgentEntry
		if len(activeSubAgents) > 0 {
			subAgents = make([]SubAgentEntry, 0, len(activeSubAgents))
			for _, sa := range activeSubAgents {
				subAgents = append(subAgents, *sa)
			}
		}
		// Build text segments for timeline-preserving snapshot restoration.
		// Include completed segments + current in-progress segment.
		var snapshotSegments []SnapshotTextSegment
		for _, seg := range textSegments {
			if seg.content != "" {
				snapshotSegments = append(snapshotSegments, SnapshotTextSegment{
					Text:      seg.content,
					Timestamp: seg.timestamp.UnixMilli(),
				})
			}
		}
		if currentSegmentText != "" && currentSegmentStart != nil {
			snapshotSegments = append(snapshotSegments, SnapshotTextSegment{
				Text:      currentSegmentText,
				Timestamp: currentSegmentStart.UnixMilli(),
			})
		}

		snapshot := StreamingSnapshot{
			Text:           currentAssistantMessage,
			TextSegments:   snapshotSegments,
			ActiveTools:    tools,
			Thinking:       currentThinking,
			IsThinking:     isThinking,
			PlanModeActive: proc.IsPlanModeActive(),
			SubAgents:      subAgents,
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

			// Track whether the agent emitted an error event (for crash fallback)
			if event.Type == EventTypeError || event.Type == EventTypeAuthError {
				proc.SetSawErrorEvent()
			}

			// Handle specific event types
			switch event.Type {
			case EventTypeAssistantText:
				currentAssistantMessage += event.Content
				// Track text segments for timeline persistence
				if currentSegmentStart == nil {
					now := time.Now()
					currentSegmentStart = &now
				}
				currentSegmentText += event.Content
				markSnapshotDirty()

			case EventTypeToolStart:
				entry := ActiveToolEntry{
					ID:        event.ID,
					Tool:      event.Tool,
					StartTime: time.Now().Unix(),
					AgentId:   event.AgentId,
				}
				if event.AgentId != "" {
					// Route to sub-agent's active tools
					if sa, ok := activeSubAgents[event.AgentId]; ok {
						sa.ActiveTools = append(sa.ActiveTools, entry)
					} else {
						// Sub-agent not registered yet — buffer until subagent_started arrives
						pendingSubAgentTools[event.AgentId] = append(pendingSubAgentTools[event.AgentId], entry)
					}
				} else {
					activeToolsMap[event.ID] = entry
					// Seal current text segment for timeline
					if currentSegmentStart != nil && currentSegmentText != "" {
						textSegments = append(textSegments, textSegment{
							content:   currentSegmentText,
							timestamp: *currentSegmentStart,
						})
						currentSegmentText = ""
						currentSegmentStart = nil
					}
					// Record tool start time for duration calculation
					toolStartTimes[event.ID] = time.Now()
				}
				markSnapshotDirty()

			case EventTypeSessionIdUpdate:
				// Track the session ID so restarts can resume the correct session
				if event.SessionID != "" {
					proc.SetSessionID(event.SessionID)
					// Persist to DB so the session ID survives process cleanup
					if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
						c.AgentSessionID = event.SessionID
					}); err != nil {
						logger.Manager.Errorf("Failed to persist agent session ID for conv %s: %v", convID, err)
					}
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
				if event.AgentId != "" {
					// Remove from sub-agent's active tools
					if sa, ok := activeSubAgents[event.AgentId]; ok {
						filtered := sa.ActiveTools[:0]
						for _, t := range sa.ActiveTools {
							if t.ID != event.ID {
								filtered = append(filtered, t)
							}
						}
						sa.ActiveTools = filtered
					}
				} else {
					// Skip duplicate tool_end events — during session replay the agent-runner
					// may emit tool_end twice for the same tool (once from the original execution,
					// once from the replayed conversation history). The duplicate arrives with
					// tool="Unknown" and causes UNIQUE constraint failures and ghost UI entries.
					if _, ok := activeToolsMap[event.ID]; !ok {
						logger.Manager.Debugf("Skipping duplicate tool_end for conv %s: tool=%s id=%s", convID, event.Tool, event.ID)
						continue
					}
					delete(activeToolsMap, event.ID)

					// Accumulate completed tool record for message persistence
					durationMs := 0
					var toolStart time.Time
					if startTime, ok := toolStartTimes[event.ID]; ok {
						durationMs = int(time.Since(startTime).Milliseconds())
						toolStart = startTime
						delete(toolStartTimes, event.ID)
					}
					success := event.Success
					completedTools = append(completedTools, models.ToolUsageRecord{
						ID:         event.ID,
						Tool:       event.Tool,
						Params:     event.Params,
						Success:    &success,
						Summary:    event.Summary,
						DurationMs: durationMs,
						Stdout:     truncateOutput(event.Stdout),
						Stderr:     truncateOutput(event.Stderr),
						StartTime:  toolStart,
					})
				}
				markSnapshotDirty()

				// Store tool action in summary (legacy flat list)
				if err := m.store.AddToolActionToConversation(ctx, convID, models.ToolAction{
					ID:      event.ID,
					Tool:    event.Tool,
					Target:  event.Summary,
					Success: event.Success,
				}); err != nil {
					logger.Manager.Errorf("Failed to store tool action for conv %s: %v", convID, err)
				}

				// Detect PR creation from Bash tool stdout (e.g., gh pr create)
				if event.Tool == "Bash" && event.Success && prURLPattern.MatchString(event.Stdout) {
					if m.onPRCreated != nil {
						conv, _ := m.store.GetConversationMeta(ctx, convID)
						if conv != nil {
							go m.onPRCreated(conv.SessionID)
						}
					}
				}

			case EventTypeNameSuggestion:
				// Legacy: agent-runner no longer emits this event. Title generation
				// is now handled by generateAndApplySessionTitle using the Haiku API.
				logger.Manager.Debugf("Received legacy name_suggestion event for conv %s: %q", convID, event.Name)

			case EventTypeSubagentStarted:
				if event.AgentId != "" {
					sa := &SubAgentEntry{
						AgentId:         event.AgentId,
						AgentType:       event.AgentType,
						ParentToolUseId: event.ParentToolUseId,
						Description:     event.AgentDescription,
						StartTime:       time.Now().Unix(),
					}
					// Drain any tools that arrived before this sub-agent registered
					if pending, ok := pendingSubAgentTools[event.AgentId]; ok {
						sa.ActiveTools = append(sa.ActiveTools, pending...)
						delete(pendingSubAgentTools, event.AgentId)
					}
					activeSubAgents[event.AgentId] = sa
					markSnapshotDirty()
				}

			case EventTypeSubagentStopped:
				if sa, ok := activeSubAgents[event.AgentId]; ok {
					sa.Completed = true
					markSnapshotDirty()
				}

			case EventTypeSubagentOutput:
				if sa, ok := activeSubAgents[event.AgentId]; ok {
					sa.Output = event.AgentOutput
					markSnapshotDirty()
				}

			case EventTypePlanApprovalRequest:
				pendingPlanContent = event.PlanContent

			case EventTypeCheckpointCreated:
				if event.CheckpointUuid != "" {
					conv, _ := m.store.GetConversationMeta(ctx, convID)
					if conv != nil {
						cp := &models.Checkpoint{
							ID:             uuid.New().String(),
							ConversationID: convID,
							SessionID:      conv.SessionID,
							UUID:           event.CheckpointUuid,
							MessageIndex:   event.MessageIndex,
							IsResult:       event.IsResult,
							Timestamp:      time.Now(),
						}
						if err := m.store.AddCheckpoint(ctx, cp); err != nil {
							logger.Manager.Errorf("Failed to persist checkpoint for conv %s: %v", convID, err)
						}
					}
				}

			case EventTypeTurnComplete, EventTypeComplete, EventTypeResult:
				// Turn or session completed — store accumulated message and reset
				// streaming state. turn_complete means the process stays alive;
				// complete/result means it will exit shortly.
				if currentAssistantMessage != "" {
					// Seal final text segment
					if currentSegmentStart != nil && currentSegmentText != "" {
						textSegments = append(textSegments, textSegment{
							content:   currentSegmentText,
							timestamp: *currentSegmentStart,
						})
					}

					// Build interleaved timeline from text segments and completed tools
					type timelineItem struct {
						timestamp time.Time
						entry     models.TimelineEntry
					}
					var items []timelineItem
					for _, seg := range textSegments {
						items = append(items, timelineItem{
							timestamp: seg.timestamp,
							entry:     models.TimelineEntry{Type: "text", Content: seg.content},
						})
					}
					for _, tool := range completedTools {
						ts := tool.StartTime
						if ts.IsZero() {
							ts = time.Now() // fallback
						}
						items = append(items, timelineItem{
							timestamp: ts,
							entry:     models.TimelineEntry{Type: "tool", ToolID: tool.ID},
						})
					}
					sort.Slice(items, func(i, j int) bool {
						return items[i].timestamp.Before(items[j].timestamp)
					})
					var timeline []models.TimelineEntry
					if len(items) > 0 {
						timeline = make([]models.TimelineEntry, len(items))
						for i, item := range items {
							timeline[i] = item.entry
						}
					}

					durationMs := int(time.Since(turnStartTime).Milliseconds())

					// Only persist plan content if ExitPlanMode succeeded this turn
					var planContent string
					if pendingPlanContent != "" {
						for _, tool := range completedTools {
							if tool.Tool == "ExitPlanMode" && tool.Success != nil && *tool.Success {
								planContent = pendingPlanContent
								break
							}
						}
					}

					if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
						ID:              uuid.New().String()[:8],
						Role:            "assistant",
						Content:         currentAssistantMessage,
						ToolUsage:       completedTools,
						ThinkingContent: currentThinking,
						PlanContent:     planContent,
						DurationMs:      durationMs,
						Timeline:        timeline,
						Timestamp:       time.Now(),
					}); err != nil {
						logger.Manager.Errorf("Failed to store assistant message for conv %s: %v", convID, err)
					}
					currentAssistantMessage = ""
				}
				// Reset per-turn accumulation state
				currentThinking = ""
				pendingPlanContent = ""
				isThinking = false
				activeToolsMap = make(map[string]ActiveToolEntry)
				activeSubAgents = make(map[string]*SubAgentEntry)
				pendingSubAgentTools = make(map[string][]ActiveToolEntry)
				completedTools = nil
				toolStartTimes = make(map[string]time.Time)
				textSegments = nil
				currentSegmentText = ""
				currentSegmentStart = nil
				turnStartTime = time.Now()
				snapshotDirty = false

				if err := m.store.ClearStreamingSnapshot(ctx, convID); err != nil {
					logger.Manager.Errorf("Failed to clear streaming snapshot for conv %s: %v", convID, err)
				}
			}

			// Forward event to handler
			if m.onConversationEvent != nil {
				m.onConversationEvent(convID, event)
			}

			// Generate input suggestion after turn completes (async, fire-and-forget)
			if event.Type == EventTypeResult {
				go m.generateInputSuggestion(convID)
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

	// Store any remaining assistant message (with full enrichment)
	if currentAssistantMessage != "" {
		// Seal any in-progress text segment
		if currentSegmentText != "" && currentSegmentStart != nil {
			textSegments = append(textSegments, textSegment{content: currentSegmentText, timestamp: *currentSegmentStart})
			currentSegmentText = ""
			currentSegmentStart = nil
		}

		// Build timeline from text segments + completed tools
		var timeline []models.TimelineEntry
		if len(textSegments) > 0 || len(completedTools) > 0 {
			type timelineItem struct {
				timestamp time.Time
				entry     models.TimelineEntry
			}
			var items []timelineItem
			for _, seg := range textSegments {
				items = append(items, timelineItem{timestamp: seg.timestamp, entry: models.TimelineEntry{Type: "text", Content: seg.content}})
			}
			for _, tool := range completedTools {
				ts := tool.StartTime
				if ts.IsZero() {
					ts = time.Now()
				}
				items = append(items, timelineItem{timestamp: ts, entry: models.TimelineEntry{Type: "tool", ToolID: tool.ID}})
			}
			sort.Slice(items, func(i, j int) bool { return items[i].timestamp.Before(items[j].timestamp) })
			timeline = make([]models.TimelineEntry, len(items))
			for i, item := range items {
				timeline[i] = item.entry
			}
		}

		durationMs := int(time.Since(turnStartTime).Milliseconds())

		// Only persist plan content if ExitPlanMode succeeded this turn
		var finalPlanContent string
		if pendingPlanContent != "" {
			for _, tool := range completedTools {
				if tool.Tool == "ExitPlanMode" && tool.Success != nil && *tool.Success {
					finalPlanContent = pendingPlanContent
					break
				}
			}
		}

		if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
			ID:              uuid.New().String()[:8],
			Role:            "assistant",
			Content:         currentAssistantMessage,
			ToolUsage:       completedTools,
			ThinkingContent: currentThinking,
			PlanContent:     finalPlanContent,
			DurationMs:      durationMs,
			Timeline:        timeline,
			Timestamp:       time.Now(),
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

		// If the agent-runner didn't emit its own error event, synthesize one
		// so the frontend shows a useful message instead of silently going idle.
		if !proc.SawErrorEvent() && m.onConversationEvent != nil {
			stderrLines := proc.LastStderrLines()
			errMsg := fmt.Sprintf("Claude Code process exited with code 1")
			if len(stderrLines) > 0 {
				errMsg += ": " + strings.Join(stderrLines, "\n")
			}
			m.onConversationEvent(convID, &AgentEvent{
				Type:    EventTypeError,
				Message: errMsg,
			})
		}
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
	// Track whether we should generate a title (set in the idle-start path)
	var shouldGenerateTitle bool
	var titleSessionID string

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
			restartOpts.EnableCheckpointing = true
		}
		restartOpts.Workdir = session.WorktreePath
		// Restore model from conversation record if not already set
		if restartOpts.Model == "" && conv.Model != "" {
			restartOpts.Model = conv.Model
		}
		// Clear instructions: the temp file has been cleaned up and the content is not
		// preserved. This is acceptable because --resume carries the SDK's full context
		// (including original instructions). If the session ID is also unavailable
		// (e.g., process crashed before emitting session_id_update), the restart will
		// lack original instructions — an acceptable degradation for a crash scenario.
		restartOpts.Instructions = ""
		// Resume the previous session if we have a session ID.
		// Try in-memory first, fall back to DB-persisted value.
		if ok && proc != nil {
			if sid := proc.GetSessionID(); sid != "" {
				restartOpts.ResumeSession = sid
			}
		}
		if restartOpts.ResumeSession == "" && conv.AgentSessionID != "" {
			restartOpts.ResumeSession = conv.AgentSessionID
		}

		// Check if we should generate a title for this session
		if !session.AutoNamed && message != "" {
			shouldGenerateTitle = true
			titleSessionID = conv.SessionID
			logger.Manager.Infof("Will generate title for session %s (conv %s)", conv.SessionID, convID)
		}

		if ok && proc != nil {
			logger.Manager.Warnf("Unexpected: auto-restarting process for conversation %s (previous exit error: %v). Multi-turn processes should stay alive between turns.", convID, prevExitErr)
		} else {
			logger.Manager.Infof("Starting process for idle conversation %s", convID)
		}

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
	if err := proc.SendMessageWithAttachments(message, attachments); err != nil {
		return err
	}

	// Generate session title if this is the first message on an idle-started session
	if shouldGenerateTitle {
		go m.generateAndApplySessionTitle(titleSessionID, convID, message)
	}

	return nil
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
	if err := proc.SendStop(); err != nil {
		logger.Manager.Debugf("SendStop for conversation %s: %v (may be expected if process already exited)", convID, err)
	}

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
// Example: "Fix the login bug" -> "fix-login-bug"
// Returns empty string for generic/non-specific names that shouldn't be used.
func formatSessionName(name string) string {
	// Convert to lowercase
	name = strings.ToLower(name)

	// Remove only articles and prepositions — keep action verbs and nouns
	// since LLM-generated titles are already concise (e.g., "Fix login bug")
	fillerWords := []string{
		"the", "a", "an", "to", "for", "with", "and", "or", "in", "on", "at",
	}

	for _, word := range fillerWords {
		pattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(word) + `\b`)
		name = pattern.ReplaceAllString(name, " ")
	}

	// Replace non-alphanumeric characters with spaces
	nonAlphaNum := regexp.MustCompile(`[^a-z0-9]+`)
	name = nonAlphaNum.ReplaceAllString(name, " ")

	// Split into words and filter empty ones
	words := strings.Fields(name)

	// Limit to first 5 meaningful words
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

	return result
}

// newAIClient creates a fresh AI client by checking multiple credential sources in order:
// 1. Encrypted API key stored in SQLite settings
// 2. ANTHROPIC_API_KEY environment variable
// 3. Claude Code OAuth token from macOS Keychain
// Returns nil if no credentials are available.
func (m *Manager) newAIClient() *ai.Client {
	// Source 1: SQLite settings (explicit user-configured API key)
	envVars, err := m.loadEnvVars(m.ctx)
	if err != nil {
		logger.Manager.Warnf("Failed to load env vars for AI client: %v", err)
	}
	if envVars != nil {
		if apiKey := envVars["ANTHROPIC_API_KEY"]; apiKey != "" {
			logger.Manager.Debugf("Using API key from settings")
			return ai.NewClient(apiKey)
		}
	}

	// Source 2: Process environment variable
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		logger.Manager.Debugf("Using API key from environment")
		return ai.NewClient(apiKey)
	}

	// Source 3: Claude Code OAuth token from macOS Keychain
	token, err := ai.ReadClaudeCodeOAuthToken()
	if err != nil {
		logger.Manager.Debugf("No Claude Code OAuth token available: %v", err)
		return nil
	}
	logger.Manager.Debugf("Using OAuth token from Claude Code keychain")
	return ai.NewClientWithOAuth(token)
}

// generateAndApplySessionTitle uses the AI client to generate a session title
// from the user's first message, then applies it to the conversation and session.
func (m *Manager) generateAndApplySessionTitle(sessionID, convID, userMessage string) {
	logger.Manager.Infof("Generating session title for session %s, conv %s", sessionID, convID)

	client := m.newAIClient()
	if client == nil {
		logger.Manager.Warnf("Skipping session title generation for %s: no API key configured", sessionID)
		return
	}

	ctx, cancel := context.WithTimeout(m.ctx, 15*time.Second)
	defer cancel()

	title, err := client.GenerateSessionTitle(ctx, userMessage)
	if err != nil {
		logger.Manager.Warnf("Failed to generate session title for session %s: %v", sessionID, err)
		return
	}

	if title == "" {
		logger.Manager.Warnf("Empty title returned for session %s", sessionID)
		return
	}

	logger.Manager.Infof("Generated session title for %s: %q", sessionID, title)

	// Update conversation name
	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Name = title
		c.UpdatedAt = time.Now()
	}); err != nil {
		logger.Manager.Errorf("Failed to update conversation name for %s: %v", convID, err)
		return
	}

	// Forward to frontend
	if m.onConversationEvent != nil {
		m.onConversationEvent(convID, &AgentEvent{
			Type: EventTypeNameSuggestion,
			Name: title,
		})
	}

	// Also try to auto-name the session
	m.tryAutoNameSession(ctx, sessionID, title)
}

// buildSessionContext builds a context string describing the session's current state
// (PR status, git state) for use in suggestion generation.
func (m *Manager) buildSessionContext(ctx context.Context, convID string) string {
	conv, err := m.store.GetConversationMeta(ctx, convID)
	if err != nil || conv == nil {
		return ""
	}

	sess, err := m.store.GetSession(ctx, conv.SessionID)
	if err != nil || sess == nil {
		return ""
	}

	var parts []string

	switch sess.PRStatus {
	case models.PRStatusOpen:
		part := fmt.Sprintf("PR #%d is open", sess.PRNumber)
		if sess.HasCheckFailures {
			part += "; CI checks are failing"
		} else if sess.HasMergeConflict {
			part += "; has merge conflicts"
		}
		parts = append(parts, part)
	case models.PRStatusMerged:
		parts = append(parts, fmt.Sprintf("PR #%d has been merged", sess.PRNumber))
	case models.PRStatusClosed:
		parts = append(parts, fmt.Sprintf("PR #%d was closed", sess.PRNumber))
	}

	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "; ")
}

// generateInputSuggestion uses the AI client to generate a suggested next prompt
// from recent conversation messages, then broadcasts it via WebSocket.
func (m *Manager) generateInputSuggestion(convID string) {
	client := m.newAIClient()
	if client == nil {
		return
	}

	ctx, cancel := context.WithTimeout(m.ctx, 10*time.Second)
	defer cancel()

	// Fetch last 2 messages to find the most recent assistant message
	page, err := m.store.GetConversationMessages(ctx, convID, nil, 2)
	if err != nil || len(page.Messages) == 0 {
		return
	}

	// Find the last assistant message
	var lastAssistant *models.Message
	for i := len(page.Messages) - 1; i >= 0; i-- {
		if page.Messages[i].Role == "assistant" {
			lastAssistant = &page.Messages[i]
			break
		}
	}
	if lastAssistant == nil {
		return
	}

	// Convert tool usage to suggestion tool actions
	var toolActions []ai.SuggestionToolAction
	for _, tool := range lastAssistant.ToolUsage {
		toolActions = append(toolActions, ai.SuggestionToolAction{
			Tool:    tool.Tool,
			Summary: tool.Summary,
			Success: tool.Success,
		})
	}

	// Build session context for PR/git state awareness
	sessionContext := m.buildSessionContext(ctx, convID)

	suggestion, err := client.GenerateInputSuggestion(ctx, ai.SuggestionRequest{
		AgentText:      lastAssistant.Content,
		ToolActions:    toolActions,
		SessionContext: sessionContext,
	})
	if err != nil {
		logger.Manager.Debugf("Failed to generate input suggestion for conv %s: %v", convID, err)
		return
	}

	// Filter out dangerous suggestions (defense in depth)
	if dangerousSuggestionPattern.MatchString(suggestion.GhostText) {
		suggestion.GhostText = ""
	}
	var safePills []ai.SuggestionPill
	for _, pill := range suggestion.Pills {
		if !dangerousSuggestionPattern.MatchString(pill.Value) {
			safePills = append(safePills, pill)
		}
	}
	suggestion.Pills = safePills

	// Only broadcast if there's something to suggest
	if suggestion.GhostText == "" && len(suggestion.Pills) == 0 {
		return
	}

	if m.onConversationEvent != nil {
		m.onConversationEvent(convID, &AgentEvent{
			Type:      EventTypeInputSuggestion,
			GhostText: suggestion.GhostText,
			Pills:     suggestion.Pills,
		})
	}
}

// RegenerateSessionSuggestions re-runs input suggestion generation for all idle
// conversations in a session. Called when PR status changes so suggestions
// reflect the current state (e.g., stop suggesting "Create PR" after one exists).
func (m *Manager) RegenerateSessionSuggestions(ctx context.Context, sessionID string) {
	convs, err := m.store.ListConversations(ctx, sessionID)
	if err != nil {
		logger.Manager.Debugf("Failed to list conversations for suggestion regen (session %s): %v", sessionID, err)
		return
	}

	for _, conv := range convs {
		// Only regenerate for idle conversations (not currently streaming)
		m.mu.RLock()
		proc, hasProc := m.convProcesses[conv.ID]
		m.mu.RUnlock()

		if hasProc && proc.IsRunning() {
			continue // Skip active conversations
		}

		go m.generateInputSuggestion(conv.ID)
	}
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

	// Rename the git branch, preserving the prefix from the original branch name.
	// e.g. "mcastilho/tokyo" -> prefix "mcastilho", "session/tokyo" -> prefix "session"
	oldBranchName := sess.Branch
	var newBranchName string
	if idx := strings.LastIndex(oldBranchName, "/"); idx != -1 {
		prefix := oldBranchName[:idx]
		newBranchName = fmt.Sprintf("%s/%s", prefix, formattedName)
	} else {
		newBranchName = formattedName
	}

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

// SetConversationMaxThinkingTokens changes the max thinking tokens for a running conversation.
func (m *Manager) SetConversationMaxThinkingTokens(convID string, tokens int) error {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || !proc.IsRunning() {
		return fmt.Errorf("no active process for conversation %s", convID)
	}
	return proc.SetMaxThinkingTokens(tokens)
}

// loadEnvVars reads custom environment variables from the settings store.
func (m *Manager) loadEnvVars(ctx context.Context) (map[string]string, error) {
	raw, found, err := m.store.GetSetting(ctx, "env-vars")
	if err != nil {
		return nil, err
	}

	var envMap map[string]string
	if found && raw != "" {
		envMap = store.ParseEnvVars(raw)
	}

	// Load encrypted Anthropic API key if configured
	encrypted, found, err := m.store.GetSetting(ctx, "anthropic-api-key")
	if err != nil {
		return envMap, nil // non-fatal: proceed without the key
	}
	if found && encrypted != "" {
		decrypted, err := crypto.Decrypt(encrypted)
		if err != nil {
			logger.Manager.Errorf("failed to decrypt Anthropic API key: %v", err)
			return envMap, nil
		}
		if envMap == nil {
			envMap = make(map[string]string)
		}
		envMap["ANTHROPIC_API_KEY"] = decrypted
	}

	return envMap, nil
}

// loadMcpServers reads workspace-specific MCP server configs from the settings store.
func (m *Manager) loadMcpServers(ctx context.Context, workspaceID string) (string, error) {
	raw, found, err := m.store.GetSetting(ctx, "mcp-servers:"+workspaceID)
	if err != nil {
		return "", err
	}
	if !found || raw == "" {
		return "", nil
	}
	return raw, nil
}
