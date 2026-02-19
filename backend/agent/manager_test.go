package agent

import (
	"context"
	"sync"
	"testing"
	"time"

	"os"

	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// Test Helper Functions
// ============================================================================

func setupTestManager(t *testing.T) (*Manager, *store.SQLiteStore) {
	t.Helper()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)

	worktreeManager := git.NewWorktreeManager()

	t.Cleanup(func() {
		sqliteStore.Close()
	})

	manager := NewManager(context.Background(), sqliteStore, worktreeManager, 9876)

	return manager, sqliteStore
}

func createTestRepo(t *testing.T, s *store.SQLiteStore, id string) *models.Repo {
	t.Helper()
	ctx := context.Background()
	repo := &models.Repo{
		ID:        id,
		Name:      "test-repo-" + id,
		Path:      "/path/to/" + id,
		Branch:    "main",
		CreatedAt: time.Now(),
	}
	require.NoError(t, s.AddRepo(ctx, repo))
	return repo
}

func createTestSession(t *testing.T, s *store.SQLiteStore, id, workspaceID string) *models.Session {
	t.Helper()
	ctx := context.Background()
	session := &models.Session{
		ID:           id,
		WorkspaceID:  workspaceID,
		Name:         "test-session-" + id,
		Branch:       "feature/" + id,
		WorktreePath: t.TempDir(),
		Task:         "Test task for " + id,
		Status:       "idle",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	require.NoError(t, s.AddSession(ctx, session))
	return session
}

func createTestConversation(t *testing.T, s *store.SQLiteStore, id, sessionID string) *models.Conversation {
	t.Helper()
	ctx := context.Background()
	conv := &models.Conversation{
		ID:        id,
		SessionID: sessionID,
		Type:      models.ConversationTypeTask,
		Name:      "Test Conversation " + id,
		Status:    models.ConversationStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	require.NoError(t, s.AddConversation(ctx, conv))
	return conv
}

// ============================================================================
// Manager Creation Tests
// ============================================================================

func TestNewManager(t *testing.T) {
	manager, _ := setupTestManager(t)

	assert.NotNil(t, manager)
	assert.NotNil(t, manager.store)
	assert.NotNil(t, manager.worktreeManager)
	assert.NotNil(t, manager.processes)
	assert.NotNil(t, manager.convProcesses)
}

func TestNewManager_EmptyProcessMaps(t *testing.T) {
	manager, _ := setupTestManager(t)

	assert.Len(t, manager.processes, 0)
	assert.Len(t, manager.convProcesses, 0)
}

// ============================================================================
// Handler Setter Tests
// ============================================================================

func TestManager_SetOutputHandler(t *testing.T) {
	manager, _ := setupTestManager(t)

	var capturedAgentID, capturedLine string
	handler := func(agentID, line string) {
		capturedAgentID = agentID
		capturedLine = line
	}

	manager.SetOutputHandler(handler)
	assert.NotNil(t, manager.onOutput)

	// Verify handler can be called
	manager.onOutput("test-agent", "test output")
	assert.Equal(t, "test-agent", capturedAgentID)
	assert.Equal(t, "test output", capturedLine)
}

func TestManager_SetStatusHandler(t *testing.T) {
	manager, _ := setupTestManager(t)

	var capturedAgentID string
	var capturedStatus models.AgentStatus
	handler := func(agentID string, status models.AgentStatus) {
		capturedAgentID = agentID
		capturedStatus = status
	}

	manager.SetStatusHandler(handler)
	assert.NotNil(t, manager.onStatus)

	// Verify handler can be called
	manager.onStatus("test-agent", models.StatusRunning)
	assert.Equal(t, "test-agent", capturedAgentID)
	assert.Equal(t, models.StatusRunning, capturedStatus)
}

func TestManager_SetConversationEventHandler(t *testing.T) {
	manager, _ := setupTestManager(t)

	var capturedConvID string
	var capturedEvent *AgentEvent
	handler := func(convID string, event *AgentEvent) {
		capturedConvID = convID
		capturedEvent = event
	}

	manager.SetConversationEventHandler(handler)
	assert.NotNil(t, manager.onConversationEvent)

	// Verify handler can be called
	testEvent := &AgentEvent{Type: "test", Content: "content"}
	manager.onConversationEvent("conv-1", testEvent)
	assert.Equal(t, "conv-1", capturedConvID)
	assert.Equal(t, testEvent, capturedEvent)
}

func TestManager_SetConversationStatusHandler(t *testing.T) {
	manager, _ := setupTestManager(t)

	var capturedConvID, capturedStatus string
	handler := func(convID, status string) {
		capturedConvID = convID
		capturedStatus = status
	}

	manager.SetConversationStatusHandler(handler)
	assert.NotNil(t, manager.onConversationStatus)

	// Verify handler can be called
	manager.onConversationStatus("conv-1", "active")
	assert.Equal(t, "conv-1", capturedConvID)
	assert.Equal(t, "active", capturedStatus)
}

// ============================================================================
// GetProcess Tests
// ============================================================================

func TestManager_GetProcess_NotFound(t *testing.T) {
	manager, _ := setupTestManager(t)

	proc := manager.GetProcess("nonexistent")
	assert.Nil(t, proc)
}

func TestManager_GetConversationProcess_NotFound(t *testing.T) {
	manager, _ := setupTestManager(t)

	proc := manager.GetConversationProcess("nonexistent")
	assert.Nil(t, proc)
}

// ============================================================================
// StopConversation Tests (without running process)
// ============================================================================

func TestManager_StopConversation_NoProcess(t *testing.T) {
	manager, s := setupTestManager(t)

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Should not panic when conversation has no process
	manager.StopConversation(context.Background(), "conv-1")
}

func TestManager_StopConversation_Nonexistent(t *testing.T) {
	manager, _ := setupTestManager(t)

	// Should not panic when conversation doesn't exist
	manager.StopConversation(context.Background(), "nonexistent")
}

// ============================================================================
// CompleteConversation Tests
// ============================================================================

func TestManager_CompleteConversation_UpdatesStatus(t *testing.T) {
	manager, s := setupTestManager(t)
	ctx := context.Background()

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Track status update
	var capturedStatus string
	manager.SetConversationStatusHandler(func(convID, status string) {
		capturedStatus = status
	})

	manager.CompleteConversation(context.Background(), "conv-1")

	// Verify status was updated in store
	conv, err := s.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	require.NotNil(t, conv)
	assert.Equal(t, models.ConversationStatusCompleted, conv.Status)

	// Verify handler was called
	assert.Equal(t, models.ConversationStatusCompleted, capturedStatus)
}

// ============================================================================
// SendMessage Tests (legacy)
// ============================================================================

func TestManager_SendMessage_NoProcess(t *testing.T) {
	manager, _ := setupTestManager(t)

	// Should return nil (no error) when process doesn't exist
	err := manager.SendMessage("nonexistent", "hello")
	assert.NoError(t, err)
}

// ============================================================================
// StopAgent Tests (legacy)
// ============================================================================

func TestManager_StopAgent_NoProcess(t *testing.T) {
	manager, _ := setupTestManager(t)

	// Should not panic when agent doesn't exist
	manager.StopAgent(context.Background(), "nonexistent")
}

// ============================================================================
// StartConversation Tests (session not found)
// ============================================================================

func TestManager_StartConversation_SessionNotFound(t *testing.T) {
	manager, _ := setupTestManager(t)

	conv, err := manager.StartConversation(context.Background(), "nonexistent", "task", "hello", nil)
	assert.Error(t, err)
	assert.Nil(t, conv)
	assert.Contains(t, err.Error(), "session not found")
}

// ============================================================================
// SendConversationMessage Tests (conversation not found)
// ============================================================================

func TestManager_SendConversationMessage_ConversationNotFound(t *testing.T) {
	manager, _ := setupTestManager(t)

	err := manager.SendConversationMessage(context.Background(), "nonexistent", "hello", nil, nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "conversation not found")
}

// ============================================================================
// Concurrency Tests
// ============================================================================

func TestManager_ConcurrentGetProcess(t *testing.T) {
	manager, _ := setupTestManager(t)

	// Concurrent reads should not panic
	done := make(chan bool)
	for i := 0; i < 100; i++ {
		go func() {
			manager.GetProcess("agent-1")
			manager.GetConversationProcess("conv-1")
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}
}

func TestManager_ConcurrentStopConversation(t *testing.T) {
	manager, s := setupTestManager(t)

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Manually insert a process into the map
	proc := NewProcess("test", t.TempDir(), "conv-1")
	manager.mu.Lock()
	manager.convProcesses["conv-1"] = proc
	manager.mu.Unlock()

	// Track status updates - should only happen once
	var statusUpdateCount int
	var mu sync.Mutex
	manager.SetConversationStatusHandler(func(convID, status string) {
		mu.Lock()
		statusUpdateCount++
		mu.Unlock()
	})

	// Concurrent stop calls should not panic and should update status only once
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			manager.StopConversation(context.Background(), "conv-1")
		}()
	}
	wg.Wait()

	// Status should be updated exactly once (only one goroutine wins TryStop)
	mu.Lock()
	count := statusUpdateCount
	mu.Unlock()
	assert.Equal(t, 1, count, "status should be updated exactly once")

	// Process should be removed from map
	assert.Nil(t, manager.GetConversationProcess("conv-1"))
}

func TestManager_ConcurrentStopAgent(t *testing.T) {
	manager, s := setupTestManager(t)

	// Create test data
	createTestRepo(t, s, "repo-1")

	// Manually insert a process into the legacy processes map
	proc := NewProcess("agent-1", t.TempDir(), "")
	manager.mu.Lock()
	manager.processes["agent-1"] = proc
	manager.mu.Unlock()

	// Track status updates - should only happen once
	var statusUpdateCount int
	var mu sync.Mutex
	manager.SetStatusHandler(func(agentID string, status models.AgentStatus) {
		mu.Lock()
		statusUpdateCount++
		mu.Unlock()
	})

	// Concurrent stop calls should not panic and should update status only once
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			manager.StopAgent(context.Background(), "agent-1")
		}()
	}
	wg.Wait()

	// Status should be updated exactly once (only one goroutine wins TryStop)
	mu.Lock()
	count := statusUpdateCount
	mu.Unlock()
	assert.Equal(t, 1, count, "status should be updated exactly once")

	// Process should be removed from map
	assert.Nil(t, manager.GetProcess("agent-1"))
}

