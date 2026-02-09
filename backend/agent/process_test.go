package agent

import (
	"encoding/json"
	"os"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewProcess(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	assert.Equal(t, "test-id", p.ID)
	assert.Equal(t, "conv-123", p.ConversationID)
	assert.NotNil(t, p.cmd)
	assert.NotNil(t, p.cancel)
	assert.NotNil(t, p.output)
	assert.NotNil(t, p.done)
	assert.False(t, p.running)
}

func TestNewProcessWithOptions(t *testing.T) {
	opts := ProcessOptions{
		ID:                  "test-id",
		Workdir:             "/tmp/test",
		ConversationID:      "conv-456",
		ResumeSession:       "session-789",
		ForkSession:         true,
		LinearIssue:         "LIN-123",
		ToolPreset:          "read-only",
		EnableCheckpointing: true,
		MaxBudgetUsd:        10.0,
		MaxTurns:            50,
		MaxThinkingTokens:   1000,
		PlanMode:            true,
		StructuredOutput:    `{"type": "object"}`,
		SettingSources:      "project,user",
		Betas:               "feature1,feature2",
		Model:               "claude-opus-4-5-20251101",
		FallbackModel:       "claude-sonnet-4-20250514",
	}

	p := NewProcessWithOptions(opts)

	assert.Equal(t, "test-id", p.ID)
	assert.Equal(t, "conv-456", p.ConversationID)
	assert.NotNil(t, p.cmd)
	assert.Equal(t, "/tmp/test", p.cmd.Dir)
}

func TestProcess_IsRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	assert.False(t, p.IsRunning())

	// Manually set running flag for testing
	p.mu.Lock()
	p.running = true
	p.mu.Unlock()

	assert.True(t, p.IsRunning())
}

func TestProcess_Output(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	ch := p.Output()
	assert.NotNil(t, ch)

	// Verify it's a receive-only channel
	// The method returns a receive-only view of the internal channel
}

func TestProcess_Done(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	ch := p.Done()
	assert.NotNil(t, ch)

	// Verify it's a receive-only channel
	// The method returns a receive-only view of the internal channel
}

func TestProcess_SessionID(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// Initially empty
	assert.Empty(t, p.GetSessionID())

	// Set and get
	p.SetSessionID("new-session-id")
	assert.Equal(t, "new-session-id", p.GetSessionID())

	// Update
	p.SetSessionID("updated-session-id")
	assert.Equal(t, "updated-session-id", p.GetSessionID())
}

func TestProcess_ExitError(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// Initially nil
	assert.Nil(t, p.ExitError())
}

func TestProcess_SendMessage_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.SendMessage("test message")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_SendStop_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.SendStop()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_SendInterrupt_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.SendInterrupt()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_SetModel_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.SetModel("claude-opus-4-5-20251101")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_SetPermissionMode_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.SetPermissionMode("auto")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_GetSupportedModels_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.GetSupportedModels()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_GetSupportedCommands_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.GetSupportedCommands()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_GetMcpStatus_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.GetMcpStatus()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_GetAccountInfo_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.GetAccountInfo()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_RewindFiles_NotRunning(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	err := p.RewindFiles("checkpoint-uuid")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestProcess_Stop(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// Stop should not panic even when not running
	p.Stop()
}

func TestProcess_Stop_Idempotent(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// Multiple Stop calls should not panic
	p.Stop()
	p.Stop()
	p.Stop()

	assert.True(t, p.IsStopped())
}

func TestProcess_TryStop(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// First TryStop should succeed
	result1 := p.TryStop()
	assert.True(t, result1)
	assert.True(t, p.IsStopped())

	// Second TryStop should return false
	result2 := p.TryStop()
	assert.False(t, result2)
}

func TestProcess_IsStopped(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	assert.False(t, p.IsStopped())

	p.Stop()

	assert.True(t, p.IsStopped())
}

func TestProcess_ConcurrentStop(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// Concurrent Stop calls should not panic or cause race conditions
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p.Stop()
		}()
	}
	wg.Wait()

	assert.True(t, p.IsStopped())
}

