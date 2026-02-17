# Agent SDK Teams Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Agent SDK "Agent Teams" within ChatML sessions — teammates get their own conversation tabs with streaming output, users can message teammates directly, and a shared task list tracks team progress.

**Architecture:** Teammates map to real `Conversation` DB records with `type: "teammate"` and `parentConversationId` linking to the lead. All teammate I/O flows through the lead's single `query()` process. The backend demuxes events by `agentId` and routes them to the correct child conversation. A Team Overview tab (type: "team-overview") provides a dashboard. See full design: `docs/plans/swirling-dazzling-lagoon.md` (plan file).

**Tech Stack:** Go backend (chi router, SQLite), Node.js agent-runner (Claude Agent SDK), React/Next.js frontend (Zustand store, WebSocket), Tauri shell.

---

## Task 1: Data Model — Add Teammate Fields to Conversation

**Files:**
- Modify: `backend/models/types.go:107-120` (Conversation struct)
- Modify: `backend/models/types.go:221-232` (constants)

**Step 1: Add fields to Conversation struct**

In `backend/models/types.go`, add three fields to the `Conversation` struct after `AgentSessionID` (line 114):

```go
type Conversation struct {
	ID                   string       `json:"id"`
	SessionID            string       `json:"sessionId"`
	Type                 string       `json:"type"`
	Name                 string       `json:"name"`
	Status               string       `json:"status"`
	Model                string       `json:"model,omitempty"`
	AgentSessionID       string       `json:"agentSessionId,omitempty"`
	ParentConversationID string       `json:"parentConversationId,omitempty"` // NEW: links teammate → lead
	TeamAgentId          string       `json:"teamAgentId,omitempty"`          // NEW: SDK agent_id for routing
	TeammateName         string       `json:"teammateName,omitempty"`         // NEW: display name from description
	Messages             []Message    `json:"messages"`
	MessageCount         int          `json:"messageCount,omitempty"`
	ToolSummary          []ToolAction `json:"toolSummary"`
	CreatedAt            time.Time    `json:"createdAt"`
	UpdatedAt            time.Time    `json:"updatedAt"`
}
```

**Step 2: Add conversation type and status constants**

After the existing constants block at line 225, add:

```go
const (
	ConversationTypeTask         = "task"
	ConversationTypeReview       = "review"
	ConversationTypeChat         = "chat"
	ConversationTypeTeammate     = "teammate"      // NEW
	ConversationTypeTeamOverview = "team-overview"  // NEW
)
```

**Step 3: Run tests**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS (no tests break — fields are additive)

**Step 4: Commit**

```bash
git add backend/models/types.go
git commit -m "feat(models): add teammate conversation fields and type constants"
```

---

## Task 2: SQLite Schema — Add Columns and Migration

**Files:**
- Modify: `backend/store/sqlite.go:156-169` (conversations table schema)
- Modify: `backend/store/sqlite.go:319-323` (runMigrations)
- Modify: `backend/store/sqlite.go:914-923` (AddConversation)
- Modify: `backend/store/sqlite.go:927-941` (GetConversationMeta)
- Modify: `backend/store/sqlite.go:943-992` (GetConversation)
- Modify: `backend/store/sqlite.go:996-1043` (ListConversations)
- Modify: `backend/store/sqlite.go:1048-1116` (ListConversationsForSessions)

**Step 1: Add columns to CREATE TABLE**

In the conversations schema (line 156), add three columns after `agent_session_id`:

```sql
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'task',
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    model TEXT NOT NULL DEFAULT '',
    streaming_snapshot TEXT NOT NULL DEFAULT '',
    agent_session_id TEXT NOT NULL DEFAULT '',
    parent_conversation_id TEXT DEFAULT '',
    team_agent_id TEXT DEFAULT '',
    teammate_name TEXT DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

**Step 2: Add migration for existing databases**

In `runMigrations()` (line 319), add ALTER TABLE statements. Use the safe "check before alter" pattern:

```go
func (s *SQLiteStore) runMigrations() error {
	// Add teammate columns to conversations table
	alterStatements := []string{
		"ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT DEFAULT ''",
		"ALTER TABLE conversations ADD COLUMN team_agent_id TEXT DEFAULT ''",
		"ALTER TABLE conversations ADD COLUMN teammate_name TEXT DEFAULT ''",
	}
	for _, stmt := range alterStatements {
		_, err := s.db.Exec(stmt)
		if err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	return nil
}
```

Note: Add `"strings"` to imports if not already present.

**Step 3: Update AddConversation**

In `AddConversation` (line 914), add the three new columns to the INSERT:

```go
func (s *SQLiteStore) AddConversation(ctx context.Context, conv *models.Conversation) error {
	return RetryDBExec(ctx, "AddConversation", DefaultRetryConfig(), func(ctx context.Context) error {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO conversations (id, session_id, type, name, status, model, agent_session_id, parent_conversation_id, team_agent_id, teammate_name, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			conv.ID, conv.SessionID, conv.Type, conv.Name,
			conv.Status, conv.Model, conv.AgentSessionID,
			conv.ParentConversationID, conv.TeamAgentId, conv.TeammateName,
			conv.CreatedAt, conv.UpdatedAt)
		return err
	})
}
```

**Step 4: Update all SELECT queries to include new columns**

Every query that reads conversations needs to include and scan the three new fields. Update each function:

**GetConversationMeta** (line 927): Add columns to SELECT and Scan:
```go
err := s.db.QueryRowContext(ctx, `
    SELECT id, session_id, type, name, status, model, agent_session_id, parent_conversation_id, team_agent_id, teammate_name, created_at, updated_at
    FROM conversations WHERE id = ?`, id).Scan(
    &conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
    &conv.Status, &conv.Model, &conv.AgentSessionID,
    &conv.ParentConversationID, &conv.TeamAgentId, &conv.TeammateName,
    &conv.CreatedAt, &conv.UpdatedAt)
```

**GetConversation** (line 943): Same column addition to SELECT and Scan (same pattern as above).

**ListConversations** (line 996): Add columns to SELECT, update `rows.Scan(...)` to include `&conv.ParentConversationID, &conv.TeamAgentId, &conv.TeammateName`.

**ListConversationsForSessions** (line 1048): Same pattern — add columns to SELECT and Scan.

**Step 5: Add new query functions**

Add after `ListConversationsForSessions`:

```go
// GetTeammateConversations returns all teammate conversations for a parent conversation.
func (s *SQLiteStore) GetTeammateConversations(ctx context.Context, parentConvID string) ([]*models.Conversation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, type, name, status, model, agent_session_id, parent_conversation_id, team_agent_id, teammate_name, created_at, updated_at
		FROM conversations
		WHERE parent_conversation_id = ? AND type IN ('teammate', 'team-overview')
		ORDER BY created_at`, parentConvID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var convs []*models.Conversation
	for rows.Next() {
		var conv models.Conversation
		if err := rows.Scan(
			&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
			&conv.Status, &conv.Model, &conv.AgentSessionID,
			&conv.ParentConversationID, &conv.TeamAgentId, &conv.TeammateName,
			&conv.CreatedAt, &conv.UpdatedAt,
		); err != nil {
			return nil, err
		}
		convs = append(convs, &conv)
	}
	return convs, rows.Err()
}

// GetConversationByTeamAgentId finds a teammate conversation by its SDK agent ID.
func (s *SQLiteStore) GetConversationByTeamAgentId(ctx context.Context, parentConvID, agentId string) (*models.Conversation, error) {
	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, type, name, status, model, agent_session_id, parent_conversation_id, team_agent_id, teammate_name, created_at, updated_at
		FROM conversations
		WHERE parent_conversation_id = ? AND team_agent_id = ?`, parentConvID, agentId).Scan(
		&conv.ID, &conv.SessionID, &conv.Type, &conv.Name,
		&conv.Status, &conv.Model, &conv.AgentSessionID,
		&conv.ParentConversationID, &conv.TeamAgentId, &conv.TeammateName,
		&conv.CreatedAt, &conv.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &conv, nil
}
```

**Step 6: Run tests**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go test ./store/... -v -count=1`
Expected: All existing tests PASS (schema is backward-compatible, new columns have defaults)

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

**Step 7: Commit**

```bash
git add backend/store/sqlite.go
git commit -m "feat(store): add teammate columns, migration, and query functions"
```

---

## Task 3: Event Types — Add Teammate Events to Parser

**Files:**
- Modify: `backend/agent/parser.go:197-271` (EventType constants)

**Step 1: Add teammate event type constants**

After `EventTypeSubagentOutput` (line 222), add:

```go
EventTypeTeammateStarted   = "teammate_started"    // Agent runner → backend
EventTypeTeammateStopped   = "teammate_stopped"     // Agent runner → backend
EventTypeTeammateCreated   = "teammate_created"     // Backend → frontend (WebSocket)
EventTypeTeammateCompleted = "teammate_completed"   // Backend → frontend (WebSocket)
EventTypeTeamOverviewCreated = "team_overview_created" // Backend → frontend (WebSocket)
```

**Step 2: Add teammate fields to InputMessage struct**

In `backend/agent/process.go:87-105`, add fields for teammate messaging:

```go
type InputMessage struct {
	Type              string              `json:"type"`
	Content           string              `json:"content,omitempty"`
	Model             string              `json:"model,omitempty"`
	PermissionMode    string              `json:"permissionMode,omitempty"`
	CheckpointUuid    string              `json:"checkpointUuid,omitempty"`
	Attachments       []models.Attachment `json:"attachments,omitempty"`
	QuestionRequestID string              `json:"questionRequestId,omitempty"`
	Answers           map[string]string   `json:"answers,omitempty"`
	PlanApprovalRequestID string          `json:"planApprovalRequestId,omitempty"`
	PlanApproved      *bool               `json:"planApproved,omitempty"`
	MaxThinkingTokens int                 `json:"maxThinkingTokens,omitempty"`
	ServerName        string              `json:"serverName,omitempty"`
	ServerEnabled     *bool               `json:"serverEnabled,omitempty"`
	TargetAgentId     string              `json:"targetAgentId,omitempty"`   // NEW: for teammate_message
	TargetAgentName   string              `json:"targetAgentName,omitempty"` // NEW: display name for relay
}
```

**Step 3: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add backend/agent/parser.go backend/agent/process.go
git commit -m "feat(agent): add teammate event types and InputMessage fields"
```

---

## Task 4: Agent Runner — Enable Teams Env Var

**Files:**
- Modify: `backend/agent/manager.go` (where ProcessOptions are built)
- Modify: `backend/agent/process.go:35-61` (ProcessOptions struct)

**Step 1: Add DisableAgentTeams to ProcessOptions**

In `ProcessOptions` (line 35), add:

```go
DisableAgentTeams bool // Opt-out flag to disable Agent Teams feature
```

**Step 2: Inject env var in NewProcessWithOptions**

In `NewProcessWithOptions` (line 147), before the `cmd.Env` block at line 282, add agent teams env var injection:

```go
// Enable Agent Teams unless explicitly disabled
if !opts.DisableAgentTeams {
    if opts.EnvVars == nil {
        opts.EnvVars = make(map[string]string)
    }
    opts.EnvVars["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
}
```

Place this right before the existing `if len(opts.EnvVars) > 0 {` block (line 282) so it merges into the env injection.

**Step 3: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add backend/agent/process.go
git commit -m "feat(agent): inject CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var"
```

---

## Task 5: Agent Runner — Detect Teammates in Hooks

**Files:**
- Modify: `agent-runner/src/index.ts:839-844` (tracking maps)
- Modify: `agent-runner/src/index.ts:1106-1133` (subagentStartHook)
- Modify: `agent-runner/src/index.ts:1135-1153` (subagentStopHook)

**Step 1: Add teammateAgentIds tracking set**

After `sessionToAgentId` declaration (line 840), add:

```typescript
// Track which agentIds are teammates (vs regular subagents)
const teammateAgentIds = new Set<string>();
```

**Step 2: Detect teammates in subagentStartHook**

Modify `subagentStartHook` (line 1106) to check agent type and emit distinct event:

```typescript
const subagentStartHook: HookCallback = async (input) => {
  const hookInput = input as SubagentStartHookInput;
  sessionToAgentId.set(hookInput.session_id, hookInput.agent_id);

  // Detect teammate agents — SDK uses specific agent types for team members
  const isTeammate = hookInput.agent_type === "teammate" ||
                     hookInput.agent_type === "team_member";

  if (isTeammate) {
    teammateAgentIds.add(hookInput.agent_id);
  }

  let parentToolUseId: string | undefined;
  for (const [toolId, info] of activeTools) {
    if (info.tool === "Task") {
      parentToolUseId = toolId;
    }
  }

  const description = parentToolUseId ? taskToolDescriptions.get(parentToolUseId) : undefined;

  emit({
    type: isTeammate ? "teammate_started" : "subagent_started",
    agentId: hookInput.agent_id,
    agentType: hookInput.agent_type,
    sessionId: hookInput.session_id,
    parentToolUseId,
    description,
  });
  return {};
};
```

**Step 3: Detect teammates in subagentStopHook**

Modify `subagentStopHook` (line 1135):

```typescript
const subagentStopHook: HookCallback = async (input) => {
  const hookInput = input as SubagentStopHookInput;
  const isTeammate = teammateAgentIds.has(hookInput.agent_id);

  sessionToAgentId.delete(hookInput.session_id);
  for (const [toolId, info] of subagentActiveTools) {
    if (info.agentId === hookInput.agent_id) {
      subagentActiveTools.delete(toolId);
    }
  }

  if (isTeammate) {
    teammateAgentIds.delete(hookInput.agent_id);
  }

  emit({
    type: isTeammate ? "teammate_stopped" : "subagent_stopped",
    agentId: hookInput.agent_id,
    stopHookActive: hookInput.stop_hook_active,
    transcriptPath: hookInput.agent_transcript_path,
    sessionId: hookInput.session_id,
  });
  return {};
};
```

**Step 4: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/agent-runner && npm run build`
Expected: BUILD SUCCESS

**Step 5: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(agent-runner): detect teammate agents in subagent hooks"
```

---

## Task 6: Agent Runner — Stream Teammate Text

**Files:**
- Modify: `agent-runner/src/index.ts:1751-1824` (handleMessage / isSubAgentMessage filtering)

**Step 1: Forward streaming text for teammate sessions**

In the `handleMessage` function, find the block where `isSubAgentMessage` is used to filter `stream_event` messages (around line 1824). Modify the filtering to allow teammate text through:

Before (line 1824):
```typescript
if (isSubAgentMessage) break;
```

After:
```typescript
if (isSubAgentMessage) {
  // For teammates, forward streaming text to backend for routing
  const agentId = sessionToAgentId.get(msgSessionId!);
  if (agentId && teammateAgentIds.has(agentId)) {
    // Forward text deltas for teammates
    if (message.type === "content_block_delta") {
      const delta = (message as any).delta;
      if (delta?.type === "text_delta" && delta.text) {
        emit({
          type: "assistant_text",
          content: delta.text,
          agentId,
        });
      }
    }
  }
  break;
}
```

Also, in the block that filters `tool_use` blocks for subagents (line 1769), ensure teammate tools still flow:

Before:
```typescript
} else if (block.type === "tool_use" && !isSubAgentMessage) {
```

This is fine — teammate tool events already flow through the `toolStartHook`/`toolEndHook` which emit `tool_start`/`tool_end` with `agentId`. No change needed here.

**Step 2: Tag todo events with agentId**

Find where `todo_update` events are emitted. If they come through as tool events (TaskCreate/TaskUpdate), they already have `agentId` from the tool routing. Verify this is the case — if todos are emitted separately, tag them:

```typescript
// In the todos event emission path, add agentId if from a subagent
emit({
  type: "todo_update",
  todos: todoItems,
  agentId, // from the current agent context
});
```

**Step 3: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/agent-runner && npm run build`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(agent-runner): forward streaming text for teammate agents"
```

---

## Task 7: Agent Runner — Handle Teammate Messages

**Files:**
- Modify: `agent-runner/src/index.ts:204-222` (InputMessage interface)
- Modify: `agent-runner/src/index.ts:407-665` (setupInputQueue)

**Step 1: Extend InputMessage interface**

Add teammate message fields (line 204):

```typescript
interface InputMessage {
  type: "message" | "teammate_message" | "stop" | "interrupt" | "set_model" | "set_permission_mode" | "set_max_thinking_tokens" | "get_supported_models" | "get_supported_commands" | "get_mcp_status" | "get_account_info" | "rewind_files" | "user_question_response" | "plan_approval_response" | "reconnect_mcp_server" | "toggle_mcp_server";
  content?: string;
  // ...existing fields...
  targetAgentId?: string;    // NEW: for teammate_message
  targetAgentName?: string;  // NEW: display name for relay
}
```

**Step 2: Handle teammate_message in setupInputQueue**

In the `rl.on("line")` handler within `setupInputQueue` (around line 628, before the "message" type handling), add a new case:

```typescript
if (input.type === "teammate_message" && input.content && input.targetAgentId) {
  // Relay through the lead agent via natural language instruction
  const relayContent = [
    `The user wants to send a direct message to teammate "${input.targetAgentName || input.targetAgentId}".`,
    `Please relay this message using the SendMessage tool:`,
    ``,
    `---`,
    input.content,
    `---`,
    ``,
    `Important: Relay this message exactly as written. Do not interpret, summarize, or modify it.`,
  ].join('\n');

  const queued: QueuedMessage = {
    content: relayContent,
    attachments: input.attachments,
  };

  if (messageWaiter) {
    const waiter = messageWaiter;
    messageWaiter = null;
    waiter(queued);
  } else {
    messageQueue.push(queued);
  }
  return; // Don't fall through to other type handling
}
```

**Step 3: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/agent-runner && npm run build`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(agent-runner): handle teammate_message via natural language relay"
```

---

## Task 8: Backend Manager — Auto-Create Teammate Conversations

**Files:**
- Modify: `backend/agent/manager.go:351+` (handleConversationOutput)

**Step 1: Add teammate state tracking**

In `handleConversationOutput` (line 351), after `activeSubAgents` declaration (line 358), add:

```go
// Teammate tracking: agentId → conversationId for routing events
teammateConvMap := make(map[string]string)
// Track whether team overview has been created
teamOverviewCreated := false
```

**Step 2: Handle teammate_started event**

In the event type switch (after the `EventTypeSubagentStarted` case at line 719), add a new case:

```go
case EventTypeTeammateStarted:
    if event.AgentId != "" {
        sessionID := "" // Need to look up session ID
        if conv, err := m.store.GetConversationMeta(ctx, convID); err == nil && conv != nil {
            sessionID = conv.SessionID
        }

        // Auto-create Team Overview conversation (once, on first teammate)
        if !teamOverviewCreated && len(teammateConvMap) == 0 {
            overviewConvID := generateShortID()
            now := time.Now()
            overviewConv := &models.Conversation{
                ID:                   overviewConvID,
                SessionID:            sessionID,
                Type:                 models.ConversationTypeTeamOverview,
                Name:                 "Team",
                Status:               models.ConversationStatusActive,
                ParentConversationID: convID,
                CreatedAt:            now,
                UpdatedAt:            now,
            }
            if err := m.store.AddConversation(ctx, overviewConv); err != nil {
                logger.Process.Errorf("Failed to create team overview conversation: %v", err)
            } else {
                teamOverviewCreated = true
                if m.onConversationEvent != nil {
                    m.onConversationEvent(convID, &AgentEvent{
                        Type:           EventTypeTeamOverviewCreated,
                        ConversationID: overviewConvID,
                    })
                }
            }
        }

        // Create teammate conversation
        teammateConvID := generateShortID()
        teammateName := event.AgentDescription
        if teammateName == "" {
            teammateName = fmt.Sprintf("Teammate %d", len(teammateConvMap)+1)
        }
        now := time.Now()
        teammateConv := &models.Conversation{
            ID:                   teammateConvID,
            SessionID:            sessionID,
            Type:                 models.ConversationTypeTeammate,
            Name:                 teammateName,
            Status:               models.ConversationStatusActive,
            ParentConversationID: convID,
            TeamAgentId:          event.AgentId,
            TeammateName:         teammateName,
            CreatedAt:            now,
            UpdatedAt:            now,
        }
        if err := m.store.AddConversation(ctx, teammateConv); err != nil {
            logger.Process.Errorf("Failed to create teammate conversation: %v", err)
        } else {
            teammateConvMap[event.AgentId] = teammateConvID

            // Also register in activeSubAgents for snapshot tracking
            sa := &SubAgentEntry{
                AgentId:     event.AgentId,
                AgentType:   event.AgentType,
                Description: event.AgentDescription,
                StartTime:   time.Now().Unix(),
            }
            if pending, ok := pendingSubAgentTools[event.AgentId]; ok {
                sa.ActiveTools = append(sa.ActiveTools, pending...)
                delete(pendingSubAgentTools, event.AgentId)
            }
            activeSubAgents[event.AgentId] = sa

            // Broadcast to WebSocket
            if m.onConversationEvent != nil {
                m.onConversationEvent(convID, &AgentEvent{
                    Type:             EventTypeTeammateCreated,
                    AgentId:          event.AgentId,
                    ConversationID:   teammateConvID,
                    AgentDescription: teammateName,
                    AgentType:        event.AgentType,
                })
            }
        }
        markSnapshotDirty()
    }
```

**Step 3: Handle teammate_stopped event**

After the `EventTypeSubagentStopped` case, add:

```go
case EventTypeTeammateStopped:
    if teammateConvID, ok := teammateConvMap[event.AgentId]; ok {
        // Update conversation status
        if err := m.store.UpdateConversationStatus(ctx, teammateConvID, models.ConversationStatusCompleted); err != nil {
            logger.Process.Errorf("Failed to update teammate status: %v", err)
        }

        // Also complete in activeSubAgents
        if sa, ok := activeSubAgents[event.AgentId]; ok {
            sa.Completed = true
        }

        // Broadcast completion
        if m.onConversationEvent != nil {
            m.onConversationEvent(teammateConvID, &AgentEvent{
                Type:           EventTypeTeammateCompleted,
                AgentId:        event.AgentId,
                ConversationID: teammateConvID,
            })
        }
        markSnapshotDirty()
    }
```

Note: `generateShortID()` should already exist in the codebase — search for it. If not, use `uuid.New().String()[:8]` pattern (import `github.com/google/uuid`).

Note: `UpdateConversationStatus` — check if this function exists. If not, add a simple one:
```go
func (s *SQLiteStore) UpdateConversationStatus(ctx context.Context, convID, status string) error {
    return RetryDBExec(ctx, "UpdateConversationStatus", DefaultRetryConfig(), func(ctx context.Context) error {
        _, err := s.db.ExecContext(ctx, `UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?`,
            status, time.Now(), convID)
        return err
    })
}
```

**Step 4: Run build and tests**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go test ./agent/... -v -count=1`
Expected: All existing tests PASS

**Step 5: Commit**

```bash
git add backend/agent/manager.go backend/store/sqlite.go
git commit -m "feat(manager): auto-create teammate conversations on teammate_started"
```

---

## Task 9: Backend Manager — Route Teammate Events

**Files:**
- Modify: `backend/agent/manager.go` (event routing in handleConversationOutput)

**Step 1: Route assistant_text events for teammates**

In the `EventTypeAssistantText` case (line 542), add teammate routing before the existing text accumulation:

```go
case EventTypeAssistantText:
    // Route teammate text to their conversation
    if event.AgentId != "" {
        if teammateConvID, ok := teammateConvMap[event.AgentId]; ok {
            if m.onConversationEvent != nil {
                teammateEvent := *event // copy
                teammateEvent.ConversationID = teammateConvID
                m.onConversationEvent(teammateConvID, &teammateEvent)
            }
            markSnapshotDirty()
            continue // Don't add to lead's text
        }
    }
    // ...existing lead text accumulation (unchanged)
```

**Step 2: Route tool_start events for teammates**

In the `EventTypeToolStart` case (line 562), where `event.AgentId != ""` is already checked, add teammate broadcast:

```go
if event.AgentId != "" {
    // Route to sub-agent's active tools
    if sa, ok := activeSubAgents[event.AgentId]; ok {
        sa.ActiveTools = append(sa.ActiveTools, entry)
    } else {
        pendingSubAgentTools[event.AgentId] = append(pendingSubAgentTools[event.AgentId], entry)
    }
    // NEW: Also broadcast to teammate's conversation for live UI
    if teammateConvID, ok := teammateConvMap[event.AgentId]; ok {
        if m.onConversationEvent != nil {
            teammateEvent := *event
            teammateEvent.ConversationID = teammateConvID
            m.onConversationEvent(teammateConvID, &teammateEvent)
        }
    }
}
```

**Step 3: Route tool_end events for teammates**

In the `EventTypeToolEnd` case (line 632), in the `event.AgentId != ""` branch:

```go
if event.AgentId != "" {
    if sa, ok := activeSubAgents[event.AgentId]; ok {
        // ...existing removal logic...
    }
    // NEW: Broadcast to teammate's conversation
    if teammateConvID, ok := teammateConvMap[event.AgentId]; ok {
        if m.onConversationEvent != nil {
            teammateEvent := *event
            teammateEvent.ConversationID = teammateConvID
            m.onConversationEvent(teammateConvID, &teammateEvent)
        }
    }
}
```

**Step 4: Route todo_update events with agentId**

In the `EventTypeTodoUpdate` case, add teammate routing:

```go
case EventTypeTodoUpdate:
    if event.AgentId != "" {
        if teammateConvID, ok := teammateConvMap[event.AgentId]; ok {
            if m.onConversationEvent != nil {
                teammateEvent := *event
                teammateEvent.ConversationID = teammateConvID
                m.onConversationEvent(teammateConvID, &teammateEvent)
            }
            continue // Route to teammate, not lead
        }
    }
    // ...existing todo handling for lead
```

**Step 5: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

**Step 6: Commit**

```bash
git add backend/agent/manager.go
git commit -m "feat(manager): route teammate text/tool/todo events to child conversations"
```

---

## Task 10: Backend — Teammate Message Endpoint

**Files:**
- Modify: `backend/server/handlers.go` (new handler)
- Modify: `backend/server/router.go:180-197` (new routes)
- Modify: `backend/agent/manager.go` (SendTeammateMessage method)

**Step 1: Add SendTeammateMessage to Manager**

In `backend/agent/manager.go`, add after `SendConversationMessage`:

```go
// SendTeammateMessage routes a user message to a teammate via the lead process.
func (m *Manager) SendTeammateMessage(ctx context.Context, leadConvID, targetAgentId, targetAgentName, content string, attachments []models.Attachment) error {
    m.mu.RLock()
    proc, ok := m.convProcesses[leadConvID]
    m.mu.RUnlock()

    if !ok || !proc.IsRunning() {
        return fmt.Errorf("lead process not running for conversation %s", leadConvID)
    }

    return proc.sendInput(InputMessage{
        Type:            "teammate_message",
        Content:         content,
        Attachments:     attachments,
        TargetAgentId:   targetAgentId,
        TargetAgentName: targetAgentName,
    })
}
```

**Step 2: Add handler in handlers.go**

Add after `SendConversationMessage` handler:

```go
// SendTeammateMessage routes a user message to a specific teammate.
func (h *Handlers) SendTeammateMessage(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    convID := chi.URLParam(r, "convId")

    var req struct {
        Content     string              `json:"content"`
        Attachments []models.Attachment `json:"attachments"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid request body", http.StatusBadRequest)
        return
    }
    if req.Content == "" {
        http.Error(w, "content is required", http.StatusBadRequest)
        return
    }

    // Fetch teammate conversation to get parent and agent ID
    conv, err := h.store.GetConversationMeta(ctx, convID)
    if err != nil {
        writeDBError(w, err)
        return
    }
    if conv == nil {
        writeNotFound(w, "conversation")
        return
    }
    if conv.Type != models.ConversationTypeTeammate {
        http.Error(w, "not a teammate conversation", http.StatusBadRequest)
        return
    }

    // Store user message in teammate's conversation for history
    msg := models.Message{
        ID:             generateMessageID(),
        ConversationID: convID,
        Role:           "user",
        Content:        req.Content,
        CreatedAt:      time.Now(),
    }
    if err := h.store.AddMessage(ctx, convID, &msg); err != nil {
        logger.Process.Errorf("Failed to store teammate user message: %v", err)
        // Non-fatal — continue with routing
    }

    // Route through the lead's process
    if err := h.agentManager.SendTeammateMessage(
        ctx,
        conv.ParentConversationID,
        conv.TeamAgentId,
        conv.TeammateName,
        req.Content,
        req.Attachments,
    ); err != nil {
        writeJSONStatus(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
        return
    }

    writeJSONStatus(w, http.StatusAccepted, map[string]string{"status": "sent"})
}

// GetTeammateConversations returns all teammate conversations for a lead.
func (h *Handlers) GetTeammateConversations(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    convID := chi.URLParam(r, "convId")

    convs, err := h.store.GetTeammateConversations(ctx, convID)
    if err != nil {
        writeDBError(w, err)
        return
    }
    writeJSON(w, convs)
}
```

Note: Check how `generateMessageID` works in the codebase (search for existing message ID generation pattern).

**Step 3: Register routes**

In `backend/server/router.go`, after line 193 (within the `/api/conversations/{convId}` group), add:

```go
r.Post("/api/conversations/{convId}/teammate-message", h.SendTeammateMessage)
r.Get("/api/conversations/{convId}/teammates", h.GetTeammateConversations)
```

**Step 4: Run build and tests**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go test ./server/... -v -count=1`
Expected: All existing tests PASS

**Step 5: Commit**

```bash
git add backend/server/handlers.go backend/server/router.go backend/agent/manager.go
git commit -m "feat(api): add teammate message and listing endpoints"
```

---

## Task 11: Frontend Types — Add Teammate Fields

**Files:**
- Modify: `src/lib/types.ts:53-68` (Conversation interface)

**Step 1: Add teammate fields to Conversation interface**

```typescript
export interface Conversation {
  id: string;
  sessionId: string;
  type: 'task' | 'review' | 'chat' | 'teammate' | 'team-overview'; // MODIFIED
  name: string;
  status: 'active' | 'idle' | 'completed';
  model?: string;
  budgetConfig?: { maxBudgetUsd?: number; maxTurns?: number };
  thinkingConfig?: { effort?: string; maxThinkingTokens?: number };
  messages: Message[];
  messageCount?: number;
  toolSummary: ToolAction[];
  createdAt: string;
  updatedAt: string;
  parentConversationId?: string;  // NEW: links to lead conversation
  teamAgentId?: string;           // NEW: SDK agent_id for routing
  teammateName?: string;          // NEW: display name
}
```

**Step 2: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: No new errors (type union is backward-compatible)

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add teammate fields to Conversation interface"
```

---

## Task 12: Frontend API — Add Teammate Message Function

**Files:**
- Modify: `src/lib/api.ts`

**Step 1: Add sendTeammateMessage function**

Add after existing `sendConversationMessage`:

```typescript
export async function sendTeammateMessage(
  conversationId: string,
  content: string,
  attachments?: Attachment[]
): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/conversations/${conversationId}/teammate-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, attachments: attachments || [] }),
  });
}

export async function getTeammateConversations(
  conversationId: string
): Promise<Conversation[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/conversations/${conversationId}/teammates`
  );
  return handleResponse<Conversation[]>(res);
}
```

**Step 2: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): add sendTeammateMessage and getTeammateConversations"
```

---

## Task 13: App Store — Add Team Selectors

**Files:**
- Modify: `src/stores/appStore.ts`

**Step 1: Add teammate helper selectors**

Add to the store actions:

```typescript
// Check if a session has an active team
hasActiveTeam: (sessionId: string) => {
  return get().conversations.some(
    c => c.sessionId === sessionId && c.type === 'teammate'
  );
},

// Get all teammate conversations for a lead conversation
getTeammateConversations: (parentConvId: string) => {
  return get().conversations.filter(
    c => c.parentConversationId === parentConvId && c.type === 'teammate'
  );
},

// Get team overview conversation for a lead
getTeamOverviewConversation: (parentConvId: string) => {
  return get().conversations.find(
    c => c.parentConversationId === parentConvId && c.type === 'team-overview'
  );
},
```

Also add to the AppState interface the corresponding signatures.

**Step 2: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(store): add hasActiveTeam and teammate selector helpers"
```

---

## Task 14: WebSocket — Handle Teammate Events

**Files:**
- Modify: `src/hooks/useWebSocket.ts:936-960` (event switch)

**Step 1: Add teammate event handlers**

In the event switch, after the `subagent_stopped` case (line 954), add:

```typescript
case 'teammate_created': {
  const teammateConv: Conversation = {
    id: event.conversationId as string,
    sessionId: currentSessionId,
    type: 'teammate',
    name: (event.description as string) || 'Teammate',
    status: 'active',
    parentConversationId: conversationId, // the lead
    teamAgentId: event.agentId as string,
    teammateName: (event.description as string) || 'Teammate',
    messages: [],
    toolSummary: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.addConversation(teammateConv);
  // Don't auto-switch — user stays on lead tab
  break;
}

case 'teammate_completed': {
  if (event.conversationId) {
    // Find and update the conversation status
    const convs = store.conversations;
    const idx = convs.findIndex(c => c.id === event.conversationId);
    if (idx !== -1) {
      const updated = { ...convs[idx], status: 'completed' as const };
      store.updateConversation(event.conversationId as string, updated);
    }
  }
  break;
}

case 'team_overview_created': {
  const overviewConv: Conversation = {
    id: event.conversationId as string,
    sessionId: currentSessionId,
    type: 'team-overview',
    name: 'Team',
    status: 'active',
    parentConversationId: conversationId,
    messages: [],
    toolSummary: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.addConversation(overviewConv);
  break;
}
```

Note: Check if `store.updateConversation` exists with this signature. If not, you may need to use a different update pattern (e.g., `set(state => ({ conversations: state.conversations.map(...) }))`). Check the store for the exact update pattern used.

**Step 2: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/hooks/useWebSocket.ts
git commit -m "feat(ws): handle teammate_created, teammate_completed, team_overview_created events"
```

---

## Task 15: Tab Icons — Teammate-Specific Indicators

**Files:**
- Modify: `src/components/conversation/ConversationArea.tsx:456-488` (getStatusIndicator)

**Step 1: Add teammate-specific icons**

In `getStatusIndicator` callback (line 456), add teammate detection before the existing switch:

```typescript
const getStatusIndicator = useCallback(
  (conv: Conversation) => {
    const isConvStreaming = sessionStreamingFlat[`${conv.id}:s`];
    const convError = sessionStreamingFlat[`${conv.id}:e`];

    // Team overview icon
    if (conv.type === 'team-overview') {
      return <LayoutGrid className="w-2.5 h-2.5 text-muted-foreground" />;
    }

    // Teammate icon with status
    if (conv.type === 'teammate') {
      if (isConvStreaming) {
        return <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />;
      }
      if (conv.status === 'completed') {
        return <CheckCircle2 className="w-2.5 h-2.5 text-text-success" />;
      }
      return <Users className="w-2.5 h-2.5 text-muted-foreground" />;
    }

    // ...existing logic unchanged...
  },
  [sessionStreamingFlat, isFreshConversation]
);
```

Add imports at top of file:
```typescript
import { Users, LayoutGrid, Loader2 } from 'lucide-react';
```

**Step 2: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/conversation/ConversationArea.tsx
git commit -m "feat(tabs): add teammate and team-overview specific tab icons"
```

---

## Task 16: TeammateHeader Component

**Files:**
- Create: `src/components/conversation/TeammateHeader.tsx`
- Modify: `src/components/conversation/ConversationArea.tsx`

**Step 1: Create TeammateHeader component**

```typescript
'use client';

import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/appStore';
import type { Conversation } from '@/lib/types';

interface TeammateHeaderProps {
  conversation: Conversation;
}

export function TeammateHeader({ conversation }: TeammateHeaderProps) {
  const selectConversation = useAppStore(s => s.selectConversation);
  const conversations = useAppStore(s => s.conversations);
  const parentConv = conversations.find(c => c.id === conversation.parentConversationId);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      <Users size={16} className="text-muted-foreground" />
      <span className="font-medium text-sm">{conversation.name}</span>
      <Badge variant={conversation.status === 'active' ? 'default' : 'secondary'}>
        {conversation.status}
      </Badge>
      {parentConv && (
        <button
          onClick={() => selectConversation(parentConv.id)}
          className="text-xs text-muted-foreground hover:underline ml-auto"
        >
          ← Back to lead
        </button>
      )}
    </div>
  );
}
```

**Step 2: Render TeammateHeader in ConversationArea**

In `ConversationArea.tsx`, in the conversation content branch (after the `isFileActive` check at line 990), add TeammateHeader rendering before the message list:

```typescript
{/* Teammate header bar */}
{conversation?.type === 'teammate' && (
  <TeammateHeader conversation={conversation} />
)}
```

**Step 3: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/conversation/TeammateHeader.tsx src/components/conversation/ConversationArea.tsx
git commit -m "feat(ui): add TeammateHeader component with back-to-lead navigation"
```

---

## Task 17: TeamOverviewDashboard Component

**Files:**
- Create: `src/components/conversation/TeamOverviewDashboard.tsx`
- Modify: `src/components/conversation/ConversationArea.tsx`

**Step 1: Create TeamOverviewDashboard component**

```typescript
'use client';

import { memo, useMemo } from 'react';
import { LayoutGrid, Users, Loader2, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/appStore';
import type { Conversation } from '@/lib/types';

interface TeamOverviewDashboardProps {
  conversation: Conversation;
}

function TeammateStatusCard({ conversation }: { conversation: Conversation }) {
  const selectConversation = useAppStore(s => s.selectConversation);
  const agentTodos = useAppStore(s => s.agentTodos[conversation.id] || []);

  const activeTodos = agentTodos.filter(t => t.status === 'in_progress');
  const completedTodos = agentTodos.filter(t => t.status === 'completed');

  return (
    <div
      className="border rounded-lg p-3 hover:bg-surface-2 cursor-pointer transition-colors"
      onClick={() => selectConversation(conversation.id)}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-2 mb-2">
        {conversation.status === 'active' ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : (
          <CheckCircle2 size={14} className="text-text-success" />
        )}
        <span className="font-medium text-sm truncate">{conversation.name}</span>
      </div>

      {activeTodos.length > 0 && (
        <p className="text-xs text-muted-foreground truncate mb-1">
          {activeTodos[0].activeForm}
        </p>
      )}

      <div className="flex items-center gap-3 text-2xs text-muted-foreground">
        <span>{completedTodos.length}/{agentTodos.length} tasks</span>
      </div>
    </div>
  );
}

const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };

export const TeamOverviewDashboard = memo(function TeamOverviewDashboard({
  conversation,
}: TeamOverviewDashboardProps) {
  const parentConvId = conversation.parentConversationId;
  const conversations = useAppStore(s => s.conversations);
  const agentTodos = useAppStore(s => s.agentTodos);

  const teammates = useMemo(
    () => conversations.filter(
      c => c.parentConversationId === parentConvId && c.type === 'teammate'
    ),
    [conversations, parentConvId]
  );

  const taskGroups = useMemo(() => {
    return teammates
      .map(tm => ({
        convId: tm.id,
        convName: tm.name,
        todos: [...(agentTodos[tm.id] || [])].sort(
          (a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
        ),
      }))
      .filter(g => g.todos.length > 0);
  }, [teammates, agentTodos]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <LayoutGrid size={18} className="text-muted-foreground" />
        <span className="text-lg font-semibold">Team Overview</span>
        <Badge variant="secondary">{teammates.length} teammate{teammates.length !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="p-4 space-y-6">
        {/* Teammate Status Cards */}
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Teammates</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teammates.map(tm => (
              <TeammateStatusCard key={tm.id} conversation={tm} />
            ))}
          </div>
          {teammates.length === 0 && (
            <p className="text-sm text-muted-foreground">No teammates yet.</p>
          )}
        </section>

        {/* Task List */}
        {taskGroups.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Tasks</h3>
            <div className="space-y-4">
              {taskGroups.map(group => (
                <div key={group.convId}>
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} className="text-muted-foreground" />
                    <span className="text-sm font-medium">{group.convName}</span>
                  </div>
                  <div className="space-y-0.5 pl-5">
                    {group.todos.map((todo, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        {todo.status === 'completed' ? (
                          <CheckCircle2 size={12} className="text-text-success shrink-0" />
                        ) : todo.status === 'in_progress' ? (
                          <Loader2 size={12} className="animate-spin text-primary shrink-0" />
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-muted-foreground/50 shrink-0" />
                        )}
                        <span className={todo.status === 'completed' ? 'opacity-50 line-through' : ''}>
                          {todo.status === 'in_progress' ? todo.activeForm : todo.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
});
```

**Step 2: Render TeamOverviewDashboard in ConversationArea**

In `ConversationArea.tsx`, add an early return before the main content area (before line 990):

```typescript
// Team overview — full dashboard, no messages or compose
if (conversation?.type === 'team-overview') {
  return (
    <div className="flex flex-col h-full">
      {/* TabBar still renders above */}
      <TeamOverviewDashboard conversation={conversation} />
    </div>
  );
}
```

Import at top:
```typescript
import { TeamOverviewDashboard } from '@/components/conversation/TeamOverviewDashboard';
```

**Step 3: Run lint and build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/conversation/TeamOverviewDashboard.tsx src/components/conversation/ConversationArea.tsx
git commit -m "feat(ui): add TeamOverviewDashboard with status cards and task list"
```

---

## Task 18: ChatInput — Teammate Compose Behavior

**Files:**
- Modify: `src/components/conversation/ChatInput.tsx`

**Step 1: Add teammate detection**

Near the top of the ChatInput component, add:

```typescript
const isTeammateConversation = currentConversation?.type === 'teammate';
const isTeamOverview = currentConversation?.type === 'team-overview';
```

**Step 2: Hide compose for team-overview**

Early return if team-overview:

```typescript
if (isTeamOverview) {
  return null; // No input for dashboard view
}
```

**Step 3: Modify handleSubmit for teammates**

In `handleSubmit` (line 777), before the existing logic, add teammate routing:

```typescript
const handleSubmit = async () => {
  const { text: content, mentionedFiles } = plateInputRef.current?.getContent() ?? { text: '', mentionedFiles: [] };
  const hasContent = !!content.trim();
  const hasAttachments = attachments.length > 0;
  if ((!hasContent && !hasAttachments) || !selectedWorkspaceId || !selectedSessionId || isSending || hasQueuedMessage) return;

  // Teammate message routing
  if (isTeammateConversation && currentConversation) {
    setIsSending(true);
    try {
      const trimmedContent = content.trim();
      // Add user message to local state immediately
      addMessage({
        id: crypto.randomUUID(),
        conversationId: currentConversation.id,
        role: 'user',
        content: trimmedContent,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      // Route through teammate endpoint
      await sendTeammateMessage(currentConversation.id, trimmedContent, attachments);
      plateInputRef.current?.clear();
      setAttachments([]);
    } finally {
      setIsSending(false);
    }
    return;
  }

  // ...existing handleSubmit logic unchanged...
};
```

Add import:
```typescript
import { sendTeammateMessage } from '@/lib/api';
```

**Step 4: Adjust compose UI for teammates**

In the render section, hide controls that don't apply:

```typescript
{/* Hide model/thinking/plan controls for teammate conversations */}
{!isTeammateConversation && (
  <>
    {/* ModelSelector, ThinkingToggle, PlanModeToggle, EffortSelector */}
  </>
)}
```

Change placeholder:
```typescript
placeholder={isTeammateConversation ? "Message this teammate..." : "Type a message..."}
```

**Step 5: Run lint**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/conversation/ChatInput.tsx
git commit -m "feat(chat): route teammate messages through dedicated endpoint"
```

---

## Task 19: SubAgentGroup — TeammateCard for Lead View

**Files:**
- Modify: `src/components/conversation/SubAgentGroup.tsx`

**Step 1: Add TeammateCard component**

Add after the existing imports and before `SubAgentRow`:

```typescript
import { CheckCircle2, Loader2, Users, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

// Clickable card for teammate-type subagents — navigates to teammate's tab
const TeammateCard = memo(function TeammateCard({ agent }: { agent: SubAgent }) {
  const conversations = useAppStore(s => s.conversations);
  const selectConversation = useAppStore(s => s.selectConversation);

  const teammateConv = useMemo(
    () => conversations.find(c => c.teamAgentId === agent.agentId),
    [conversations, agent.agentId]
  );

  const displayDescription = useMemo(() => {
    if (!agent.description) return 'Teammate';
    return stripAgentPrefix(agent.description, agent.agentType);
  }, [agent.description, agent.agentType]);

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (teammateConv) {
      selectConversation(teammateConv.id);
    }
  };

  const completedTools = agent.tools.filter(t => t.endTime).length;
  const totalTools = agent.tools.length;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors',
        'bg-surface-1 hover:bg-surface-2 cursor-pointer',
        !agent.completed && 'border-primary/20',
        agent.completed && 'border-border/50',
      )}
      onClick={handleNavigate}
      role="button"
      tabIndex={0}
    >
      <span className="flex items-center justify-center w-4 h-4 shrink-0">
        {agent.completed ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-text-success" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
        )}
      </span>

      <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

      <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
        {displayDescription}
      </span>

      {totalTools > 0 && (
        <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
          {completedTools}/{totalTools}
        </span>
      )}

      {agent.completed && agent.endTime ? (
        <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
          {((agent.endTime - agent.startTime) / 1000).toFixed(1)}s
        </span>
      ) : !agent.completed ? (
        <AgentElapsedTime startTime={agent.startTime} />
      ) : null}

      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
    </div>
  );
});

// Group wrapper for multiple teammate cards
function TeammateGroup({ teammates }: { teammates: readonly SubAgent[] }) {
  return (
    <div className="space-y-1 my-1">
      <div className="flex items-center gap-1.5 px-1.5">
        <Users className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Team ({teammates.length} teammate{teammates.length !== 1 ? 's' : ''})
        </span>
      </div>
      <div className="space-y-1 ml-1">
        {teammates.map(agent => (
          <TeammateCard key={agent.agentId} agent={agent} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Modify SubAgentGroup to separate teammates**

Replace the existing `SubAgentGroup` component (line 395):

```typescript
export const SubAgentGroup = memo(function SubAgentGroup({ subAgents, worktreePath }: SubAgentGroupProps) {
  if (subAgents.length === 0) return null;

  // Separate teammates from regular subagents
  const teammates = subAgents.filter(a => a.agentType === 'teammate' || a.agentType === 'team_member');
  const regularAgents = subAgents.filter(a => a.agentType !== 'teammate' && a.agentType !== 'team_member');

  return (
    <div className="space-y-0.5">
      {teammates.length > 0 && (
        <TeammateGroup teammates={teammates} />
      )}
      {regularAgents.map((agent) => (
        <SubAgentRow key={agent.agentId} agent={agent} worktreePath={worktreePath} />
      ))}
    </div>
  );
});
```

**Step 3: Add teammate label to getAgentLabel**

In `getAgentLabel` (line 20), add:

```typescript
case 'teammate':
case 'team_member':
  return 'Teammate';
```

**Step 4: Run lint and build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint && npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/conversation/SubAgentGroup.tsx
git commit -m "feat(ui): add TeammateCard and TeammateGroup in SubAgentGroup"
```

---

## Task 20: Adaptive TodoPanel — Team Mode

**Files:**
- Modify: `src/components/panels/TodoPanel.tsx`

**Step 1: Add team-mode detection and grouped rendering**

Replace the TodoPanel with an adaptive version:

```typescript
'use client';

import { useMemo, memo } from 'react';
import { CheckCircle2, Circle, Loader2, Users } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds } from '@/hooks/useSelectedIds';
import type { AgentTodoItem } from '@/lib/types';

const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={14} className="text-text-success shrink-0" />;
    case 'in_progress':
      return <Loader2 size={14} className="animate-spin text-primary shrink-0" />;
    default:
      return <Circle size={14} className="text-muted-foreground/50 shrink-0" />;
  }
}

function AgentTodoRow({ todo }: { todo: AgentTodoItem }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <StatusIcon status={todo.status} />
      <span className={todo.status === 'completed' ? 'opacity-50 line-through' : ''}>
        {todo.status === 'in_progress' ? todo.activeForm : todo.content}
      </span>
    </div>
  );
}

// Solo mode — flat list of todos for the selected conversation
function SoloTodoView({ todos }: { todos: AgentTodoItem[] }) {
  if (todos.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No tasks yet
      </div>
    );
  }
  return (
    <div className="p-3 space-y-0.5 overflow-y-auto">
      {todos.map((todo, i) => (
        <AgentTodoRow key={i} todo={todo} />
      ))}
    </div>
  );
}

// Team mode — grouped by conversation (lead + teammates)
function TeamTodoView({ sessionId }: { sessionId: string }) {
  const conversations = useAppStore(s => s.conversations);
  const agentTodos = useAppStore(s => s.agentTodos);

  const groups = useMemo(() => {
    return conversations
      .filter(c => c.sessionId === sessionId && (c.type === 'teammate' || c.type === 'task'))
      .map(conv => ({
        convId: conv.id,
        convName: conv.name,
        convType: conv.type,
        todos: [...(agentTodos[conv.id] || [])].sort(
          (a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
        ),
      }))
      .filter(group => group.todos.length > 0);
  }, [conversations, sessionId, agentTodos]);

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No tasks yet
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4 overflow-y-auto">
      {groups.map(group => (
        <div key={group.convId}>
          <div className="flex items-center gap-2 mb-1">
            {group.convType === 'teammate' && <Users size={14} className="text-muted-foreground" />}
            <span className="text-sm font-medium">{group.convName}</span>
          </div>
          <div className="space-y-0.5 pl-5">
            {group.todos.map((todo, i) => (
              <AgentTodoRow key={i} todo={todo} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const TodoPanel = memo(function TodoPanel() {
  const { selectedSessionId, selectedConversationId } = useSelectedIds();
  const conversations = useAppStore(s => s.conversations);
  const agentTodos = useAppStore(s => s.agentTodos);

  const hasTeam = useMemo(
    () => conversations.some(c => c.sessionId === selectedSessionId && c.type === 'teammate'),
    [conversations, selectedSessionId]
  );

  const soloTodos = useMemo(() => {
    if (hasTeam) return [];
    const todos = selectedConversationId ? agentTodos[selectedConversationId] || [] : [];
    return [...todos].sort((a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1));
  }, [hasTeam, selectedConversationId, agentTodos]);

  if (hasTeam && selectedSessionId) {
    return <TeamTodoView sessionId={selectedSessionId} />;
  }

  return <SoloTodoView todos={soloTodos} />;
});
```

Note: Check imports and exact patterns used in the existing TodoPanel before rewriting. Preserve any existing patterns (e.g., `useSelectedIds` hook). The above is a template — adapt to match the codebase conventions.

**Step 2: Run lint and build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/panels/TodoPanel.tsx
git commit -m "feat(ui): make TodoPanel adaptive for team mode with grouped tasks"
```

---

## Task 21: StreamingMessage — Teammate Detection in Timeline

**Files:**
- Modify: `src/components/conversation/StreamingMessage.tsx` (around line 371-379)

**Step 1: Render TeammateCard for teammate subagents in timeline**

In the timeline rendering section (around line 371 for grouped subagents and line 379 for individual subagents), add teammate detection:

Find the `subagent` item rendering and wrap with a condition:

```typescript
} else if (item.type === 'subagent') {
  const isTeammate = item.agent.agentType === 'teammate' || item.agent.agentType === 'team_member';
  if (isTeammate) {
    // Import and render TeammateCard from SubAgentGroup
    return null; // Teammates are shown via TeammateGroup in SubAgentGroup, not in timeline
  }
  return (
    <SubAgentRow
      key={item.agent.agentId}
      agent={item.agent}
      worktreePath={worktreePath}
    />
  );
}
```

Similarly for `subagent_group`:
```typescript
} else if (item.type === 'subagent_group') {
  const isTeammateGroup = item.agents[0]?.agentType === 'teammate' || item.agents[0]?.agentType === 'team_member';
  if (isTeammateGroup) {
    return null; // Handled by SubAgentGroup's TeammateGroup
  }
  return (
    <SubAgentGroupedRow ... />
  );
}
```

Note: The exact approach here depends on how the timeline items are structured. If teammates should NOT appear in the interleaved timeline (since they have their own tabs), returning null is correct. If they should appear as clickable cards, import `TeammateCard` from `SubAgentGroup.tsx` and render it.

**Step 2: Run lint and build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/conversation/StreamingMessage.tsx
git commit -m "feat(ui): handle teammate subagents in streaming timeline"
```

---

## Task 22: Polish — Teammate Cleanup on Lead Stop

**Files:**
- Modify: `backend/agent/manager.go` (handleConversationOutput cleanup section)

**Step 1: Mark all teammate conversations as completed when lead stops**

In `handleConversationOutput`, find where the lead process completes/stops (look for the cleanup/defer section or the `EventTypeComplete`/`EventTypeShutdown` case). Add:

```go
// Clean up teammate conversations when lead stops
for agentId, teammateConvID := range teammateConvMap {
    _ = m.store.UpdateConversationStatus(ctx, teammateConvID, models.ConversationStatusCompleted)
    if m.onConversationEvent != nil {
        m.onConversationEvent(teammateConvID, &AgentEvent{
            Type:           EventTypeTeammateCompleted,
            AgentId:        agentId,
            ConversationID: teammateConvID,
        })
    }
}
```

**Step 2: Run build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./...`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add backend/agent/manager.go
git commit -m "fix(manager): mark all teammate conversations as completed when lead stops"
```

---

## Task 23: Full Build Verification

**Step 1: Run backend build and tests**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/backend && go build ./... && go test ./... -count=1`
Expected: BUILD SUCCESS, all tests PASS

**Step 2: Run frontend lint and build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1 && npm run lint && npm run build`
Expected: PASS

**Step 3: Run agent-runner build**

Run: `cd /Users/mcastilho/conductor/workspaces/chatml/provo-v1/agent-runner && npm run build`
Expected: BUILD SUCCESS

**Step 4: Commit any fixups**

If any build errors, fix and commit:
```bash
git add -A && git commit -m "fix: resolve build errors from agent teams implementation"
```

---

## Dependency Graph

```
Task 1 (models) ─────┐
                      ├──→ Task 2 (sqlite) ──→ Task 8 (manager auto-create)
Task 3 (event types) ─┘                        │
                                                ├──→ Task 9 (event routing)
Task 4 (env var) ──→ Task 5 (hooks) ──→ Task 6 (stream text) ──→ Task 7 (messages)
                                                │
                                                └──→ Task 10 (API endpoint)
                                                      │
Task 11 (fe types) ──→ Task 12 (fe api) ──────────────┤
                      │                                │
                      ├──→ Task 13 (store) ────────────┤
                      │                                │
                      ├──→ Task 14 (websocket) ────────┤
                      │                                │
                      ├──→ Task 15 (tab icons) ────────┤
                      │                                │
                      ├──→ Task 16 (teammate header) ──┤
                      │                                │
                      ├──→ Task 17 (team dashboard) ───┤
                      │                                │
                      ├──→ Task 18 (chat input) ───────┤
                      │                                │
                      ├──→ Task 19 (subagent group) ───┤
                      │                                │
                      ├──→ Task 20 (todo panel) ───────┤
                      │                                │
                      └──→ Task 21 (streaming msg) ────┤
                                                       │
                                                       └──→ Task 22 (cleanup) ──→ Task 23 (verify)
```

**Parallelizable clusters:**
- Tasks 1, 3, 4 can run in parallel (independent model/parser/process changes)
- Tasks 11-21 can mostly run in parallel (independent frontend components) after Tasks 1-10
- Tasks 5, 6, 7 are sequential (agent-runner changes build on each other)
- Tasks 8, 9, 10 are sequential (manager changes build on each other)