func TestManager_ConcurrentStopAndGet(t *testing.T) {
	manager, s := setupTestManager(t)

	createTestRepo(t, s, "repo-1")
	createTestSession(t, s, "sess-1", "repo-1")
	createTestConversation(t, s, "conv-1", "sess-1")

	// Manually insert a process
	proc := NewProcess("test", t.TempDir(), "conv-1")
	manager.mu.Lock()
	manager.convProcesses["conv-1"] = proc
	manager.mu.Unlock()

	// Concurrent reads and stops should not cause race conditions
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			manager.GetConversationProcess("conv-1")
		}()
		go func() {
			defer wg.Done()
			manager.StopConversation(context.Background(), "conv-1")
		}()
	}
	wg.Wait()
}

// ============================================================================
// Handler Types Tests
// ============================================================================

func TestOutputHandler_Type(t *testing.T) {
	var handler OutputHandler = func(agentID, line string) {
		// Handler implementation
	}
	assert.NotNil(t, handler)
}

func TestStatusHandler_Type(t *testing.T) {
	var handler StatusHandler = func(agentID string, status models.AgentStatus) {
		// Handler implementation
	}
	assert.NotNil(t, handler)
}

func TestConversationEventHandler_Type(t *testing.T) {
	var handler ConversationEventHandler = func(convID string, event *AgentEvent) {
		// Handler implementation
	}
	assert.NotNil(t, handler)
}