func TestProcess_ConcurrentTryStop(t *testing.T) {
	p := NewProcess("test-id", "/tmp", "conv-123")

	// Only one TryStop should succeed
	var wg sync.WaitGroup
	successCount := 0
	var mu sync.Mutex

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if p.TryStop() {
				mu.Lock()
				successCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	// Exactly one goroutine should have succeeded
	assert.Equal(t, 1, successCount)
	assert.True(t, p.IsStopped())
}

func TestInputMessage_Marshal(t *testing.T) {
	tests := []struct {
		name     string
		msg      InputMessage
		expected map[string]interface{}
	}{
		{
			name: "message type",
			msg: InputMessage{
				Type:    "message",
				Content: "Hello world",
			},
			expected: map[string]interface{}{
				"type":    "message",
				"content": "Hello world",
			},
		},
		{
			name: "stop type",
			msg: InputMessage{
				Type: "stop",
			},
			expected: map[string]interface{}{
				"type": "stop",
			},
		},
		{
			name: "set_model type",
			msg: InputMessage{
				Type:  "set_model",
				Model: "claude-opus-4-5-20251101",
			},
			expected: map[string]interface{}{
				"type":  "set_model",
				"model": "claude-opus-4-5-20251101",
			},
		},
		{
			name: "set_permission_mode type",
			msg: InputMessage{
				Type:           "set_permission_mode",
				PermissionMode: "auto",
			},
			expected: map[string]interface{}{
				"type":           "set_permission_mode",
				"permissionMode": "auto",
			},
		},
		{
			name: "rewind_files type",
			msg: InputMessage{
				Type:           "rewind_files",
				CheckpointUuid: "checkpoint-123",
			},
			expected: map[string]interface{}{
				"type":           "rewind_files",
				"checkpointUuid": "checkpoint-123",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.msg)
			require.NoError(t, err)

			var result map[string]interface{}
			err = json.Unmarshal(data, &result)
			require.NoError(t, err)

			// Check expected fields are present
			for key, expectedValue := range tt.expected {
				actualValue, ok := result[key]
				assert.True(t, ok, "Expected key %s to be present", key)
				assert.Equal(t, expectedValue, actualValue)
			}
		})
	}
}

func TestFindAgentRunner(t *testing.T) {
	// Save original values
	origEnv := os.Getenv("CHATML_AGENT_RUNNER")
	origPath := AgentRunnerPath
	defer func() {
		os.Setenv("CHATML_AGENT_RUNNER", origEnv)
		AgentRunnerPath = origPath
	}()

	// Test environment variable takes precedence
	os.Setenv("CHATML_AGENT_RUNNER", "/custom/path/runner")
	result := findAgentRunner()
	assert.Equal(t, "/custom/path/runner", result)

	// Test package-level override
	os.Unsetenv("CHATML_AGENT_RUNNER")
	AgentRunnerPath = "/override/path/runner"
	result = findAgentRunner()
	assert.Equal(t, "/override/path/runner", result)

	// Test fallback (when no config)
	AgentRunnerPath = ""
	result = findAgentRunner()
	// Should return either a found path or the fallback
	assert.NotEmpty(t, result)
}

func TestProcessOptions_Defaults(t *testing.T) {
	opts := ProcessOptions{}

	assert.Empty(t, opts.ID)
	assert.Empty(t, opts.Workdir)
	assert.Empty(t, opts.ConversationID)
	assert.Empty(t, opts.ResumeSession)
	assert.False(t, opts.ForkSession)
	assert.Empty(t, opts.LinearIssue)
	assert.Empty(t, opts.ToolPreset)
	assert.False(t, opts.EnableCheckpointing)
	assert.Zero(t, opts.MaxBudgetUsd)
	assert.Zero(t, opts.MaxTurns)
	assert.Zero(t, opts.MaxThinkingTokens)
	assert.False(t, opts.PlanMode)
	assert.Empty(t, opts.StructuredOutput)
	assert.Empty(t, opts.SettingSources)
	assert.Empty(t, opts.Betas)
	assert.Empty(t, opts.Model)
	assert.Empty(t, opts.FallbackModel)
}

