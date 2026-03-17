package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/chatml/chatml-backend/ai"
	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

const snapshotDebounceInterval = 500 * time.Millisecond
const initRetryDelay = 3 * time.Second

// prURLPattern matches GitHub PR URLs in tool output (e.g., "https://github.com/owner/repo/pull/123")
// Capture group 1 = PR number.
var prURLPattern = regexp.MustCompile(`github\.com/[^/]+/[^/]+/pull/(\d+)`)

// prJSONPattern matches GitHub API JSON responses that contain a PR URL.
// e.g., {"html_url": "https://github.com/owner/repo/pull/123", ...}
// Capture group 1 = full URL, capture group 2 = PR number.
var prJSONPattern = regexp.MustCompile(`"html_url"\s*:\s*"(https://github\.com/[^/]+/[^/]+/pull/(\d+))"`)

// prCreationCommandPattern matches Bash commands that are likely to create a PR.
// This prevents false positives from commands that merely display PR URLs (e.g., gh pr view, gh pr list).
var prCreationCommandPattern = regexp.MustCompile(`(?:gh\s+pr\s+create|curl\s+.*api\.github\.com.*/pulls)`)

// prMergedPattern matches merge confirmation messages in Bash stdout (e.g., "Merged pull request", "successfully merged")
var prMergedPattern = regexp.MustCompile(`(?i)(merged\s+pull\s+request|pull\s+request\s+.+\s+was\s+already\s+merged|successfully\s+merged)`)

// gitPushPattern matches successful git push output in stderr.
// Git writes push confirmation to stderr with patterns like:
//   "* [new branch]      feature -> feature"
//   "   abc1234..def5678  feature -> feature"       (normal push)
//   " + abc1234...def5678 feature -> feature"       (force push)
var gitPushPattern = regexp.MustCompile(`(\[new branch\]|[a-f0-9]+\.\.\.?[a-f0-9]+)\s+.+\s+->\s+`)

// gitPushCommandPattern matches commands that are actually git push (not fetch/pull
// which produce identical stderr patterns). Without this guard, git fetch/pull
// would falsely trigger PR detection.
var gitPushCommandPattern = regexp.MustCompile(`git\s+push\b`)

// dangerousSuggestionPattern matches destructive operations that should never appear in suggestions.
// These operations could break the worktree-based session model or destroy work.
var dangerousSuggestionPattern = regexp.MustCompile(`(?i)(delete\s.*branch|git\s+branch\s+-[dD]|rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|git\s+clean\s+-[fd])`)

// bashCommandPattern matches pill values or ghost text that look like terminal commands.
// Users are chatting with an AI assistant, not typing in a terminal, so suggestions
// should be natural language instructions, not CLI commands.
// Note: short ambiguous words (go, make, cat, ls, cd, rm, mv, cp) are matched with
// subcommand patterns to avoid false positives on natural language like "Make a PR".
var bashCommandPattern = regexp.MustCompile(`(?i)^(git|gh|npm|yarn|pnpm|bun|docker|kubectl|cargo|pip|curl|wget|mkdir|chmod|chown|sudo|brew|apt|yum)\s|(?i)^make\s+(build|dev|test|clean|install|run|all|backend|frontend)\b|(?i)^go\s+(build|test|run|mod|get|install|vet|fmt|generate|clean)\b`)

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
	backendPort     int             // port the Go backend is listening on
	processes       map[string]*Process // keyed by agentID (legacy)
	convProcesses   map[string]*Process // keyed by conversationID
	mu              sync.RWMutex
	autoNameMu      sync.Mutex // serializes AutoNamed claim to prevent duplicate title generation

	// Legacy handlers
	onOutput OutputHandler
	onStatus StatusHandler

	// New conversation handlers
	onConversationEvent  ConversationEventHandler
	onConversationStatus ConversationStatusHandler

	// Session event handler
	onSessionEvent SessionEventHandler

	// Callback fired when agent creates a PR via bash.
	// prNumber and prURL are extracted from the gh pr create stdout when available;
	// they are zero/empty when triggered by git push detection.
	onPRCreated func(sessionID string, prNumber int, prURL string)

	// Callback fired when agent merges a PR via bash (sessionID)
	onPRMerged func(sessionID string)

	// cachedOAuthToken stores an OAuth token propagated from the agent-runner SDK.
	// This serves as a fallback when direct keychain/credentials file access fails
	// (e.g., in release builds where the binary lacks keychain ACL permissions).
	cachedOAuthToken   string
	cachedOAuthTokenMu sync.RWMutex

	// credReadyCh is closed when the first AI credential becomes available.
	// Title generation goroutines wait on this channel instead of failing
	// immediately when newAIClient() returns nil during early startup.
	credReadyCh   chan struct{}
	credReadyOnce sync.Once

	// titleGenSem limits concurrent title generation API calls to avoid
	// bursting when multiple goroutines unblock after credReadyCh closes.
	titleGenSem chan struct{}
}

func NewManager(ctx context.Context, s *store.SQLiteStore, wm *git.WorktreeManager, backendPort int) *Manager {
	return &Manager{
		ctx:             ctx,
		store:           s,
		worktreeManager: wm,
		backendPort:     backendPort,
		processes:       make(map[string]*Process),
		convProcesses:   make(map[string]*Process),
		credReadyCh:     make(chan struct{}),
		titleGenSem:     make(chan struct{}, 3),
	}
}

// Init performs startup cleanup tasks such as resetting stale conversation
// statuses and recovering interrupted messages from a previous unclean shutdown.
// Call after NewManager and before the HTTP server starts accepting requests.
func (m *Manager) Init(ctx context.Context) error {
	if err := m.store.CleanupStaleConversations(ctx); err != nil {
		return fmt.Errorf("failed to cleanup stale conversations: %w", err)
	}
	// Convert orphaned streaming snapshots into persisted assistant messages.
	// This recovers partial agent responses that were lost when the app was
	// killed mid-turn (safety net for when the output handler's flush fails).
	if converted, err := m.store.ConvertSnapshotsToMessages(ctx); err != nil {
		logger.Manager.Errorf("Failed to convert snapshots to messages: %v", err)
	} else if converted > 0 {
		logger.Manager.Infof("Recovered %d interrupted assistant messages from snapshots", converted)
	}
	return nil
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

func (m *Manager) SetOnPRCreated(handler func(sessionID string, prNumber int, prURL string)) {
	m.onPRCreated = handler
}

func (m *Manager) SetOnPRMerged(handler func(sessionID string)) {
	m.onPRMerged = handler
}

// StartConversationOptions contains optional parameters for starting a conversation
type StartConversationOptions struct {
	MaxThinkingTokens int                 // Enable extended thinking with this token budget
	Effort            string              // Reasoning effort: low, medium, high, max
	Attachments       []models.Attachment // File attachments for the initial message
	PlanMode          bool                // Start agent in plan mode
	FastMode          bool                // Enable fast output mode (Opus 4.6+)
	Instructions      string              // Additional instructions (e.g., from conversation summaries)
	Model             string              // Model name override (e.g., "claude-opus-4-6", "claude-sonnet-4-6")
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
		WorkspaceID:         session.WorkspaceID, // Backend workspace ID for MCP tools
		BackendSessionID:    sessionID,           // Backend session ID for MCP tools
		EnableCheckpointing: true,
		SettingSources:      "project,user,local", // Load all settings scopes so SDK discovers user plugins/skills
	}

	// Always pass the effective target branch to the agent-runner so it doesn't
	// need to independently detect the base branch (which could disagree with the backend).
	procOpts.TargetBranch = sessionWithWs.EffectiveTargetBranch()

	// Apply optional parameters
	if opts != nil {
		procOpts.MaxThinkingTokens = opts.MaxThinkingTokens
		procOpts.Effort = opts.Effort
		procOpts.PlanMode = opts.PlanMode
		procOpts.FastMode = opts.FastMode
		procOpts.Model = opts.Model
	}

	// Enable 1M context window for models that support it
	procOpts.Betas = betasForModel(procOpts.Model)

	// Build combined system instructions: app context + custom instructions + conversation summaries
	var existingInstructions string
	if opts != nil {
		existingInstructions = opts.Instructions
	}
	procOpts.Instructions = m.buildSystemInstructions(ctx, session, sessionWithWs, existingInstructions)

	// Load custom environment variables from settings
	envVars, err := m.loadEnvVars(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to load env vars from settings: %w", err)
	}
	if envVars == nil {
		envVars = make(map[string]string)
	}
	// Inject backend URL so agent-runner connects to the correct port
	envVars["CHATML_BACKEND_URL"] = fmt.Sprintf("http://127.0.0.1:%d", m.backendPort)
	procOpts.EnvVars = envVars

	// Load workspace MCP server configs from settings
	mcpJSON, err := m.loadMcpServers(ctx, session.WorkspaceID)
	if err != nil {
		logger.Manager.Errorf("Failed to load MCP servers for workspace %s: %v", session.WorkspaceID, err)
		// Non-fatal: continue without user-configured MCP servers
	}
	if mcpJSON != "" {
		procOpts.McpServersJSON = mcpJSON
	}

	// Check .mcp.json trust for this workspace — skip loading unless explicitly trusted.
	// Also respect the global "never load" kill switch.
	neverLoadDotMcp, _, _ := m.store.GetSetting(ctx, "never-load-dot-mcp")
	dotMcpTrust, _, _ := m.store.GetSetting(ctx, "dot-mcp-trust:"+session.WorkspaceID)
	if neverLoadDotMcp == "true" || dotMcpTrust != "trusted" {
		procOpts.SkipDotMcp = true
	}

	// Build programmatic agent definitions from workspace settings
	agentsJSON := BuildAgentDefinitions(ctx, m.store.GetSetting, session.WorkspaceID, sessionWithWs.EffectiveTargetBranch())
	if agentsJSON != "" {
		procOpts.AgentsJSON = agentsJSON
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

	// Auto-transition session taskStatus from "backlog" to "in_progress" when agent starts working
	if session.TaskStatus == models.TaskStatusBacklog {
		if err := m.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
			if s.TaskStatus == models.TaskStatusBacklog {
				s.TaskStatus = models.TaskStatusInProgress
			}
		}); err != nil {
			logger.Manager.Errorf("Failed to auto-update taskStatus for session %s: %v", sessionID, err)
		} else if m.onSessionEvent != nil {
			m.onSessionEvent(sessionID, map[string]interface{}{
				"type":       "session_task_status_update",
				"taskStatus": models.TaskStatusInProgress,
			})
		}
	}

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

		// Generate session title from the user's first message.
		// Only task conversations should name the session — review/chat messages
		// would produce misleading branch names (e.g. "review-code-quality").
		// claimAutoName atomically checks+sets AutoNamed to prevent duplicates.
		if conversationType == models.ConversationTypeTask && m.claimAutoName(ctx, sessionID) {
			go m.generateAndApplySessionTitle(sessionID, convID, initialMessage)
		}
	}

	return conv, nil
}