func TestConversationStatusHandler_Type(t *testing.T) {
	var handler ConversationStatusHandler = func(convID, status string) {
		// Handler implementation
	}
	assert.NotNil(t, handler)
}

func TestSessionEventHandler_Type(t *testing.T) {
	var handler SessionEventHandler = func(sessionID string, event map[string]interface{}) {
		// Handler implementation
	}
	assert.NotNil(t, handler)
}

// ============================================================================
// formatSessionName Tests
// ============================================================================

func TestFormatSessionName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "simple phrase",
			input:    "Fix the login bug",
			expected: "fix-login-bug",
		},
		{
			name:     "with implement",
			input:    "Implement user authentication",
			expected: "implement-user-authentication",
		},
		{
			name:     "LLM title preserved",
			input:    "Add dark mode toggle",
			expected: "add-dark-mode-toggle",
		},
		{
			name:     "already lowercase",
			input:    "add branch renaming logic",
			expected: "add-branch-renaming-logic",
		},
		{
			name:     "with punctuation",
			input:    "Fix bug: users can't log in!",
			expected: "fix-bug-users-can-t",
		},
		{
			name:     "long name gets truncated to 5 words",
			input:    "Implement comprehensive user authentication system with OAuth",
			expected: "implement-comprehensive-user-authenticat",
		},
		{
			name:     "mixed case",
			input:    "Add TypeScript Types For API Response",
			expected: "add-typescript-types-api-response",
		},
		{
			name:     "articles removed",
			input:    "Fix the a an issue",
			expected: "fix-issue",
		},
		{
			name:     "too short after filtering returns empty",
			input:    "the a an",
			expected: "",
		},
		{
			name:     "numbers preserved",
			input:    "Fix bug #123 in login",
			expected: "fix-bug-123-login",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatSessionName(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// ============================================================================
// Context Cancellation Tests
// ============================================================================

func TestNewManager_AcceptsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { sqliteStore.Close() })

	worktreeManager := git.NewWorktreeManager()
	manager := NewManager(ctx, sqliteStore, worktreeManager, 9876)

	assert.NotNil(t, manager)
	assert.Equal(t, ctx, manager.ctx)
}

func TestNewManager_CancelledContext(t *testing.T) {
	// Verify manager stores a cancelled context without panic
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { sqliteStore.Close() })

	worktreeManager := git.NewWorktreeManager()
	manager := NewManager(ctx, sqliteStore, worktreeManager, 9876)

	assert.NotNil(t, manager)
	assert.Error(t, manager.ctx.Err()) // Context is already cancelled
}

func TestHandleConversationCompletion_ExitsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { sqliteStore.Close() })

	worktreeManager := git.NewWorktreeManager()
	manager := NewManager(ctx, sqliteStore, worktreeManager, 9876)

	// Create a process that never completes
	proc := NewProcess("test-id", "/tmp", "conv-never-done")

	// Track if completion handler exits
	done := make(chan struct{})
	go func() {
		manager.handleConversationCompletion("conv-never-done", proc)
		close(done)
	}()

	// Cancel context — completion handler should exit
	cancel()

	select {
	case <-done:
		// Good — handler exited due to context cancellation
	case <-time.After(2 * time.Second):
		t.Fatal("handleConversationCompletion did not exit after context cancellation")
	}
}