func TestNewProcessWithOptions_MinimalOptions(t *testing.T) {
	// Test with minimal required options
	opts := ProcessOptions{
		ID:             "minimal-id",
		Workdir:        "/tmp",
		ConversationID: "conv-id",
	}

	p := NewProcessWithOptions(opts)

	assert.Equal(t, "minimal-id", p.ID)
	assert.Equal(t, "conv-id", p.ConversationID)
	assert.NotNil(t, p.cmd)
}

// ============================================================================
// Stop with SIGTERM/SIGKILL Escalation Tests
// ============================================================================

func TestProcess_Stop_ClosesStdin(t *testing.T) {
	p := NewProcess("test-stdin", "/tmp", "conv-stdin")

	// Create a pipe to simulate stdin
	r, w, err := os.Pipe()
	require.NoError(t, err)
	defer r.Close()

	p.stdin = w

	p.Stop()

	// Writing to the closed pipe should fail
	_, writeErr := w.Write([]byte("test"))
	assert.Error(t, writeErr, "stdin should be closed after Stop()")
}

// ============================================================================
// Plan Mode CLI Arg Tests
// ============================================================================

func TestNewProcessWithOptions_PlanModeEnabled(t *testing.T) {
	opts := ProcessOptions{
		ID:             "plan-test",
		Workdir:        "/tmp/test",
		ConversationID: "conv-plan",
		PlanMode:       true,
	}

	p := NewProcessWithOptions(opts)

	// Verify --permission-mode plan appears in the command args
	args := p.cmd.Args
	found := false
	for i, arg := range args {
		if arg == "--permission-mode" && i+1 < len(args) && args[i+1] == "plan" {
			found = true
			break
		}
	}
	assert.True(t, found, "Expected --permission-mode plan in args: %v", args)
}

func TestNewProcessWithOptions_PlanModeDisabled(t *testing.T) {
	opts := ProcessOptions{
		ID:             "no-plan-test",
		Workdir:        "/tmp/test",
		ConversationID: "conv-no-plan",
		PlanMode:       false,
	}

	p := NewProcessWithOptions(opts)

	// Verify --permission-mode does NOT appear in args when plan mode is off
	args := p.cmd.Args
	for _, arg := range args {
		assert.NotEqual(t, "--permission-mode", arg, "Should not have --permission-mode when PlanMode is false")
	}
}

func TestNewProcessWithOptions_PlanModeWithThinking(t *testing.T) {
	opts := ProcessOptions{
		ID:                "combo-test",
		Workdir:           "/tmp/test",
		ConversationID:    "conv-combo",
		PlanMode:          true,
		MaxThinkingTokens: 5000,
	}

	p := NewProcessWithOptions(opts)
	args := p.cmd.Args

	// Both flags should be present
	foundPlanMode := false
	foundThinking := false
	for i, arg := range args {
		if arg == "--permission-mode" && i+1 < len(args) && args[i+1] == "plan" {
			foundPlanMode = true
		}
		if arg == "--max-thinking-tokens" && i+1 < len(args) && args[i+1] == "5000" {
			foundThinking = true
		}
	}
	assert.True(t, foundPlanMode, "Expected --permission-mode plan in args: %v", args)
	assert.True(t, foundThinking, "Expected --max-thinking-tokens 5000 in args: %v", args)
}

// ============================================================================
// StartConversationOptions Plan Mode Tests
// ============================================================================

func TestStartConversationOptions_PlanModeDefaults(t *testing.T) {
	opts := StartConversationOptions{}
	assert.False(t, opts.PlanMode)
	assert.Zero(t, opts.MaxThinkingTokens)
	assert.Nil(t, opts.Attachments)
}

func TestStartConversationOptions_PlanModeSet(t *testing.T) {
	opts := StartConversationOptions{
		PlanMode:          true,
		MaxThinkingTokens: 1000,
	}
	assert.True(t, opts.PlanMode)
	assert.Equal(t, 1000, opts.MaxThinkingTokens)
}

// ============================================================================
// Dropped Messages Counter Tests
// ============================================================================

func TestProcess_DroppedMessages_InitiallyZero(t *testing.T) {
	p := NewProcess("test-drops", "/tmp", "conv-drops")
	assert.Equal(t, uint64(0), p.DroppedMessages())
}

