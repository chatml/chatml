package agent

import (
	"context"
	"sync"
	"testing"
	"time"

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

	manager := NewManager(context.Background(), sqliteStore, worktreeManager)

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

	err := manager.SendConversationMessage(context.Background(), "nonexistent", "hello", nil)
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
			expected: "login-bug",
		},
		{
			name:     "with implement",
			input:    "Implement user authentication",
			expected: "user-authentication",
		},
		{
			name:     "with I'll help",
			input:    "I'll help you add a dark mode toggle",
			expected: "dark-mode-toggle",
		},
		{
			name:     "already lowercase",
			input:    "add branch renaming logic",
			expected: "branch-renaming-logic",
		},
		{
			name:     "with punctuation",
			input:    "Fix bug: users can't log in!",
			expected: "bug-users-can-t-log",
		},
		{
			name:     "long name gets truncated",
			input:    "Implement a comprehensive user authentication system with OAuth and JWT tokens",
			expected: "comprehensive-user-authentication-system",
		},
		{
			name:     "mixed case",
			input:    "Add TypeScript Types For API Response",
			expected: "typescript-types-api-response",
		},
		{
			name:     "too short after filtering returns empty",
			input:    "fix the a",
			expected: "",
		},
		{
			name:     "numbers preserved",
			input:    "Fix bug #123 in login",
			expected: "bug-123-login",
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
	manager := NewManager(ctx, sqliteStore, worktreeManager)

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
	manager := NewManager(ctx, sqliteStore, worktreeManager)

	assert.NotNil(t, manager)
	assert.Error(t, manager.ctx.Err()) // Context is already cancelled
}

func TestHandleConversationCompletion_ExitsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	sqliteStore, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { sqliteStore.Close() })

	worktreeManager := git.NewWorktreeManager()
	manager := NewManager(ctx, sqliteStore, worktreeManager)

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
	manager := NewManager(ctx, sqliteStore, worktreeManager)

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