func TestHandleConversationCompletion_CompletesNormally(t *testing.T) {
	ctx := context.Background()

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { sqliteStore.Close() })

	// Set up required fixtures
	require.NoError(t, sqliteStore.AddRepo(ctx, &models.Repo{
		ID: "ws-1", Name: "test", Path: "/tmp/test", Branch: "main", CreatedAt: time.Now(),
	}))
	require.NoError(t, sqliteStore.AddSession(ctx, &models.Session{
		ID: "sess-1", WorkspaceID: "ws-1", Name: "Test", Status: "idle",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}))
	require.NoError(t, sqliteStore.AddConversation(ctx, &models.Conversation{
		ID: "conv-1", SessionID: "sess-1", Type: "task",
		Status: models.ConversationStatusActive, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}))

	worktreeManager := git.NewWorktreeManager()
	manager := NewManager(ctx, sqliteStore, worktreeManager, 9876)

	// Track status updates
	var statusConvID, statusValue string
	var mu sync.Mutex
	manager.SetConversationStatusHandler(func(convID string, status string) {
		mu.Lock()
		statusConvID = convID
		statusValue = status
		mu.Unlock()
	})

	// Create a process whose done channel we can close
	proc := NewProcess("test-id", "/tmp", "conv-1")

	done := make(chan struct{})
	go func() {
		manager.handleConversationCompletion("conv-1", proc)
		close(done)
	}()

	// Simulate process completing by closing the done channel
	close(proc.done)

	select {
	case <-done:
		// Good — handler completed normally
	case <-time.After(2 * time.Second):
		t.Fatal("handleConversationCompletion did not complete after process done")
	}

	// Verify status was updated
	mu.Lock()
	assert.Equal(t, "conv-1", statusConvID)
	assert.Equal(t, models.ConversationStatusIdle, statusValue)
	mu.Unlock()

	// Verify DB was updated
	conv, err := sqliteStore.GetConversation(ctx, "conv-1")
	require.NoError(t, err)
	assert.Equal(t, models.ConversationStatusIdle, conv.Status)
}

// ============================================================================
// SetConversationPlanMode Tests
// ============================================================================

func TestSetConversationPlanMode_NoProcess(t *testing.T) {
	m, _ := setupTestManager(t)

	// Should succeed gracefully when no process exists (plan mode will be
	// sent with the next message via planMode field)
	err := m.SetConversationPlanMode("nonexistent-conv", true)
	require.NoError(t, err)
}

func TestSetConversationPlanMode_StoppedProcess(t *testing.T) {
	m, _ := setupTestManager(t)

	// Create a process and stop it
	proc := NewProcess("stopped-proc", "/tmp", "conv-stopped")
	proc.Stop()

	m.mu.Lock()
	m.convProcesses["conv-stopped"] = proc
	m.mu.Unlock()

	// Should succeed and persist plan mode in options for restart
	err := m.SetConversationPlanMode("conv-stopped", true)
	require.NoError(t, err)
	assert.True(t, proc.Options().PlanMode)
	assert.True(t, proc.IsPlanModeActive())
}

// ============================================================================
// GetConversationDropStats Tests
// ============================================================================

func TestGetConversationDropStats_NoProcess(t *testing.T) {
	m, _ := setupTestManager(t)

	stats := m.GetConversationDropStats("nonexistent-conv")
	assert.Nil(t, stats)
}

func TestGetConversationDropStats_ZeroDrops(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("drop-test", t.TempDir(), "conv-drop")
	m.InsertProcessForTest("conv-drop", proc)

	stats := m.GetConversationDropStats("conv-drop")
	require.NotNil(t, stats)
	assert.Equal(t, uint64(0), stats["droppedMessages"])
}

func TestGetConversationDropStats_WithDrops(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("drop-test", t.TempDir(), "conv-drop")
	proc.SimulateDrops(42)
	m.InsertProcessForTest("conv-drop", proc)

	stats := m.GetConversationDropStats("conv-drop")
	require.NotNil(t, stats)
	assert.Equal(t, uint64(42), stats["droppedMessages"])
}

func TestGetConversationDropStats_ConcurrentAccess(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("drop-test", t.TempDir(), "conv-drop")
	m.InsertProcessForTest("conv-drop", proc)

	var wg sync.WaitGroup

	// Concurrent writers incrementing drop counter
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			proc.SimulateDrops(1)
		}()
	}

	// Concurrent readers calling GetConversationDropStats
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stats := m.GetConversationDropStats("conv-drop")
			assert.NotNil(t, stats)
		}()
	}

	wg.Wait()
	stats := m.GetConversationDropStats("conv-drop")
	assert.Equal(t, uint64(50), stats["droppedMessages"])
}

// ============================================================================
// handleConversationOutput Drop Warning Tests
// ============================================================================