func TestProcess_DroppedMessages_Increment(t *testing.T) {
	p := NewProcess("test-drops", "/tmp", "conv-drops")

	p.SimulateDrops(1)
	assert.Equal(t, uint64(1), p.DroppedMessages())

	p.SimulateDrops(1)
	assert.Equal(t, uint64(2), p.DroppedMessages())

	p.SimulateDrops(5)
	assert.Equal(t, uint64(7), p.DroppedMessages())
}

func TestProcess_DroppedMessages_ConcurrentAccess(t *testing.T) {
	p := NewProcess("test-concurrent-drops", "/tmp", "conv-concurrent")

	var wg sync.WaitGroup
	numGoroutines := 100
	incrementsPerGoroutine := 10

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < incrementsPerGoroutine; j++ {
				p.SimulateDrops(1)
			}
		}()
	}
	wg.Wait()

	expected := uint64(numGoroutines * incrementsPerGoroutine)
	assert.Equal(t, expected, p.DroppedMessages())
}

func TestProcess_DroppedMessages_ConcurrentReadWrite(t *testing.T) {
	p := NewProcess("test-readwrite-drops", "/tmp", "conv-readwrite")

	var wg sync.WaitGroup

	// Writers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				p.SimulateDrops(1)
			}
		}()
	}

	// Readers - should never panic
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				_ = p.DroppedMessages()
			}
		}()
	}

	wg.Wait()
	assert.Equal(t, uint64(500), p.DroppedMessages())
}

func TestProcess_OutputBufferSize_Increased(t *testing.T) {
	p := NewProcess("test-bufsize", "/tmp", "conv-bufsize")
	// Buffer should be 4000 (increased from 1000)
	assert.Equal(t, 4000, cap(p.output))
}

func TestNewProcessWithOptions_EnvVars(t *testing.T) {
	opts := ProcessOptions{
		ID:             "test-env",
		Workdir:        "/tmp",
		ConversationID: "conv-env",
		EnvVars: map[string]string{
			"MY_CUSTOM_VAR": "hello",
			"ANOTHER_VAR":   "world",
		},
	}
	p := NewProcessWithOptions(opts)

	assert.NotNil(t, p.cmd.Env)
	// Should contain OS env + custom vars
	assert.True(t, len(p.cmd.Env) > 2, "should include OS env vars plus custom vars")

	// Check custom vars are present
	found := map[string]bool{"MY_CUSTOM_VAR": false, "ANOTHER_VAR": false}
	for _, e := range p.cmd.Env {
		if e == "MY_CUSTOM_VAR=hello" {
			found["MY_CUSTOM_VAR"] = true
		}
		if e == "ANOTHER_VAR=world" {
			found["ANOTHER_VAR"] = true
		}
	}
	assert.True(t, found["MY_CUSTOM_VAR"], "MY_CUSTOM_VAR should be in env")
	assert.True(t, found["ANOTHER_VAR"], "ANOTHER_VAR should be in env")
}

func TestNewProcessWithOptions_NoEnvVars(t *testing.T) {
	opts := ProcessOptions{
		ID:             "test-no-env",
		Workdir:        "/tmp",
		ConversationID: "conv-no-env",
		EnvVars:        nil,
	}
	p := NewProcessWithOptions(opts)

	// When no custom env vars are provided, cmd.Env should be nil
	// (process will inherit parent environment)
	assert.Nil(t, p.cmd.Env, "cmd.Env should be nil when no custom env vars provided")
}

func TestNewProcessWithOptions_EmptyEnvVars(t *testing.T) {
	opts := ProcessOptions{
		ID:             "test-empty-env",
		Workdir:        "/tmp",
		ConversationID: "conv-empty-env",
		EnvVars:        map[string]string{},
	}
	p := NewProcessWithOptions(opts)

	// When empty env vars map is provided, cmd.Env should be nil
	assert.Nil(t, p.cmd.Env, "cmd.Env should be nil when empty env vars map provided")
}

// ============================================================================
// MCP Servers File Tests
// ============================================================================