// storePendingUserMessage persists a previously-deferred user message to the DB.
// Returns false if pending is nil (nothing to store).
func (m *Manager) storePendingUserMessage(ctx context.Context, convID string, pending *models.Message) bool {
	if pending == nil {
		return false
	}
	if err := m.store.AddMessageToConversation(ctx, convID, *pending); err != nil {
		logger.Manager.Errorf("Failed to store deferred user message for conv %s: %v", convID, err)
	}
	if len(pending.Attachments) > 0 {
		if err := m.store.SaveAttachments(ctx, pending.ID, pending.Attachments); err != nil {
			logger.Manager.Errorf("Failed to save attachments for deferred message: %v", err)
		}
	}
	return true
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
	var currentThinking string // Accumulated thinking for snapshot/backwards compat
	var pendingPlanContent string
	var pendingPlanTimestamp time.Time
	var pendingCheckpointUuid string
	var isThinking bool
	var snapshotDirty bool
	// Pending interaction state for snapshot recovery after app restart
	var pendingPlanApprovalSnapshot *PendingPlanApprovalSnapshot
	var pendingUserQuestionSnapshot *PendingUserQuestionSnapshot

	// Per-turn accumulation for message persistence (Phase 3)
	var completedTools []models.ToolUsageRecord
	toolStartTimes := make(map[string]time.Time)
	type textSegment struct {
		content   string
		timestamp time.Time
	}
	type thinkingBlock struct {
		content   string
		timestamp time.Time
	}
	var textSegments []textSegment
	var thinkingBlocks []thinkingBlock
	var currentThinkingText string
	var thinkingBlockStart *time.Time
	var currentSegmentText string
	var currentSegmentStart *time.Time
	turnStartTime := time.Now()

	// Turn-start metadata captured from init event for timeline status entry
	var turnModel string
	var turnPermissionMode string

	// Track PR-related tool activity for deferred re-check at turn end.
	// The initial check at tool_end often races with GitHub's eventual
	// consistency; a second check after the turn gives GitHub time to
	// propagate the change.
	var prDeferredRecheck func(sessionID string, prNumber int, prURL string)
	var prActivitySessionID string
	var prActivityNumber int
	var prActivityURL string

	// maxOutputSize limits stdout/stderr stored per tool to prevent DB bloat
	const maxOutputSize = 100 * 1024
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

	// flushSnapshot writes the current streaming state to the DB.
	// Accepts an explicit context so callers can provide a detached context
	// during shutdown (when the app-level ctx is already cancelled).
	flushSnapshot := func(flushCtx context.Context) {
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
			Text:                currentAssistantMessage,
			TextSegments:        snapshotSegments,
			ActiveTools:         tools,
			Thinking:            currentThinking,
			IsThinking:          isThinking,
			PlanModeActive:      proc.IsPlanModeActive(),
			SubAgents:           subAgents,
			PendingPlanApproval: pendingPlanApprovalSnapshot,
			PendingUserQuestion: pendingUserQuestionSnapshot,
		}
		data, err := json.Marshal(snapshot)
		if err != nil {
			logger.Manager.Errorf("Failed to marshal streaming snapshot for conv %s: %v", convID, err)
			return
		}
		if err := m.store.SetStreamingSnapshot(flushCtx, convID, data); err != nil {
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
			case EventTypeReady:
				logger.Manager.Infof("Conversation %s: agent ready", convID)

			case EventTypeAssistantText:
				// Seal thinking block when text starts
				if thinkingBlockStart != nil && currentThinkingText != "" {
					thinkingBlocks = append(thinkingBlocks, thinkingBlock{content: currentThinkingText, timestamp: *thinkingBlockStart})
					currentThinkingText = ""
					thinkingBlockStart = nil
				}
				isThinking = false

				// Mark that a turn is actively producing output (for user message deferral logic)
				proc.SetInActiveTurn(true)
				// Track that the process produced user-visible output (for zero-output detection)
				proc.SetProducedOutput()
				currentAssistantMessage += event.Content
				// Track text segments for timeline persistence
				if currentSegmentStart == nil {
					now := time.Now()
					currentSegmentStart = &now
				}
				currentSegmentText += event.Content
				markSnapshotDirty()

			case EventTypeToolStart:
				proc.SetInActiveTurn(true)
				entry := ActiveToolEntry{
					ID:        event.ID,
					Tool:      event.Tool,
					Params:    event.Params,
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

			case EventTypeThinkingStart:
				proc.SetInActiveTurn(true)
				// Seal previous thinking block if any
				if thinkingBlockStart != nil && currentThinkingText != "" {
					thinkingBlocks = append(thinkingBlocks, thinkingBlock{content: currentThinkingText, timestamp: *thinkingBlockStart})
				}
				now := time.Now()
				thinkingBlockStart = &now
				currentThinkingText = ""
				isThinking = true
				markSnapshotDirty()

			case EventTypeThinking, EventTypeThinkingDelta:
				if thinkingBlockStart == nil {
					now := time.Now()
					thinkingBlockStart = &now
				}
				currentThinkingText += event.Content
				currentThinking += event.Content
				isThinking = true
				markSnapshotDirty()

			case EventTypeToolEnd:
				// Capture tool params before they're removed from the active map.
				// Needed by PR detection logic below, which runs outside the if/else.
				var toolParams map[string]interface{}
				if te, ok := activeToolsMap[event.ID]; ok {
					toolParams = te.Params
				}

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
					toolEntry, entryOk := activeToolsMap[event.ID]
				if !entryOk {
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
						Params:     toolEntry.Params,
						Success:    &success,
						Summary:    event.Summary,
						DurationMs: durationMs,
						Stdout:     truncateOutput(event.Stdout),
						Stderr:     truncateOutput(event.Stderr),
						Metadata:   event.Metadata,
						StartTime:  toolStart,
					})
				}
				markSnapshotDirty()

				// Clear pending interaction state when the tool completes
				// (the hook resolved — user approved/answered or it was denied/timed out)
				if event.Tool == "ExitPlanMode" {
					pendingPlanApprovalSnapshot = nil
				}
				if event.Tool == "AskUserQuestion" {
					pendingUserQuestionSnapshot = nil
				}

				// Store tool action in summary (legacy flat list)
				if err := m.store.AddToolActionToConversation(ctx, convID, models.ToolAction{
					ID:      event.ID,
					Tool:    event.Tool,
					Target:  event.Summary,
					Success: event.Success,
				}); err != nil {
					logger.Manager.Errorf("Failed to store tool action for conv %s: %v", convID, err)
				}

				// Extract bash command for use in PR creation and git push detection below.
				var bashCmd string
				if event.Tool == "Bash" {
					bashCmd, _ = toolParams["command"].(string)
				}

				// Detect PR creation from Bash tool output (e.g., gh pr create, curl).
				// Only trigger for commands that actually create PRs to avoid false
				// positives from commands that merely display PR URLs (gh pr view, etc.).
				if event.Tool == "Bash" && event.Success {
					// Check if the command looks like a PR creation command
					if prCreationCommandPattern.MatchString(bashCmd) {
						var prNum int
						var prURL string

						// Check stdout first (most common: gh pr create prints URL to stdout)
						if match := prURLPattern.FindStringSubmatch(event.Stdout); match != nil {
							num, err := strconv.Atoi(match[1])
							if err != nil {
								logger.Manager.Warnf("Failed to parse PR number from URL match %q: %v", match[1], err)
							} else {
								prNum = num
								prURL = "https://" + match[0]
							}
						} else if match := prURLPattern.FindStringSubmatch(event.Stderr); match != nil {
							// Fallback: check stderr (some tools write there)
							num, err := strconv.Atoi(match[1])
							if err == nil {
								prNum = num
								prURL = "https://" + match[0]
							}
						} else if jsonMatch := prJSONPattern.FindStringSubmatch(event.Stdout); jsonMatch != nil {
							// Fallback: detect PR from GitHub API JSON response (e.g., curl)
							num, err := strconv.Atoi(jsonMatch[2])
							if err == nil {
								prNum = num
								prURL = jsonMatch[1]
							}
						}

						if prNum > 0 && m.onPRCreated != nil {
							conv, convErr := m.store.GetConversationMeta(ctx, convID)
							if convErr != nil {
								logger.Manager.Warnf("Failed to get conversation %s for PR creation detection: %v", convID, convErr)
							}
							if conv != nil {
								go m.onPRCreated(conv.SessionID, prNum, prURL)
								prDeferredRecheck = m.onPRCreated
								prActivitySessionID = conv.SessionID
								prActivityNumber = prNum
								prActivityURL = prURL
							}
						}
					}
				}

				// Detect PR merge from Bash tool stdout (e.g., gh pr merge)
				if event.Tool == "Bash" && event.Success && prMergedPattern.MatchString(event.Stdout) {
					if m.onPRMerged != nil {
						conv, convErr := m.store.GetConversationMeta(ctx, convID)
						if convErr != nil {
							logger.Manager.Warnf("Failed to get conversation %s for PR merge detection: %v", convID, convErr)
						}
						if conv != nil {
							go m.onPRMerged(conv.SessionID)
							mergeHandler := m.onPRMerged
							prDeferredRecheck = func(sid string, _ int, _ string) { mergeHandler(sid) }
							prActivitySessionID = conv.SessionID
							prActivityNumber = 0
							prActivityURL = ""
						}
					}
				}

				// Detect successful git push from Bash tool stderr.
				// Git writes push confirmation to stderr (not stdout) with patterns like
				// "* [new branch] feature -> feature" or "abc123..def456 feature -> feature".
				// IMPORTANT: git fetch and git pull produce identical stderr patterns, so we
				// also check the command string to avoid false positives.
				// When a push is detected and the session has no PR linked yet,
				// trigger an immediate PR check to pick up externally-created PRs.
				if event.Tool == "Bash" && event.Success && gitPushCommandPattern.MatchString(bashCmd) && gitPushPattern.MatchString(event.Stderr) {
					if m.onPRCreated != nil {
						conv, convErr := m.store.GetConversationMeta(ctx, convID)
						if convErr != nil {
							logger.Manager.Warnf("Failed to get conversation %s for git push detection: %v", convID, convErr)
						}
						if conv != nil {
							sess, _ := m.store.GetSession(ctx, conv.SessionID)
							if sess != nil && sess.PRNumber == 0 {
								logger.Manager.Infof("Detected git push for session %s (no PR yet), triggering PR check", conv.SessionID)
								go m.onPRCreated(conv.SessionID, 0, "")
								prDeferredRecheck = m.onPRCreated
								prActivitySessionID = conv.SessionID
								prActivityNumber = 0
								prActivityURL = ""
							}
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

			case EventTypeSubagentUsage:
				// Correlate usage data with sub-agent via parentToolUseId matching event.ToolUseId
				if event.ToolUseId != "" && event.Usage != nil {
					usage := parseSubAgentUsage(event.Usage)
					if usage != nil {
						for _, sa := range activeSubAgents {
							if sa.ParentToolUseId == event.ToolUseId {
								sa.Usage = usage
								markSnapshotDirty()
								break
							}
						}
					}
				}

			case EventTypeSubagentOutput:
				if sa, ok := activeSubAgents[event.AgentId]; ok {
					sa.Output = event.AgentOutput
					markSnapshotDirty()
				}

			case EventTypeRateLimit:
				// Forward rate limit info to frontend for user notification banner
				markSnapshotDirty()

			case EventTypeTaskStarted:
				// Background task (sub-agent) started — forward to frontend for progress tracking
				markSnapshotDirty()

			case EventTypeTaskProgress:
				// Background task (sub-agent) progress update — forward to frontend
				markSnapshotDirty()

			case EventTypeTaskStopped:
				// Background task was stopped by user request
				markSnapshotDirty()

			case EventTypeFilesPersisted:
				// File checkpoint persisted to disk — additional checkpoint confirmation signal
				logger.Manager.Debugf("[%s] Files persisted for session %s", convID, event.SessionID)

			case EventTypeUserQuestionRequest:
				// Track pending question for snapshot recovery after app restart
				pendingUserQuestionSnapshot = &PendingUserQuestionSnapshot{
					RequestID: event.RequestID,
					Questions: event.Questions,
					Timestamp: time.Now().UnixMilli(),
				}
				markSnapshotDirty()
				flushSnapshot(ctx) // Force immediate flush — don't wait for debounce

			case EventTypePlanApprovalRequest:
				pendingPlanContent = event.PlanContent
				pendingPlanTimestamp = time.Now()
				// Track pending approval for snapshot recovery after app restart
				pendingPlanApprovalSnapshot = &PendingPlanApprovalSnapshot{
					RequestID:   event.RequestID,
					PlanContent: event.PlanContent,
					Timestamp:   time.Now().UnixMilli(),
				}
				markSnapshotDirty()
				flushSnapshot(ctx) // Force immediate flush — don't wait for debounce

			case EventTypeCheckpointCreated:
				if event.CheckpointUuid != "" {
					pendingCheckpointUuid = event.CheckpointUuid
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
				// Atomically clear the active turn flag and take any deferred
				// user message. Store BEFORE the assistant message so the DB
				// position ordering is: [queued_user_N, assistant_N+1].
				// This must be atomic so a concurrent SendConversationMessage
				// cannot slip a new message between clearing the flag and
				// flushing the old deferred one.
				pending := proc.EndTurnAndTakePending()
				m.storePendingUserMessage(ctx, convID, pending)

				// Store accumulated message and reset streaming state.
				if currentAssistantMessage != "" {
					// Seal final text segment
					if currentSegmentStart != nil && currentSegmentText != "" {
						textSegments = append(textSegments, textSegment{
							content:   currentSegmentText,
							timestamp: *currentSegmentStart,
						})
					}
					// Seal any in-progress thinking block
					if thinkingBlockStart != nil && currentThinkingText != "" {
						thinkingBlocks = append(thinkingBlocks, thinkingBlock{content: currentThinkingText, timestamp: *thinkingBlockStart})
						currentThinkingText = ""
						thinkingBlockStart = nil
					}

					// Build interleaved timeline from text segments, thinking blocks, and completed tools.
					// sortPriority breaks ties when timestamps are equal: lower values sort first.
					type timelineItem struct {
						timestamp    time.Time
						sortPriority int // 0 = status/config, 1 = default
						entry        models.TimelineEntry
					}
					var items []timelineItem
					for _, seg := range textSegments {
						items = append(items, timelineItem{
							timestamp:    seg.timestamp,
							sortPriority: 1,
							entry:        models.TimelineEntry{Type: "text", Content: seg.content},
						})
					}
					for _, block := range thinkingBlocks {
						items = append(items, timelineItem{
							timestamp:    block.timestamp,
							sortPriority: 1,
							entry:        models.TimelineEntry{Type: "thinking", Content: block.content},
						})
					}
					for _, tool := range completedTools {
						ts := tool.StartTime
						if ts.IsZero() {
							ts = time.Now() // fallback
						}
						items = append(items, timelineItem{
							timestamp:    ts,
							sortPriority: 1,
							entry:        models.TimelineEntry{Type: "tool", ToolID: tool.ID},
						})
					}
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
					// Add approved plan content to timeline at its chronological position
					if planContent != "" && !pendingPlanTimestamp.IsZero() {
						items = append(items, timelineItem{
							timestamp:    pendingPlanTimestamp,
							sortPriority: 1,
							entry:        models.TimelineEntry{Type: "plan", Content: planContent},
						})
					}
					// Add turn-start configuration status entry
					if turnModel != "" {
						var parts []string
						parts = append(parts, turnModel)
						if turnPermissionMode == "plan" {
							parts = append(parts, "plan mode")
						}
						statusContent := strings.Join(parts, " · ")
						items = append(items, timelineItem{
							timestamp:    turnStartTime,
							sortPriority: 0, // Sort before other items at the same timestamp
							entry:        models.TimelineEntry{Type: "status", Content: statusContent, Variant: "config"},
						})
					}
					sort.Slice(items, func(i, j int) bool {
						if items[i].timestamp.Equal(items[j].timestamp) {
							return items[i].sortPriority < items[j].sortPriority
						}
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

					// Build RunSummary for result events so it persists to the DB
					var runSummary *models.RunSummary
					if event.Type == EventTypeResult {
						runSummary = &models.RunSummary{
							Success:    event.Success,
							Cost:       event.Cost,
							Turns:      event.Turns,
							DurationMs: durationMs,
							Errors:     toAnySlice(event.Errors),
						}
						if event.Stats != nil {
							runSummary.Stats = &models.RunStats{
								ToolCalls:           event.Stats.ToolCalls,
								ToolsByType:         event.Stats.ToolsByType,
								SubAgents:           event.Stats.SubAgents,
								FilesRead:           event.Stats.FilesRead,
								FilesWritten:        event.Stats.FilesWritten,
								BashCommands:        event.Stats.BashCommands,
								WebSearches:         event.Stats.WebSearches,
								TotalToolDurationMs: int(event.Stats.TotalToolDurationMs),
							}
						}
						if event.Usage != nil {
							runSummary.Usage = parseTokenUsage(event.Usage)
						}
						if event.ModelUsage != nil {
							runSummary.ModelUsage = parseModelUsage(event.ModelUsage)
						}
						switch event.Subtype {
						case "error_max_budget_usd":
							runSummary.LimitExceeded = "budget"
						case "error_max_turns":
							runSummary.LimitExceeded = "turns"
						}
					}

					if err := m.store.AddMessageToConversation(ctx, convID, models.Message{
						ID:              uuid.New().String()[:8],
						Role:            "assistant",
						Content:         currentAssistantMessage,
						ToolUsage:       completedTools,
						ThinkingContent: currentThinking,
						PlanContent:     planContent,
						CheckpointUuid:  pendingCheckpointUuid,
						DurationMs:      durationMs,
						Timeline:        timeline,
						RunSummary:      runSummary,
						Timestamp:       time.Now(),
					}); err != nil {
						logger.Manager.Errorf("Failed to store assistant message for conv %s: %v", convID, err)
					}
					currentAssistantMessage = ""
				}

				// Reset per-turn accumulation state
				currentThinking = ""
				pendingPlanContent = ""
				pendingPlanTimestamp = time.Time{}
				pendingCheckpointUuid = ""
				isThinking = false
				pendingPlanApprovalSnapshot = nil
				pendingUserQuestionSnapshot = nil
				thinkingBlocks = nil
				currentThinkingText = ""
				thinkingBlockStart = nil
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

				// Deferred PR re-check: if PR activity was detected during this turn,
				// schedule a second check after a short delay. The initial check at
				// tool_end often races with GitHub's eventual consistency; by
				// turn_complete the agent has spent a few more seconds generating
				// its response, and the additional 2-second delay provides further margin.
				if prDeferredRecheck != nil && prActivitySessionID != "" {
					recheck := prDeferredRecheck
					sessionID := prActivitySessionID
					prNum := prActivityNumber
					prURL := prActivityURL
					go func() {
						time.Sleep(2 * time.Second)
						recheck(sessionID, prNum, prURL)
					}()
					prDeferredRecheck = nil
					prActivitySessionID = ""
					prActivityNumber = 0
					prActivityURL = ""
				}
			}

			// Forward event to handler
			if m.onConversationEvent != nil {
				m.onConversationEvent(convID, event)
			}

			// After init, request the full slash command list from the SDK.
			// The init event may have slash_commands but it can be empty if
			// skills haven't been discovered yet. The supported_commands
			// response provides the authoritative, enriched command list.
			if event.Type == EventTypeInit {
				// Capture turn-start metadata for timeline status entry
				if event.Model != "" {
					turnModel = event.Model
				}
				if event.PermissionMode != "" {
					turnPermissionMode = event.PermissionMode
				}

				// When the SDK authenticates, try to cache its credentials so
				// the Go backend can also make lightweight AI calls (session
				// titles, suggestions). In release builds, the backend's own
				// credential discovery often fails (no env var, keychain ACL
				// blocked), but the SDK may have refreshed the credentials file.
				if event.ApiKeySource != "" {
					go m.refreshCachedCredentials(event.ApiKeySource)
				}

				if err := proc.GetSupportedCommands(); err != nil {
					logger.Manager.Errorf("Conversation %s: failed to request supported commands: %v", convID, err)
				}
				if err := proc.GetSupportedModels(); err != nil {
					logger.Manager.Errorf("Conversation %s: failed to request supported models: %v", convID, err)
				}
				// Retry after delay — plugins may still be loading during init.
				// The frontend merges responses, so a second call enriches rather
				// than overwrites the first result.
				// Look up proc by convID instead of capturing the reference so
				// the goroutine doesn't keep a terminated process alive.
				go func(cID string) {
					time.Sleep(initRetryDelay)
					if p := m.GetConversationProcess(cID); p != nil && p.IsRunning() {
						if err := p.GetSupportedCommands(); err != nil {
							logger.Manager.Debugf("Conversation %s: retry GetSupportedCommands failed: %v", cID, err)
						}
						if err := p.GetSupportedModels(); err != nil {
							logger.Manager.Debugf("Conversation %s: retry GetSupportedModels failed: %v", cID, err)
						}
					}
				}(convID)
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
			flushSnapshot(ctx)

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

		case <-ctx.Done():
			// App shutting down — force-flush the latest snapshot state with a
			// detached context so ConvertSnapshotsToMessages can recover it on
			// next startup (safety net for SIGKILL after this point).
			logger.Manager.Warnf("Conversation %s: context cancelled, force-flushing snapshot before exit", convID)
			shutdownFlushCtx, shutdownFlushCancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			snapshotDirty = true
			flushSnapshot(shutdownFlushCtx)
			shutdownFlushCancel()
			break outer
		}
	}

	// Use a detached context for final persistence — the app-level context may
	// already be cancelled due to SIGTERM, but we need to fit within the 2-second
	// sidecar grace period (shared with handleConversationCompletion's goroutine).
	flushCtx, flushCancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer flushCancel()

	// Atomically clear active turn flag and flush any remaining deferred user
	// message. Store BEFORE the assistant message so the DB position ordering
	// is: [queued_user_N, assistant_N+1].
	pendingFinal := proc.EndTurnAndTakePending()
	m.storePendingUserMessage(flushCtx, convID, pendingFinal)

	// Store any remaining assistant message (with full enrichment)
	if currentAssistantMessage != "" {
		// Seal any in-progress text segment
		if currentSegmentText != "" && currentSegmentStart != nil {
			textSegments = append(textSegments, textSegment{content: currentSegmentText, timestamp: *currentSegmentStart})
			currentSegmentText = ""
			currentSegmentStart = nil
		}
		// Seal any in-progress thinking block
		if thinkingBlockStart != nil && currentThinkingText != "" {
			thinkingBlocks = append(thinkingBlocks, thinkingBlock{content: currentThinkingText, timestamp: *thinkingBlockStart})
			currentThinkingText = ""
			thinkingBlockStart = nil
		}

		// Build timeline from text segments, thinking blocks, and completed tools
		var timeline []models.TimelineEntry
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

		if len(textSegments) > 0 || len(completedTools) > 0 || len(thinkingBlocks) > 0 || finalPlanContent != "" {
			type timelineItem struct {
				timestamp time.Time
				entry     models.TimelineEntry
			}
			var items []timelineItem
			for _, seg := range textSegments {
				items = append(items, timelineItem{timestamp: seg.timestamp, entry: models.TimelineEntry{Type: "text", Content: seg.content}})
			}
			for _, block := range thinkingBlocks {
				items = append(items, timelineItem{timestamp: block.timestamp, entry: models.TimelineEntry{Type: "thinking", Content: block.content}})
			}
			for _, tool := range completedTools {
				ts := tool.StartTime
				if ts.IsZero() {
					ts = time.Now()
				}
				items = append(items, timelineItem{timestamp: ts, entry: models.TimelineEntry{Type: "tool", ToolID: tool.ID}})
			}
			// Add approved plan content to timeline at its chronological position
			if finalPlanContent != "" && !pendingPlanTimestamp.IsZero() {
				items = append(items, timelineItem{timestamp: pendingPlanTimestamp, entry: models.TimelineEntry{Type: "plan", Content: finalPlanContent}})
			}
			sort.Slice(items, func(i, j int) bool { return items[i].timestamp.Before(items[j].timestamp) })
			timeline = make([]models.TimelineEntry, len(items))
			for i, item := range items {
				timeline[i] = item.entry
			}
		}

		durationMs := int(time.Since(turnStartTime).Milliseconds())

		if err := m.store.AddMessageToConversation(flushCtx, convID, models.Message{
			ID:              uuid.New().String()[:8],
			Role:            "assistant",
			Content:         currentAssistantMessage,
			ToolUsage:       completedTools,
			ThinkingContent: currentThinking,
			PlanContent:     finalPlanContent,
			CheckpointUuid:  pendingCheckpointUuid,
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
		if err := m.store.ClearStreamingSnapshot(flushCtx, convID); err != nil {
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
// Uses a detached context for persistence so data is flushed even during shutdown.
func (m *Manager) handleConversationCompletion(convID string, proc *Process) {
	ctx := m.ctx
	appShutdown := false
	select {
	case <-proc.Done():
	case <-ctx.Done():
		// App shutting down — don't return immediately. Give the process a brief
		// window to exit so we can still synthesize error messages if needed.
		logger.Manager.Warnf("App shutting down, waiting briefly for process exit on conversation %s", convID)
		appShutdown = true
		select {
		case <-proc.Done():
		case <-time.After(300 * time.Millisecond):
			logger.Manager.Warnf("Process for conversation %s did not exit in time during shutdown", convID)
		}
	}

	// Use a detached context for persistence — fits within the 2-second sidecar
	// grace period (shared with handleConversationOutput's goroutine).
	flushCtx, flushCancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer flushCancel()

	exitErr := proc.ExitError()
	var synthesizedError string

	if exitErr != nil {
		logger.Manager.Warnf("Conversation %s process exited with error: %v", convID, exitErr)

		// If the agent-runner didn't emit its own error event, synthesize one
		// so the frontend shows a useful message instead of silently going idle.
		if !proc.SawErrorEvent() {
			stderrLines := proc.LastStderrLines()
			synthesizedError = "Claude Code process exited with code 1"
			if len(stderrLines) > 0 {
				synthesizedError += ": " + strings.Join(stderrLines, "\n")
			}
		}
	} else if appShutdown {
		logger.Manager.Infof("Conversation %s process exited during app shutdown, skipping error synthesis", convID)
	} else {
		logger.Manager.Infof("Conversation %s process exited cleanly", convID)
	}

	// Safety net: if the process exited (cleanly or not) without producing any
	// assistant output AND without an error event, synthesize a user-visible error.
	// This prevents the conversation from going silently idle with zero feedback.
	// Only fires if the crash fallback above didn't already synthesize an error.
	// Skip during app shutdown — the partial output is handled by handleConversationOutput.
	if synthesizedError == "" && !appShutdown && !proc.ProducedOutput() && !proc.SawErrorEvent() {
		stderrLines := proc.LastStderrLines()
		synthesizedError = "The agent process exited without producing any response"
		if len(stderrLines) > 0 {
			synthesizedError += ": " + strings.Join(stderrLines, "\n")
		}
		logger.Manager.Warnf("Conversation %s zero-output safety net triggered", convID)
	}

	// Persist the synthesized error as an assistant message so it survives app
	// restarts, and broadcast it via WebSocket for immediate display.
	if synthesizedError != "" {
		if err := m.store.AddMessageToConversation(flushCtx, convID, models.Message{
			ID:        uuid.New().String()[:8],
			Role:      "assistant",
			Content:   synthesizedError,
			Timeline:  []models.TimelineEntry{{Type: "text", Content: synthesizedError}},
			Timestamp: time.Now(),
		}); err != nil {
			logger.Manager.Errorf("Failed to persist synthesized error for conv %s: %v", convID, err)
		}
		if m.onConversationEvent != nil {
			m.onConversationEvent(convID, &AgentEvent{
				Type:    EventTypeError,
				Message: synthesizedError,
			})
		}
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
func (m *Manager) SendConversationMessage(ctx context.Context, convID, message string, attachments []models.Attachment, planMode *bool) error {
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
		// Always ensure backend IDs are set for MCP tools (may be missing from old opts)
		if restartOpts.WorkspaceID == "" {
			restartOpts.WorkspaceID = session.WorkspaceID
		}
		if restartOpts.BackendSessionID == "" {
			restartOpts.BackendSessionID = conv.SessionID
		}
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

		// Apply plan mode override from the message request. This covers the
		// edge case where the process was fully removed from the map (so
		// SetConversationPlanMode had no process to update).
		if planMode != nil {
			restartOpts.PlanMode = *planMode
		}

		// Check if we should generate a title for this session.
		// Only task conversations should name the session — review/chat messages
		// would produce misleading branch names (e.g. "review-code-quality").
		if message != "" && conv.Type == models.ConversationTypeTask && m.claimAutoName(ctx, conv.SessionID) {
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

			// Auto-transition session taskStatus from "backlog" to "in_progress"
			if session.TaskStatus == models.TaskStatusBacklog {
				if err := m.store.UpdateSession(ctx, conv.SessionID, func(s *models.Session) {
					if s.TaskStatus == models.TaskStatusBacklog {
						s.TaskStatus = models.TaskStatusInProgress
					}
				}); err != nil {
					logger.Manager.Errorf("Failed to auto-update taskStatus for session %s: %v", conv.SessionID, err)
				} else if m.onSessionEvent != nil {
					m.onSessionEvent(conv.SessionID, map[string]interface{}{
						"type":       "session_task_status_update",
						"taskStatus": models.TaskStatusInProgress,
					})
				}
			}

			proc = newProc
		}
	} else {
		m.mu.Unlock()
	}

	// Retry title generation if a previous attempt failed and reset AutoNamed.
	// The needsRestart path above only checks claimAutoName during process restart,
	// so subsequent messages to an already-running process would never retry.
	// Only task conversations should name the session — review/chat messages
	// would produce misleading branch names (e.g. "review-code-quality").
	if !shouldGenerateTitle && message != "" {
		convMeta, err := m.store.GetConversationMeta(ctx, convID)
		if err != nil {
			logger.Manager.Debugf("Failed to get conversation meta for title retry (conv %s): %v", convID, err)
		} else if convMeta != nil && convMeta.Type == models.ConversationTypeTask {
			sessionID := convMeta.SessionID
			if sessionID != "" && m.claimAutoName(ctx, sessionID) {
				shouldGenerateTitle = true
				titleSessionID = sessionID
				logger.Manager.Infof("Will retry title generation for session %s (conv %s)", sessionID, convID)
			}
		}
	}

	// Store user message with attachments.
	// Three cases:
	//  1. needsRestart=true  — process was restarted/freshly started, no active turn.
	//     Store immediately so the user message precedes the assistant response.
	//  2. needsRestart=false, process idle between turns — store immediately.
	//     Same reasoning as case 1.
	//  3. needsRestart=false, process mid-turn (inActiveTurn=true) — defer storage
	//     until the current turn completes. The queued user message is flushed
	//     before the assistant response so the user bubble renders first:
	//     [queued_user_N, assistant_N+1].
	msg := models.Message{
		ID:          uuid.New().String()[:8],
		Role:        "user",
		Content:     message,
		Attachments: attachments,
		Timestamp:   time.Now(),
	}
	// StoreOrDeferMessage atomically checks inActiveTurn and either defers
	// (returns false) or signals store-now (returns true). Short-circuits
	// when needsRestart is true — the process was just created (proc = newProc
	// above), so inActiveTurn is false and pendingUserMessage is nil by default.
	storeNow := needsRestart || proc.StoreOrDeferMessage(&msg)
	if storeNow {
		if err := m.store.AddMessageToConversation(ctx, convID, msg); err != nil {
			logger.Manager.Errorf("Failed to store user message for conv %s: %v", convID, err)
		}
		if len(attachments) > 0 {
			if err := m.store.SaveAttachments(ctx, msg.ID, attachments); err != nil {
				logger.Manager.Errorf("Failed to save attachments: %v", err)
			}
		}
	}

	// Send to process with attachments
	logger.Manager.Infof("Sending message to conv %s (content=%d chars, attachments=%d, processRestarted=%v)",
		convID, len(message), len(attachments), needsRestart)
	if err := proc.SendMessageWithAttachments(message, attachments); err != nil {
		// Discard the pending message — it was never delivered to the agent,
		// so it should not be flushed to the DB later.
		proc.TakePendingUserMessage()
		logger.Manager.Errorf("Failed to send message to conv %s: %v (attachments=%d)", convID, err, len(attachments))
		return err
	}
	logger.Manager.Debugf("Message delivered to conv %s successfully", convID)

	// Generate session title if this is the first message on an idle-started session
	if shouldGenerateTitle {
		go m.generateAndApplySessionTitle(titleSessionID, convID, message)
	}

	return nil
}

// ResumeConversation restarts an interrupted conversation's agent process using
// the SDK resume mechanism. The SDK re-executes the last turn, which re-triggers
// PreToolUse hooks for pending plan approvals or user questions.
func (m *Manager) ResumeConversation(ctx context.Context, convID string) error {
	// Check if a process is already running
	m.mu.RLock()
	existingProc, exists := m.convProcesses[convID]
	m.mu.RUnlock()
	if exists && existingProc.IsRunning() {
		return nil // already running
	}

	conv, err := m.store.GetConversation(ctx, convID)
	if err != nil {
		return fmt.Errorf("failed to get conversation: %w", err)
	}
	if conv == nil {
		return fmt.Errorf("conversation not found: %s", convID)
	}
	if conv.AgentSessionID == "" {
		return fmt.Errorf("no agent session ID available for resume")
	}

	session, err := m.store.GetSession(ctx, conv.SessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session not found: %s", conv.SessionID)
	}

	// Build process options modeled after SendConversationMessage restart path
	opts := ProcessOptions{
		ID:                  convID,
		ConversationID:      convID,
		Workdir:             session.WorktreePath,
		WorkspaceID:         session.WorkspaceID,
		BackendSessionID:    conv.SessionID,
		ResumeSession:       conv.AgentSessionID,
		EnableCheckpointing: true,
		Model:               conv.Model,
		SettingSources:      "project,user,local",
	}

	// Enable 1M context window for models that support it
	opts.Betas = betasForModel(opts.Model)

	// Apply target branch from session
	sessionWithWs, err := m.store.GetSessionWithWorkspace(ctx, conv.SessionID)
	if err != nil {
		logger.Manager.Warnf("Failed to get session with workspace for resume %s: %v", convID, err)
	}
	if sessionWithWs != nil {
		opts.TargetBranch = sessionWithWs.EffectiveTargetBranch()
	}

	// Load env vars and MCP servers (same as StartConversation)
	envVars, err := m.loadEnvVars(ctx, nil)
	if err != nil {
		logger.Manager.Errorf("Failed to load env vars for resume %s: %v", convID, err)
	}
	opts.EnvVars = envVars

	mcpServersJSON, err := m.loadMcpServers(ctx, session.WorkspaceID)
	if err != nil {
		logger.Manager.Errorf("Failed to load MCP servers for resume %s: %v", convID, err)
	}
	opts.McpServersJSON = mcpServersJSON

	// Check .mcp.json trust for this workspace — skip loading unless explicitly trusted.
	// Also respect the global "never load" kill switch.
	neverLoadDotMcp, _, _ := m.store.GetSetting(ctx, "never-load-dot-mcp")
	dotMcpTrust, _, _ := m.store.GetSetting(ctx, "dot-mcp-trust:"+session.WorkspaceID)
	if neverLoadDotMcp == "true" || dotMcpTrust != "trusted" {
		opts.SkipDotMcp = true
	}

	// Build programmatic agent definitions from workspace settings
	if sessionWithWs != nil {
		agentsJSON := BuildAgentDefinitions(ctx, m.store.GetSetting, session.WorkspaceID, sessionWithWs.EffectiveTargetBranch())
		if agentsJSON != "" {
			opts.AgentsJSON = agentsJSON
		}
	}

	// Build system instructions from session context
	opts.Instructions = m.buildSystemInstructions(ctx, session, sessionWithWs, "")

	newProc := NewProcessWithOptions(opts)

	// Double-check under write lock to prevent race
	m.mu.Lock()
	if ep, ok := m.convProcesses[convID]; ok && ep.IsRunning() {
		m.mu.Unlock()
		return nil // another goroutine already started it
	}
	m.convProcesses[convID] = newProc
	m.mu.Unlock()

	if err := newProc.Start(); err != nil {
		m.mu.Lock()
		delete(m.convProcesses, convID)
		m.mu.Unlock()
		return fmt.Errorf("failed to start resumed agent process: %w", err)
	}

	go m.handleConversationOutput(convID, newProc)
	go m.handleConversationCompletion(convID, newProc)

	newStatus := models.ConversationStatusActive
	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Status = newStatus
		c.UpdatedAt = time.Now()
	}); err != nil {
		logger.Manager.Errorf("Failed to update conversation status on resume for %s: %v", convID, err)
	}
	if m.onConversationStatus != nil {
		m.onConversationStatus(convID, newStatus)
	}

	logger.Manager.Infof("Resumed conversation %s with agent session %s", convID, conv.AgentSessionID)
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

	if !ok {
		// Process fully cleaned up — return success; plan mode
		// will be sent with the next message via planMode field.
		return nil
	}

	if proc.IsStopped() || !proc.IsRunning() {
		// Process idle — persist in options so restart picks it up
		proc.SetOptionsPlanMode(enabled)
		return nil
	}

	mode := "bypassPermissions"
	if enabled {
		mode = "plan"
	}

	return proc.SetPermissionMode(mode)
}

// SetConversationFastMode toggles fast output mode for a running conversation
func (m *Manager) SetConversationFastMode(convID string, enabled bool) error {
	m.mu.RLock()
	proc, ok := m.convProcesses[convID]
	m.mu.RUnlock()

	if !ok || proc.IsStopped() || !proc.IsRunning() {
		return nil
	}

	return proc.SetFastMode(enabled)
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

// betasForModel returns comma-separated beta flags for the given model.
// Opus 4.6 and Sonnet 4.6 support 1M context window via the context-1m beta.
func betasForModel(model string) string {
	if strings.Contains(model, "opus-4-6") || strings.Contains(model, "sonnet-4-6") {
		return "context-1m-2025-08-07"
	}
	return ""
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
// 0. AWS Bedrock via Claude Code settings.json or ChatML env vars
// 1. Encrypted API key stored in SQLite settings
// 2. ANTHROPIC_API_KEY environment variable
// 3. Claude Code OAuth token from macOS Keychain
// 4. Claude Code credentials file (~/.claude/.credentials.json)
// 5. Cached OAuth token from agent-runner SDK
// Returns nil if no credentials are available.
func (m *Manager) newAIClient() ai.Provider {
	// Read Claude Code settings once — shared by Bedrock check and env var merge.
	claudeSettings, settingsErr := ai.ReadClaudeCodeSettings()
	if settingsErr != nil {
		logger.Manager.Debugf("Could not read Claude Code settings: %v", settingsErr)
	}

	// Source 0a: AWS Bedrock via Claude Code settings.json
	if client := m.tryBedrockFromClaudeSettings(claudeSettings); client != nil {
		return client
	}

	// Source 0b: AWS Bedrock via ChatML env vars (user-configured in Settings → Advanced)
	envVars, err := m.loadEnvVars(m.ctx, claudeSettings)
	if err != nil {
		logger.Manager.Warnf("Failed to load env vars for AI client: %v", err)
	}
	if client := m.tryBedrockFromEnvVars(envVars, claudeSettings); client != nil {
		return client
	}

	// Source 1: SQLite settings (explicit user-configured API key)
	if envVars != nil {
		if apiKey := envVars["ANTHROPIC_API_KEY"]; apiKey != "" {
			logger.Manager.Debugf("AI client: using API key from settings")
			m.signalCredentialsReady()
			return ai.NewClient(apiKey)
		}
	}

	// Source 2: Process environment variable
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		logger.Manager.Debugf("AI client: using API key from environment")
		m.signalCredentialsReady()
		return ai.NewClient(apiKey)
	}

	// Source 3: Claude Code OAuth token from OS keychain
	var keychainErr, credFileErr error
	token, keychainErr := ai.ReadClaudeCodeOAuthToken()
	if keychainErr == nil {
		logger.Manager.Debugf("AI client: using OAuth token from keychain")
		m.signalCredentialsReady()
		return ai.NewClientWithOAuth(token)
	}

	// Source 4: Credentials file fallback (~/.claude/.credentials.json)
	token, credFileErr = ai.ReadClaudeCodeCredentialsFile()
	if credFileErr == nil {
		logger.Manager.Debugf("AI client: using OAuth token from credentials file")
		m.signalCredentialsReady()
		return ai.NewClientWithOAuth(token)
	}

	// Source 5: Cached OAuth token from agent-runner SDK
	// In release builds, sources 1-4 often fail (no env var from Finder launch,
	// keychain ACL blocks access). The SDK authenticates independently and we
	// cache its credentials on the first init event.
	if cached := m.getCachedOAuthToken(); cached != "" {
		logger.Manager.Debugf("AI client: using cached OAuth token from SDK")
		return ai.NewClientWithOAuth(cached)
	}

	logger.Manager.Warnf("AI client unavailable: no credentials found (keychain: %v, credfile: %v)", keychainErr, credFileErr)
	return nil
}

// CreateAIClient returns an AI provider from the best available credential source,
// or nil if no credentials are configured. This is the public entry point for
// packages that need an AI client (e.g. server handlers).
func (m *Manager) CreateAIClient() ai.Provider {
	return m.newAIClient()
}

// tryBedrockFromClaudeSettings checks pre-loaded Claude Code settings for Bedrock configuration.
func (m *Manager) tryBedrockFromClaudeSettings(settings *ai.ClaudeCodeSettings) ai.Provider {
	if settings == nil || !ai.IsBedRockConfigured(settings) {
		return nil
	}

	env := settings.Env
	profile := env["AWS_PROFILE"]
	region := ai.ExtractRegionFromARN(env["ANTHROPIC_DEFAULT_SONNET_MODEL"])
	if region == "" {
		region = env["AWS_REGION"]
		if region == "" {
			region = "us-east-1"
		}
	}

	client, err := ai.NewBedRockClient(m.ctx, profile, region,
		env["ANTHROPIC_DEFAULT_SONNET_MODEL"],
		env["ANTHROPIC_DEFAULT_HAIKU_MODEL"],
		settings.AwsAuthRefresh)
	if err != nil {
		logger.Manager.Warnf("Failed to create Bedrock client from Claude settings: %v", err)
		return nil
	}
	logger.Manager.Debugf("AI client: using AWS Bedrock from Claude Code settings (profile=%s, region=%s)", profile, region)
	m.signalCredentialsReady()
	return client
}

// tryBedrockFromEnvVars checks ChatML env vars for Bedrock configuration.
func (m *Manager) tryBedrockFromEnvVars(envVars map[string]string, claudeSettings *ai.ClaudeCodeSettings) ai.Provider {
	if envVars == nil || envVars["CLAUDE_CODE_USE_BEDROCK"] != "true" {
		return nil
	}

	profile := envVars["AWS_PROFILE"]
	region := ai.ExtractRegionFromARN(envVars["ANTHROPIC_DEFAULT_SONNET_MODEL"])
	if region == "" {
		region = envVars["AWS_REGION"]
		if region == "" {
			region = "us-east-1"
		}
	}

	// Fall back to Claude Code settings.json awsAuthRefresh when not set in env vars.
	authRefreshCmd := envVars["AWS_AUTH_REFRESH"]
	if authRefreshCmd == "" && claudeSettings != nil {
		authRefreshCmd = claudeSettings.AwsAuthRefresh
	}

	client, err := ai.NewBedRockClient(m.ctx, profile, region,
		envVars["ANTHROPIC_DEFAULT_SONNET_MODEL"],
		envVars["ANTHROPIC_DEFAULT_HAIKU_MODEL"],
		authRefreshCmd)
	if err != nil {
		logger.Manager.Warnf("Failed to create Bedrock client from env vars: %v", err)
		return nil
	}
	logger.Manager.Debugf("AI client: using AWS Bedrock from env vars (profile=%s, region=%s)", profile, region)
	m.signalCredentialsReady()
	return client
}

// setCachedOAuthToken stores an OAuth access token discovered by the agent-runner SDK.
func (m *Manager) setCachedOAuthToken(token string) {
	m.cachedOAuthTokenMu.Lock()
	defer m.cachedOAuthTokenMu.Unlock()
	m.cachedOAuthToken = token
	m.signalCredentialsReady()
}

// getCachedOAuthToken returns the cached OAuth token, if any.
func (m *Manager) getCachedOAuthToken() string {
	m.cachedOAuthTokenMu.RLock()
	defer m.cachedOAuthTokenMu.RUnlock()
	return m.cachedOAuthToken
}

// clearCachedOAuthToken removes the cached OAuth token so that the next
// credential lookup re-evaluates all sources.
func (m *Manager) clearCachedOAuthToken() {
	m.cachedOAuthTokenMu.Lock()
	defer m.cachedOAuthTokenMu.Unlock()
	m.cachedOAuthToken = ""
}

// signalCredentialsReady closes credReadyCh, unblocking goroutines waiting
// for AI credentials to become available (e.g. session title generation).
func (m *Manager) signalCredentialsReady() {
	m.credReadyOnce.Do(func() { close(m.credReadyCh) })
}

// refreshCachedCredentials attempts to populate (or refresh) the credential
// cache after the agent-runner SDK has authenticated successfully. The SDK may
// refresh the OAuth token in ~/.claude/.credentials.json, making it available
// to the Go backend even when direct keychain access is blocked by ACL
// restrictions. This is called on every init event so that expired or revoked
// tokens are replaced with fresh ones.
func (m *Manager) refreshCachedCredentials(apiKeySource string) {
	// Give the SDK a moment to finish writing the credentials file —
	// the init event may arrive before the file write is complete.
	time.Sleep(500 * time.Millisecond)

	// Try the credentials file (the SDK may have just refreshed it)
	token, err := ai.ReadClaudeCodeCredentialsFile()
	if err == nil && token != "" {
		m.setCachedOAuthToken(token)
		logger.Manager.Infof("Cached AI credentials from credentials file (SDK source: %s)", apiKeySource)
		return
	}

	// Retry keychain (may succeed now if the SDK updated the ACL)
	token, err = ai.ReadClaudeCodeOAuthToken()
	if err == nil && token != "" {
		m.setCachedOAuthToken(token)
		logger.Manager.Infof("Cached AI credentials from keychain (SDK source: %s)", apiKeySource)
		return
	}

	logger.Manager.Debugf("SDK authenticated (source: %s) but Go backend could not obtain token from credentials file or keychain", apiKeySource)
	// Don't signal credReadyCh here — no usable credentials were obtained.
	// The ticker in generateAndApplySessionTitle will poll newAIClient()
	// periodically, picking up credentials once they become available.
}

// generateAndApplySessionTitle uses the AI client to generate a session title
// from the user's first message, then applies it to the conversation and session.
func (m *Manager) generateAndApplySessionTitle(sessionID, convID, userMessage string) {
	logger.Manager.Infof("Generating session title for session %s, conv %s", sessionID, convID)

	client := m.newAIClient()
	if client == nil {
		// Credentials may not be available yet — the agent-runner SDK's init
		// event triggers refreshCachedCredentials which typically takes 2-4s
		// after process start. Poll periodically rather than doing a single
		// wait-and-retry, since the credential file may be written asynchronously
		// after credReadyCh is signalled.
		logger.Manager.Infof("Waiting for AI credentials for session %s title generation", sessionID)
		deadline := time.NewTimer(15 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		credReady := m.credReadyCh
	credLoop:
		for {
			select {
			case <-credReady:
				client = m.newAIClient()
				credReady = nil // closed channel returns immediately; nil blocks forever — let ticker drive retries
			case <-ticker.C:
				client = m.newAIClient()
			case <-deadline.C:
				logger.Manager.Warnf("Timed out waiting for credentials for session %s title generation", sessionID)
				break credLoop
			case <-m.ctx.Done():
				m.resetAutoNamed(sessionID)
				return
			}
			if client != nil {
				break
			}
		}
		if client == nil {
			logger.Manager.Warnf("Skipping session title generation for %s: no credentials after wait", sessionID)
			m.resetAutoNamed(sessionID)
			return
		}
	}

	// Acquire semaphore to limit concurrent title generation API calls.
	select {
	case m.titleGenSem <- struct{}{}:
		defer func() { <-m.titleGenSem }()
	case <-m.ctx.Done():
		m.resetAutoNamed(sessionID)
		return
	}

	ctx, cancel := context.WithTimeout(m.ctx, 15*time.Second)
	defer cancel()

	// Enrich title input with the session's task field (e.g., GitHub/Linear issue title)
	// so the AI generates a meaningful name instead of a generic one from a vague user message.
	titleInput := userMessage
	dbCtx, dbCancel := context.WithTimeout(m.ctx, 3*time.Second)
	defer dbCancel()
	if sess, err := m.store.GetSession(dbCtx, sessionID); err == nil && sess != nil && sess.Task != "" {
		const shortMessageThreshold = 20 // runes, not bytes
		task := sess.Task
		const maxTaskLen = 500
		if utf8.RuneCountInString(task) > maxTaskLen {
			// Truncate to maxTaskLen runes
			runes := []rune(task)
			task = string(runes[:maxTaskLen])
		}
		if userMessage == "" || utf8.RuneCountInString(userMessage) < shortMessageThreshold {
			titleInput = task
		} else {
			titleInput = fmt.Sprintf("Task: %s\n\nUser message: %s", task, userMessage)
		}
	}

	title, err := client.GenerateSessionTitle(ctx, titleInput)
	if err != nil {
		logger.Manager.Warnf("Failed to generate session title for session %s: %v", sessionID, err)
		m.resetAutoNamed(sessionID)
		return
	}

	if title == "" {
		logger.Manager.Warnf("Empty title returned for session %s", sessionID)
		m.resetAutoNamed(sessionID)
		return
	}

	logger.Manager.Infof("Generated session title for %s: %q", sessionID, title)

	// Update conversation name
	if err := m.store.UpdateConversation(ctx, convID, func(c *models.Conversation) {
		c.Name = title
		c.UpdatedAt = time.Now()
	}); err != nil {
		logger.Manager.Errorf("Failed to update conversation name for %s: %v", convID, err)
		m.resetAutoNamed(sessionID)
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

// detectPhase determines the current development lifecycle phase from session and git state.
// The phase string is the primary dispatch key for the suggestion prompt.
func detectPhase(sess *models.Session, gitStatus *git.GitStatus) string {
	// Highest priority: in-progress git operations
	if gitStatus != nil && gitStatus.InProgress.Type != "none" {
		return "resolving-" + gitStatus.InProgress.Type // resolving-rebase, resolving-merge, resolving-cherry-pick
	}

	// Conflicts (from git or session flag)
	if gitStatus != nil && gitStatus.Conflicts.HasConflicts {
		return "conflict-resolution"
	}
	if sess.HasMergeConflict {
		return "conflict-resolution"
	}

	// PR-based phases
	switch sess.PRStatus {
	case models.PRStatusOpen:
		if sess.HasCheckFailures {
			return "pr-fixing-ci"
		}
		return "pr-review"
	case models.PRStatusMerged:
		return "post-merge"
	case models.PRStatusClosed:
		return "pr-closed"
	}

	// Git working directory phases
	if gitStatus != nil {
		hasUncommitted := gitStatus.WorkingDirectory.HasChanges
		// Use UnpushedCommits only — AheadBy measures distance from the base branch,
		// not the remote tracking branch, so it stays >0 even after pushing.
		hasUnpushed := gitStatus.Sync.UnpushedCommits > 0

		if !hasUncommitted && hasUnpushed {
			return "ready-for-pr"
		}
		// Check staged before general hasUncommitted: staged files are a subset of
		// uncommitted changes, and "ready-to-commit" is more specific than "development".
		if gitStatus.WorkingDirectory.StagedCount > 0 {
			return "ready-to-commit"
		}
		if hasUncommitted {
			return "development"
		}
	}

	return "exploration"
}

// buildSessionContext builds a context string describing the session's current state
// (phase, git state, PR status, conversation type) for use in suggestion generation.
func (m *Manager) buildSessionContext(ctx context.Context, convID string) string {
	conv, err := m.store.GetConversationMeta(ctx, convID)
	if err != nil || conv == nil {
		return ""
	}

	sessWithWs, err := m.store.GetSessionWithWorkspace(ctx, conv.SessionID)
	if err != nil || sessWithWs == nil {
		return ""
	}
	sess := &sessWithWs.Session

	var lines []string

	// Get git status (graceful degradation on error)
	var gitStatus *git.GitStatus
	if sess.WorktreePath != "" {
		baseBranch := sessWithWs.DefaultBranch()
		status, err := git.NewRepoManager().GetStatus(ctx, sess.WorktreePath, baseBranch)
		if err != nil {
			logger.Manager.Debugf("Failed to get git status for suggestions (conv %s): %v", convID, err)
		} else {
			gitStatus = status
		}
	}

	// Phase detection (primary dispatch key for the prompt)
	phase := detectPhase(sess, gitStatus)
	lines = append(lines, fmt.Sprintf("Phase: %s", phase))

	// Conversation metadata
	lines = append(lines, fmt.Sprintf("Conv: %s, %d messages", conv.Type, conv.MessageCount))

	// Git working directory state
	if gitStatus != nil {
		wd := gitStatus.WorkingDirectory
		lines = append(lines, fmt.Sprintf("Git: %d staged, %d unstaged, %d untracked", wd.StagedCount, wd.UnstagedCount, wd.UntrackedCount))

		sync := gitStatus.Sync
		syncLine := fmt.Sprintf("Sync: %d unpushed, %d behind", sync.UnpushedCommits, sync.BehindBy)
		if sync.Diverged {
			syncLine += " (diverged)"
		}
		lines = append(lines, syncLine)

		// In-progress operations
		if gitStatus.InProgress.Type != "none" {
			if gitStatus.InProgress.Total > 0 {
				lines = append(lines, fmt.Sprintf("In-progress: %s (%d/%d)", gitStatus.InProgress.Type, gitStatus.InProgress.Current, gitStatus.InProgress.Total))
			} else {
				lines = append(lines, fmt.Sprintf("In-progress: %s", gitStatus.InProgress.Type))
			}
		}

		// Conflicts
		if gitStatus.Conflicts.HasConflicts {
			lines = append(lines, fmt.Sprintf("Conflicts: %d files", gitStatus.Conflicts.Count))
		}
	}

	// PR status
	switch sess.PRStatus {
	case models.PRStatusOpen:
		prLine := fmt.Sprintf("PR: #%d open", sess.PRNumber)
		if sess.HasCheckFailures {
			prLine += ", CI failing"
		} else if sess.CheckStatus == models.CheckStatusPending {
			prLine += ", CI pending"
		} else if sess.CheckStatus == models.CheckStatusSuccess {
			prLine += ", CI passing"
		}
		if sess.HasMergeConflict {
			prLine += ", has merge conflicts"
		}
		lines = append(lines, prLine)
	case models.PRStatusMerged:
		lines = append(lines, fmt.Sprintf("PR: #%d merged", sess.PRNumber))
	case models.PRStatusClosed:
		lines = append(lines, fmt.Sprintf("PR: #%d closed", sess.PRNumber))
	default:
		lines = append(lines, "PR: none")
	}

	// Session stats
	if sess.Stats != nil && (sess.Stats.Additions > 0 || sess.Stats.Deletions > 0) {
		lines = append(lines, fmt.Sprintf("Stats: +%d/-%d", sess.Stats.Additions, sess.Stats.Deletions))
	}

	// Task status
	if sess.TaskStatus != "" && sess.TaskStatus != "backlog" {
		lines = append(lines, fmt.Sprintf("Task: %s", sess.TaskStatus))
	}

	return strings.Join(lines, "\n")
}

// parseSubAgentUsage extracts SubAgentUsage from a raw JSON map.
func parseSubAgentUsage(raw map[string]interface{}) *SubAgentUsage {
	if raw == nil {
		return nil
	}
	usage := &SubAgentUsage{}
	if v, ok := raw["totalTokens"].(float64); ok {
		usage.TotalTokens = int(v)
	}
	if v, ok := raw["toolUses"].(float64); ok {
		usage.ToolUses = int(v)
	}
	if v, ok := raw["durationMs"].(float64); ok {
		usage.DurationMs = int64(v)
	}
	if usage.TotalTokens == 0 && usage.ToolUses == 0 && usage.DurationMs == 0 {
		return nil
	}
	return usage
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
	page, err := m.store.GetConversationMessages(ctx, convID, nil, 2, false)
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

	// Filter out dangerous or command-like suggestions (defense in depth)
	if dangerousSuggestionPattern.MatchString(suggestion.GhostText) || bashCommandPattern.MatchString(suggestion.GhostText) {
		suggestion.GhostText = ""
	}
	var safePills []ai.SuggestionPill
	for _, pill := range suggestion.Pills {
		labelSafe := !dangerousSuggestionPattern.MatchString(pill.Label) && !bashCommandPattern.MatchString(pill.Label)
		valueSafe := !dangerousSuggestionPattern.MatchString(pill.Value) && !bashCommandPattern.MatchString(pill.Value)
		if labelSafe && valueSafe {
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

// claimAutoName atomically checks and sets AutoNamed=true for a session.
// Returns true if the caller won the claim (and should generate the title).
// Uses a mutex + DB write to close the TOCTOU race between concurrent conversations.
func (m *Manager) claimAutoName(ctx context.Context, sessionID string) bool {
	m.autoNameMu.Lock()
	defer m.autoNameMu.Unlock()

	sess, err := m.store.GetSession(ctx, sessionID)
	if err != nil || sess == nil || sess.AutoNamed {
		return false
	}

	if err := m.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.AutoNamed = true
	}); err != nil {
		logger.Manager.Errorf("Failed to claim AutoNamed for session %s: %v", sessionID, err)
		return false
	}
	return true
}

// resetAutoNamed clears the AutoNamed flag so a future conversation can retry title generation.
// Called when generateAndApplySessionTitle fails (no API key, API error, empty title).
func (m *Manager) resetAutoNamed(sessionID string) {
	ctx, cancel := context.WithTimeout(m.ctx, 5*time.Second)
	defer cancel()
	if err := m.store.UpdateSession(ctx, sessionID, func(s *models.Session) {
		s.AutoNamed = false
	}); err != nil {
		logger.Manager.Errorf("Failed to reset AutoNamed for session %s: %v", sessionID, err)
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
func (m *Manager) loadEnvVars(ctx context.Context, claudeSettings *ai.ClaudeCodeSettings) (map[string]string, error) {
	raw, found, err := m.store.GetSetting(ctx, "env-vars")
	if err != nil {
		return nil, err
	}

	var envMap map[string]string
	if found && raw != "" {
		envMap = store.ParseEnvVars(raw)
	}

	// If no settings passed in, read them now (for callers outside newAIClient).
	if claudeSettings == nil {
		claudeSettings, _ = ai.ReadClaudeCodeSettings()
	}

	// Merge env vars from Claude Code settings.json (ChatML settings take precedence)
	if claudeSettings != nil && len(claudeSettings.Env) > 0 {
		if envMap == nil {
			envMap = make(map[string]string)
		}
		for k, v := range claudeSettings.Env {
			if _, exists := envMap[k]; !exists {
				envMap[k] = v
			}
		}
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

	// Load encrypted GitHub personal access token if configured.
	// Only set GITHUB_TOKEN if not already present (e.g. from custom env vars or gh auth).
	if _, hasGHToken := envMap["GITHUB_TOKEN"]; !hasGHToken {
		encrypted, found, err = m.store.GetSetting(ctx, "github-personal-token")
		if err != nil {
			return envMap, nil // non-fatal: proceed without the token
		}
		if found && encrypted != "" {
			decrypted, err := crypto.Decrypt(encrypted)
			if err != nil {
				logger.Manager.Errorf("failed to decrypt GitHub personal token: %v", err)
				return envMap, nil
			}
			if envMap == nil {
				envMap = make(map[string]string)
			}
			envMap["GITHUB_TOKEN"] = decrypted
		}
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

// buildAppPrompt constructs the app-level system prompt with session context
// and behavioral rules for the git worktree environment.
func buildAppPrompt(session *models.Session, sessionWithWs *models.SessionWithWorkspace) string {
	targetBranch := sessionWithWs.EffectiveTargetBranch()
	targetBranchShort := strings.TrimPrefix(targetBranch, sessionWithWs.EffectiveRemote()+"/")

	return fmt.Sprintf(`You are running inside ChatML, a desktop app for AI-assisted development. Each session runs in an isolated git worktree with its own dedicated branch.

## Session
- Session: %s
- Branch: %s
- Target branch: %s
- Worktree: %s

## Git Worktree Rules

This session uses a git worktree — an isolated working directory with a dedicated branch. The worktree shares the git object store with the main repository but has its own HEAD and index.

**NEVER switch branches.** Do not run `+"`"+`git checkout`+"`"+`, `+"`"+`git switch`+"`"+`, or any command that changes the checked-out branch. The worktree is locked to its branch — switching would corrupt the session state. If the user asks you to switch to main, master, or any other branch, explain that this session is locked to its worktree branch and they should create a new session instead.

**NEVER use --delete-branch with gh commands.** `+"`"+`gh pr merge --delete-branch`+"`"+` and `+"`"+`gh pr close --delete-branch`+"`"+` delete the local branch and silently switch the worktree to the default branch, corrupting the session. Always omit `+"`"+`--delete-branch`+"`"+`. After merging, the session stays on its branch.

**NEVER use `+"`"+`git stash`+"`"+`.** Stash is shared across ALL worktrees in the repository. A stash created here is visible to every other session. Use commits instead — commit work-in-progress to the session branch.

**Stay in the worktree directory.** Do not `+"`"+`cd`+"`"+` outside of %s. All your file operations should be within this directory.

**No destructive git operations:**
- No `+"`"+`git push --force`+"`"+` (rewrites remote history)
- No `+"`"+`git reset --hard`+"`"+` (destroys uncommitted work)
- No `+"`"+`git clean -fd`+"`"+` (deletes untracked files)
- No `+"`"+`git branch -D`+"`"+` on the session branch (destroys the session)

**After a PR is merged, stay on this branch.** Do not attempt to switch to main or clean up. Do not delete the branch. The session remains active on its branch.

**Branch name may change.** ChatML auto-renames the branch after the first message. Always use `+"`"+`git branch --show-current`+"`"+` rather than hardcoding the branch name.

**PRs target %s.** When creating PRs with `+"`"+`gh pr create`+"`"+`, use `+"`"+`--base %s`+"`"+`.

## ChatML Tools

You have access to ChatML MCP tools:
- `+"`"+`mcp__chatml__get_session_status`+"`"+` — git state, branch info, Linear issue
- `+"`"+`mcp__chatml__get_workspace_diff`+"`"+` — diff vs target branch (use detailed: true for full diff)
- `+"`"+`mcp__chatml__get_recent_activity`+"`"+` — recent git log
- `+"`"+`mcp__chatml__add_review_comment`+"`"+` — leave inline code review comments visible in the ChatML UI
- `+"`"+`mcp__chatml__list_review_comments`+"`"+` / `+"`"+`mcp__chatml__get_review_comment_stats`+"`"+` — read review comments
- `+"`"+`mcp__chatml__resolve_review_comment`+"`"+` — mark a review comment as fixed or ignored after addressing it
- `+"`"+`mcp__chatml__report_pr_created`+"`"+` — report PR creation to update the ChatML sidebar
- `+"`"+`mcp__chatml__report_pr_merged`+"`"+` — report PR merge to update session status

**After creating a PR** (with `+"`"+`gh pr create`+"`"+` or any other method), ALWAYS call `+"`"+`mcp__chatml__report_pr_created`+"`"+` with the PR number and URL. This ensures the PR badge appears immediately in the sidebar.

**After merging a PR** (with `+"`"+`gh pr merge`+"`"+` or any other method), ALWAYS call `+"`"+`mcp__chatml__report_pr_merged`+"`"+` to update the session status.

**After fixing a review comment**, call `+"`"+`mcp__chatml__resolve_review_comment`+"`"+` with the comment's ID to mark it as resolved. The comment ID is provided in the review comment attachment.

Do NOT use `+"`"+`mcp__chatml__start_linear_issue`+"`"+` — it creates git branches inside the worktree, which conflicts with the session model. Use the Linear MCP server directly for Linear operations.`,
		session.Name,
		session.Branch,
		targetBranch,
		session.WorktreePath,
		session.WorktreePath,
		targetBranchShort,
		targetBranchShort,
	)
}

// buildSystemInstructions combines app-level prompt, user custom instructions,
// and conversation summaries into the full instructions string for the agent.
func (m *Manager) buildSystemInstructions(ctx context.Context, session *models.Session, sessionWithWs *models.SessionWithWorkspace, existingInstructions string) string {
	var parts []string

	// 1. App-level context + rules
	parts = append(parts, buildAppPrompt(session, sessionWithWs))

	// 2. User's global custom instructions (from settings)
	if custom, found, err := m.store.GetSetting(ctx, "custom-instructions"); err == nil && found && custom != "" {
		parts = append(parts, "## Custom Instructions\n\n"+custom)
	}

	// 3. Conversation summaries (existing, passed from handler)
	if existingInstructions != "" {
		parts = append(parts, existingInstructions)
	}

	return strings.Join(parts, "\n\n")
}

// toAnySlice converts a string slice to []any for RunSummary.Errors
func toAnySlice(ss []string) []any {
	if len(ss) == 0 {
		return nil
	}
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// parseTokenUsage extracts TokenUsage from the untyped usage map in AgentEvent
func parseTokenUsage(raw map[string]interface{}) *models.TokenUsage {
	if raw == nil {
		return nil
	}
	usage := &models.TokenUsage{}
	if v, ok := raw["inputTokens"].(float64); ok {
		usage.InputTokens = int(v)
	}
	if v, ok := raw["outputTokens"].(float64); ok {
		usage.OutputTokens = int(v)
	}
	if v, ok := raw["cacheReadInputTokens"].(float64); ok {
		usage.CacheReadInputTokens = int(v)
	}
	if v, ok := raw["cacheCreationInputTokens"].(float64); ok {
		usage.CacheCreationInputTokens = int(v)
	}
	return usage
}

// parseModelUsage extracts per-model usage from the untyped map in AgentEvent
func parseModelUsage(raw map[string]interface{}) map[string]*models.ModelUsageInfo {
	if raw == nil {
		return nil
	}
	result := make(map[string]*models.ModelUsageInfo, len(raw))
	for model, v := range raw {
		m, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		info := &models.ModelUsageInfo{}
		if n, ok := m["inputTokens"].(float64); ok {
			info.InputTokens = int(n)
		}
		if n, ok := m["outputTokens"].(float64); ok {
			info.OutputTokens = int(n)
		}
		if n, ok := m["cacheReadInputTokens"].(float64); ok {
			info.CacheReadInputTokens = int(n)
		}
		if n, ok := m["cacheCreationInputTokens"].(float64); ok {
			info.CacheCreationInputTokens = int(n)
		}
		if n, ok := m["webSearchRequests"].(float64); ok {
			info.WebSearchRequests = int(n)
		}
		if n, ok := m["costUSD"].(float64); ok {
			info.CostUSD = n
		}
		if n, ok := m["contextWindow"].(float64); ok {
			info.ContextWindow = int(n)
		}
		result[model] = info
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