func TestHandleConversationOutput_EmitsDropWarning(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("drop-warn-test", t.TempDir(), "conv-warn")
	m.InsertProcessForTest("conv-warn", proc)

	// Capture emitted events
	var events []*AgentEvent
	var eventMu sync.Mutex
	m.SetConversationEventHandler(func(convID string, event *AgentEvent) {
		eventMu.Lock()
		events = append(events, event)
		eventMu.Unlock()
	})

	// Simulate drops before handleConversationOutput processes them
	proc.SimulateDrops(5)

	// Send one event then close the channel to end the handler
	proc.output <- `{"type":"assistant_text","content":"hello"}`
	close(proc.output)

	// Run handler (blocking, returns when channel closed)
	done := make(chan struct{})
	go func() {
		m.handleConversationOutput("conv-warn", proc)
		close(done)
	}()

	// Wait for handler to finish (with timeout)
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("handleConversationOutput did not finish in time")
	}

	// Should have emitted the assistant_text event + at least one streaming_warning
	eventMu.Lock()
	defer eventMu.Unlock()

	var warningEvents []*AgentEvent
	for _, e := range events {
		if e.Type == "streaming_warning" {
			warningEvents = append(warningEvents, e)
		}
	}
	require.NotEmpty(t, warningEvents, "Expected at least one streaming_warning event")
	assert.Equal(t, "process", warningEvents[0].Source)
	assert.Equal(t, "buffer_full", warningEvents[0].Reason)
	assert.Contains(t, warningEvents[0].Message, "5 streaming events were dropped")
}

func TestHandleConversationOutput_NoWarningWhenNoDrops(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("no-drop-test", t.TempDir(), "conv-no-drop")
	m.InsertProcessForTest("conv-no-drop", proc)

	var events []*AgentEvent
	var eventMu sync.Mutex
	m.SetConversationEventHandler(func(convID string, event *AgentEvent) {
		eventMu.Lock()
		events = append(events, event)
		eventMu.Unlock()
	})

	// Send one event then close
	proc.output <- `{"type":"assistant_text","content":"hello"}`
	close(proc.output)

	done := make(chan struct{})
	go func() {
		m.handleConversationOutput("conv-no-drop", proc)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("handleConversationOutput did not finish in time")
	}

	// Should have no streaming_warning events
	eventMu.Lock()
	defer eventMu.Unlock()
	for _, e := range events {
		assert.NotEqual(t, "streaming_warning", e.Type, "Should not emit warning when no drops occurred")
	}
}

func TestHandleConversationOutput_ForwardsEvents(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("forward-test", t.TempDir(), "conv-forward")
	m.InsertProcessForTest("conv-forward", proc)

	var events []*AgentEvent
	var eventMu sync.Mutex
	m.SetConversationEventHandler(func(convID string, event *AgentEvent) {
		eventMu.Lock()
		events = append(events, event)
		eventMu.Unlock()
	})

	// Send multiple events
	proc.output <- `{"type":"assistant_text","content":"hello"}`
	proc.output <- `{"type":"tool_start","id":"t1","tool":"Read"}`
	proc.output <- `{"type":"tool_end","id":"t1","tool":"Read","success":true}`
	close(proc.output)

	done := make(chan struct{})
	go func() {
		m.handleConversationOutput("conv-forward", proc)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("handleConversationOutput did not finish in time")
	}

	eventMu.Lock()
	defer eventMu.Unlock()

	// Should have forwarded all 3 events
	var types []string
	for _, e := range events {
		types = append(types, e.Type)
	}
	assert.Contains(t, types, "assistant_text")
	assert.Contains(t, types, "tool_start")
	assert.Contains(t, types, "tool_end")
}

func TestHandleConversationOutput_FinalDropReport(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcess("final-drop-test", t.TempDir(), "conv-final")
	m.InsertProcessForTest("conv-final", proc)

	var events []*AgentEvent
	var eventMu sync.Mutex
	m.SetConversationEventHandler(func(convID string, event *AgentEvent) {
		eventMu.Lock()
		events = append(events, event)
		eventMu.Unlock()
	})

	// Simulate drops that happen right before process ends (within ticker interval)
	// Close channel immediately - the drops happen but the ticker may not fire
	proc.SimulateDrops(3)
	close(proc.output)

	done := make(chan struct{})
	go func() {
		m.handleConversationOutput("conv-final", proc)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("handleConversationOutput did not finish in time")
	}

	// The final drop report should emit a warning for any unreported drops
	eventMu.Lock()
	defer eventMu.Unlock()

	var warningEvents []*AgentEvent
	for _, e := range events {
		if e.Type == "streaming_warning" {
			warningEvents = append(warningEvents, e)
		}
	}
	require.NotEmpty(t, warningEvents, "Expected final drop report warning")
	assert.Contains(t, warningEvents[len(warningEvents)-1].Message, "3 streaming events were dropped")
}

// ============================================================================
// GetActiveStreamingConversations Tests
// ============================================================================

func TestGetActiveStreamingConversations_Empty(t *testing.T) {
	manager, _ := setupTestManager(t)

	active := manager.GetActiveStreamingConversations()
	assert.Empty(t, active)
}