func TestNewProcessWithOptions_McpServersFile(t *testing.T) {
	mcpJSON := `[{"name":"test","type":"stdio","command":"echo","enabled":true}]`
	opts := ProcessOptions{
		ID:             "test-mcp",
		Workdir:        "/tmp",
		ConversationID: "conv-mcp",
		McpServersJSON: mcpJSON,
	}

	p := NewProcessWithOptions(opts)
	require.NotNil(t, p, "process should be created")

	// Ensure cleanup happens even if assertions fail
	t.Cleanup(func() {
		if p.mcpServersFile != "" {
			os.Remove(p.mcpServersFile)
		}
	})

	// The temp file should exist on disk
	require.NotEmpty(t, p.mcpServersFile, "mcpServersFile should be set")
	_, err := os.Stat(p.mcpServersFile)
	require.NoError(t, err, "MCP servers temp file should exist on disk")

	// The temp file should contain the JSON string
	content, err := os.ReadFile(p.mcpServersFile)
	require.NoError(t, err, "should be able to read MCP servers temp file")
	assert.Equal(t, mcpJSON, string(content))

	// cmd.Args should contain --mcp-servers-file
	assert.Contains(t, p.cmd.Args, "--mcp-servers-file")

	// After Stop(), the temp file should be cleaned up
	tmpPath := p.mcpServersFile
	p.Stop()
	_, err = os.Stat(tmpPath)
	assert.True(t, os.IsNotExist(err), "MCP servers temp file should be removed after Stop()")
}

func TestNewProcessWithOptions_NoMcpServers(t *testing.T) {
	opts := ProcessOptions{
		ID:             "test-no-mcp",
		Workdir:        "/tmp",
		ConversationID: "conv-no-mcp",
		McpServersJSON: "",
	}

	p := NewProcessWithOptions(opts)
	require.NotNil(t, p, "process should be created")

	// cmd.Args should NOT contain --mcp-servers-file
	assert.NotContains(t, p.cmd.Args, "--mcp-servers-file")

	// mcpServersFile field should be empty
	assert.Empty(t, p.mcpServersFile, "mcpServersFile should be empty when no MCP servers JSON provided")
}

func TestNewProcessWithOptions_McpServersCleanupOnStop(t *testing.T) {
	mcpJSON := `[{"name":"cleanup-test","type":"stdio","command":"echo","enabled":true}]`
	opts := ProcessOptions{
		ID:             "test-mcp-cleanup",
		Workdir:        "/tmp",
		ConversationID: "conv-mcp-cleanup",
		McpServersJSON: mcpJSON,
	}

	p := NewProcessWithOptions(opts)
	require.NotNil(t, p)

	tmpPath := p.mcpServersFile
	require.NotEmpty(t, tmpPath, "mcpServersFile should be set")

	t.Cleanup(func() {
		os.Remove(tmpPath)
	})

	// Verify the file exists before stop
	_, err := os.Stat(tmpPath)
	require.NoError(t, err, "temp file should exist before Stop()")

	// Stop the process
	p.Stop()

	// Verify the file no longer exists after stop
	_, err = os.Stat(tmpPath)
	assert.True(t, os.IsNotExist(err), "MCP servers temp file should be removed after Stop()")
}

func TestNewProcessWithOptions_McpServersAndInstructions(t *testing.T) {
	mcpJSON := `[{"name":"combo-test","type":"stdio","command":"echo","enabled":true}]`
	instructions := "These are test instructions for the agent."
	opts := ProcessOptions{
		ID:             "test-mcp-instructions",
		Workdir:        "/tmp",
		ConversationID: "conv-mcp-instructions",
		Instructions:   instructions,
		McpServersJSON: mcpJSON,
	}

	p := NewProcessWithOptions(opts)
	require.NotNil(t, p)

	t.Cleanup(func() {
		if p.mcpServersFile != "" {
			os.Remove(p.mcpServersFile)
		}
		if p.instructionsFile != "" {
			os.Remove(p.instructionsFile)
		}
		p.Stop()
	})

	// cmd.Args should contain BOTH --instructions-file and --mcp-servers-file
	assert.Contains(t, p.cmd.Args, "--instructions-file", "args should contain --instructions-file")
	assert.Contains(t, p.cmd.Args, "--mcp-servers-file", "args should contain --mcp-servers-file")
}