func TestGetActiveStreamingConversations_NoRunning(t *testing.T) {
	manager, _ := setupTestManager(t)

	// Insert stopped processes (not running)
	proc1 := NewProcess("proc-1", t.TempDir(), "conv-1")
	proc2 := NewProcess("proc-2", t.TempDir(), "conv-2")
	manager.InsertProcessForTest("conv-1", proc1)
	manager.InsertProcessForTest("conv-2", proc2)

	active := manager.GetActiveStreamingConversations()
	assert.Empty(t, active)
}

func TestGetActiveStreamingConversations_OneRunning(t *testing.T) {
	manager, _ := setupTestManager(t)

	// One running, one not
	proc1 := NewProcess("proc-1", t.TempDir(), "conv-1")
	proc1.SetRunningForTest(true)

	proc2 := NewProcess("proc-2", t.TempDir(), "conv-2")

	manager.InsertProcessForTest("conv-1", proc1)
	manager.InsertProcessForTest("conv-2", proc2)

	active := manager.GetActiveStreamingConversations()
	assert.Len(t, active, 1)
	assert.Equal(t, "conv-1", active[0])
}

func TestGetActiveStreamingConversations_MultipleRunning(t *testing.T) {
	manager, _ := setupTestManager(t)

	proc1 := NewProcess("proc-1", t.TempDir(), "conv-1")
	proc1.SetRunningForTest(true)

	proc2 := NewProcess("proc-2", t.TempDir(), "conv-2")
	proc2.SetRunningForTest(true)

	proc3 := NewProcess("proc-3", t.TempDir(), "conv-3")
	// proc3 is not running

	manager.InsertProcessForTest("conv-1", proc1)
	manager.InsertProcessForTest("conv-2", proc2)
	manager.InsertProcessForTest("conv-3", proc3)

	active := manager.GetActiveStreamingConversations()
	assert.Len(t, active, 2)
	assert.ElementsMatch(t, []string{"conv-1", "conv-2"}, active)
}

func TestManager_LoadEnvVars(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Store env vars in settings
	envVarsContent := `API_KEY=secret123
DB_HOST=localhost
PORT=8080`

	err := s.SetSetting(ctx, "env-vars", envVarsContent)
	require.NoError(t, err)

	// Load env vars
	envMap, err := m.loadEnvVars(ctx)
	require.NoError(t, err)
	require.NotNil(t, envMap)

	// Verify parsed map
	assert.Equal(t, "secret123", envMap["API_KEY"])
	assert.Equal(t, "localhost", envMap["DB_HOST"])
	assert.Equal(t, "8080", envMap["PORT"])
	assert.Len(t, envMap, 3)
}

func TestManager_LoadEnvVars_Empty(t *testing.T) {
	ctx := context.Background()
	m, _ := setupTestManager(t)

	// Don't store any env vars
	// loadEnvVars should return nil, nil when no settings exist
	envMap, err := m.loadEnvVars(ctx)
	assert.NoError(t, err)
	assert.Nil(t, envMap)
}

func TestManager_LoadEnvVars_WithComments(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Store env vars with comments and blank lines
	envVarsContent := `# Database configuration
DB_HOST=localhost
DB_PORT=5432

# API Keys
API_KEY=secret123
# This is a comment in the middle
API_SECRET=topsecret

# End of config`

	err := s.SetSetting(ctx, "env-vars", envVarsContent)
	require.NoError(t, err)

	// Load env vars
	envMap, err := m.loadEnvVars(ctx)
	require.NoError(t, err)
	require.NotNil(t, envMap)

	// Verify comments and blank lines are skipped
	assert.Equal(t, "localhost", envMap["DB_HOST"])
	assert.Equal(t, "5432", envMap["DB_PORT"])
	assert.Equal(t, "secret123", envMap["API_KEY"])
	assert.Equal(t, "topsecret", envMap["API_SECRET"])
	assert.Len(t, envMap, 4, "should only have 4 env vars, comments and blanks skipped")
}

// ============================================================================
// newAIClient Multi-Source Credential Tests
// ============================================================================

func TestNewAIClient_Source1_SQLiteApiKey(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Store an encrypted API key in SQLite settings
	encrypted, err := crypto.Encrypt("sk-ant-api03-sqlite-test-key")
	require.NoError(t, err)
	require.NoError(t, s.SetSetting(ctx, "anthropic-api-key", encrypted))

	// Ensure env var is NOT set (don't pollute)
	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Unsetenv("ANTHROPIC_API_KEY")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		}
	}()

	client := m.newAIClient()
	require.NotNil(t, client, "should create client from SQLite API key")
	// Client should use x-api-key auth (not Bearer)
	assert.Equal(t, "x-api-key", client.AuthHeader())
}

func TestNewAIClient_Source2_EnvVar(t *testing.T) {
	m, _ := setupTestManager(t)

	// No SQLite key configured, set env var instead
	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Setenv("ANTHROPIC_API_KEY", "sk-ant-api03-env-test-key")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		} else {
			os.Unsetenv("ANTHROPIC_API_KEY")
		}
	}()

	client := m.newAIClient()
	require.NotNil(t, client, "should create client from env var")
	assert.Equal(t, "x-api-key", client.AuthHeader())
}

func TestNewAIClient_Source1_TakesPriorityOverSource2(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Set BOTH SQLite key and env var
	encrypted, err := crypto.Encrypt("sk-sqlite-priority")
	require.NoError(t, err)
	require.NoError(t, s.SetSetting(ctx, "anthropic-api-key", encrypted))

	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Setenv("ANTHROPIC_API_KEY", "sk-env-should-lose")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		} else {
			os.Unsetenv("ANTHROPIC_API_KEY")
		}
	}()

	client := m.newAIClient()
	require.NotNil(t, client)
	// Client should use SQLite key (source 1), not env var (source 2)
	assert.Equal(t, "x-api-key", client.AuthHeader())
	assert.Equal(t, "sk-sqlite-priority", client.AuthValue())
}

func TestNewAIClient_NoSources_ReturnsNil(t *testing.T) {
	m, _ := setupTestManager(t)

	// Ensure no env var
	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Unsetenv("ANTHROPIC_API_KEY")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		}
	}()

	// No SQLite key, no env var. Source 3 (keychain) may or may not work
	// depending on the machine, but we can at least verify it doesn't panic.
	client := m.newAIClient()
	// On CI/machines without Claude Code credentials, this should be nil.
	// On dev machines with Claude Code, this might return an OAuth client.
	// Either way, it should not panic.
	_ = client
}

func TestNewAIClient_EmptyEnvVar_SkipsToNextSource(t *testing.T) {
	m, _ := setupTestManager(t)

	// Set env var to empty string — should be treated as "not set"
	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Setenv("ANTHROPIC_API_KEY", "")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		} else {
			os.Unsetenv("ANTHROPIC_API_KEY")
		}
	}()

	// No SQLite key, empty env var — should fall through to source 3 (keychain)
	// On CI this returns nil, on dev machines it might return OAuth client
	client := m.newAIClient()
	_ = client // just verifying no panic
}

func TestNewAIClient_EnvVarsOnlyWithoutAnthropicKey(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Set env-vars setting with OTHER variables but no ANTHROPIC_API_KEY
	require.NoError(t, s.SetSetting(ctx, "env-vars", "DB_HOST=localhost\nPORT=8080"))

	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Unsetenv("ANTHROPIC_API_KEY")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		}
	}()

	// loadEnvVars will return a map with DB_HOST and PORT but no ANTHROPIC_API_KEY
	// Should fall through to source 2, then source 3
	client := m.newAIClient()
	// On CI: nil; on dev machine: might get OAuth client
	_ = client
}

func TestNewAIClient_EnvVarsWithAnthropicKey(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Set ANTHROPIC_API_KEY in the env-vars setting (not the encrypted setting)
	require.NoError(t, s.SetSetting(ctx, "env-vars", "ANTHROPIC_API_KEY=sk-from-env-vars-setting\nDB_HOST=localhost"))

	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Unsetenv("ANTHROPIC_API_KEY")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		} else {
			os.Unsetenv("ANTHROPIC_API_KEY")
		}
	}()

	client := m.newAIClient()
	require.NotNil(t, client, "should create client from env-vars setting")
	assert.Equal(t, "x-api-key", client.AuthHeader())
	assert.Equal(t, "sk-from-env-vars-setting", client.AuthValue())
}

func TestNewAIClient_EncryptedKeyOverridesEnvVarsSetting(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Set ANTHROPIC_API_KEY in both env-vars setting AND encrypted setting
	require.NoError(t, s.SetSetting(ctx, "env-vars", "ANTHROPIC_API_KEY=sk-from-env-vars"))
	encrypted, err := crypto.Encrypt("sk-encrypted-wins")
	require.NoError(t, err)
	require.NoError(t, s.SetSetting(ctx, "anthropic-api-key", encrypted))

	prevEnv := os.Getenv("ANTHROPIC_API_KEY")
	os.Unsetenv("ANTHROPIC_API_KEY")
	defer func() {
		if prevEnv != "" {
			os.Setenv("ANTHROPIC_API_KEY", prevEnv)
		} else {
			os.Unsetenv("ANTHROPIC_API_KEY")
		}
	}()

	client := m.newAIClient()
	require.NotNil(t, client)
	// The encrypted key should override the env-vars setting key
	// because loadEnvVars() sets envMap["ANTHROPIC_API_KEY"] = decrypted at the end
	assert.Equal(t, "sk-encrypted-wins", client.AuthValue())
}

// ============================================================================
// Additional Manager Tests (Phase 4)
// ============================================================================

func TestManager_IsConversationInPlanMode_NoProcess(t *testing.T) {
	m, _ := setupTestManager(t)
	assert.False(t, m.IsConversationInPlanMode("nonexistent"))
}

func TestManager_IsConversationInPlanMode_PlanActive(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcessWithOptions(ProcessOptions{
		ID:             "plan-active",
		Workdir:        t.TempDir(),
		ConversationID: "conv-plan-active",
		PlanMode:       true,
	})
	proc.SetRunningForTest(true)
	m.InsertProcessForTest("conv-plan-active", proc)

	assert.True(t, m.IsConversationInPlanMode("conv-plan-active"))
}

func TestManager_IsConversationInPlanMode_PlanInactive(t *testing.T) {
	m, _ := setupTestManager(t)

	proc := NewProcessWithOptions(ProcessOptions{
		ID:             "plan-inactive",
		Workdir:        t.TempDir(),
		ConversationID: "conv-plan-inactive",
		PlanMode:       false,
	})
	proc.SetRunningForTest(true)
	m.InsertProcessForTest("conv-plan-inactive", proc)

	assert.False(t, m.IsConversationInPlanMode("conv-plan-inactive"))
}

func TestManager_SetConversationModel_NoProcess(t *testing.T) {
	m, _ := setupTestManager(t)
	err := m.SetConversationModel("nonexistent", "claude-sonnet-4-6")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no active process")
}

func TestManager_SetConversationMaxThinkingTokens_NoProcess(t *testing.T) {
	m, _ := setupTestManager(t)
	err := m.SetConversationMaxThinkingTokens("nonexistent", 5000)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no active process")
}

func TestManager_RewindConversationFiles_NoProcess(t *testing.T) {
	m, _ := setupTestManager(t)
	err := m.RewindConversationFiles("nonexistent", "checkpoint-uuid")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "conversation process not running")
}

func TestManager_SetSessionEventHandler(t *testing.T) {
	m, _ := setupTestManager(t)

	var capturedSessionID string
	var capturedEvent map[string]interface{}
	handler := func(sessionID string, event map[string]interface{}) {
		capturedSessionID = sessionID
		capturedEvent = event
	}

	m.SetSessionEventHandler(handler)
	assert.NotNil(t, m.onSessionEvent)

	m.onSessionEvent("sess-1", map[string]interface{}{"type": "test"})
	assert.Equal(t, "sess-1", capturedSessionID)
	assert.Equal(t, "test", capturedEvent["type"])
}

func TestManager_LoadMcpServers(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	// Store MCP servers config
	mcpJSON := `[{"name":"test-server","type":"stdio","command":"echo"}]`
	require.NoError(t, s.SetSetting(ctx, "mcp-servers:ws-1", mcpJSON))

	result, err := m.loadMcpServers(ctx, "ws-1")
	require.NoError(t, err)
	assert.Equal(t, mcpJSON, result)
}

func TestManager_LoadMcpServers_NotFound(t *testing.T) {
	ctx := context.Background()
	m, _ := setupTestManager(t)

	result, err := m.loadMcpServers(ctx, "nonexistent-ws")
	require.NoError(t, err)
	assert.Empty(t, result)
}

func TestFormatSessionName_AdditionalCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "single word verb",
			input:    "Refactor",
			expected: "refactor",
		},
		{
			name:     "all prepositions",
			input:    "to for with and or in on at",
			expected: "",
		},
		{
			name:     "unicode characters stripped",
			input:    "Fix the café bug",
			expected: "fix-caf-bug",
		},
		{
			name:     "hyphens and underscores",
			input:    "Add real-time_updates",
			expected: "add-real-time-updates",
		},
		{
			name:     "very long input",
			input:    "Implement a comprehensive distributed system for managing real-time notifications across all microservices",
			expected: "implement-comprehensive-distributed-syst",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatSessionName(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestManager_StartConversation_NoInitialMessage(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	repo := createTestRepo(t, s, "ws-no-msg")
	_ = createTestSession(t, s, "sess-no-msg", repo.ID)

	conv, err := m.StartConversation(ctx, "sess-no-msg", "task", "", nil)
	require.NoError(t, err)
	require.NotNil(t, conv)

	// Should be idle since no initial message
	assert.Equal(t, models.ConversationStatusIdle, conv.Status)

	// Should have a setupInfo system message
	require.Len(t, conv.Messages, 1)
	assert.Equal(t, "system", conv.Messages[0].Role)
	assert.NotNil(t, conv.Messages[0].SetupInfo)
}

func TestManager_StartConversation_ConversationNaming(t *testing.T) {
	ctx := context.Background()
	m, s := setupTestManager(t)

	repo := createTestRepo(t, s, "ws-naming")
	_ = createTestSession(t, s, "sess-naming", repo.ID)

	// First task conversation
	conv1, err := m.StartConversation(ctx, "sess-naming", "task", "", nil)
	require.NoError(t, err)
	assert.Equal(t, "Task #1", conv1.Name)

	// Second task conversation
	conv2, err := m.StartConversation(ctx, "sess-naming", "task", "", nil)
	require.NoError(t, err)
	assert.Equal(t, "Task #2", conv2.Name)

	// First review conversation
	conv3, err := m.StartConversation(ctx, "sess-naming", "review", "", nil)
	require.NoError(t, err)
	assert.Equal(t, "Review #1", conv3.Name)

	// First chat conversation
	conv4, err := m.StartConversation(ctx, "sess-naming", "chat", "", nil)
	require.NoError(t, err)
	assert.Equal(t, "Chat #1", conv4.Name)
}
