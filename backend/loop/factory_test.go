package loop

import (
	"testing"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/loop/chatml"
	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunnerImplementsConversationBackend(t *testing.T) {
	// Compile-time check is in adapter.go; this test documents it explicitly.
	var _ agent.ConversationBackend = (*Runner)(nil)
}

func TestNewBackendFactory_ReturnsFactory(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)
	assert.NotNil(t, factory)
}

func TestNewBackendFactory_FailsWithoutCredentials(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model: "claude-sonnet-4-6",
	}
	// No API key or OAuth token — should fail at provider creation
	_, err := factory(opts, "", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "APIKey or OAuthToken")
}

func TestNewBackendFactory_CreatesRunner(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)
	require.NotNil(t, backend)

	// Should be our adapter Runner
	runner, ok := backend.(*Runner)
	assert.True(t, ok, "expected *Runner, got %T", backend)
	assert.NotNil(t, runner.core)
}

func TestConvertAttachments(t *testing.T) {
	attachments := []models.Attachment{
		{
			ID:       "att1",
			Type:     "file",
			Name:     "test.go",
			Path:     "/tmp/test.go",
			MimeType: "text/x-go",
			Size:     1024,
		},
		{
			ID:       "att2",
			Type:     "image",
			Name:     "screenshot.png",
			MimeType: "image/png",
			Width:    800,
			Height:   600,
		},
	}

	result := convertAttachments(attachments)
	require.Len(t, result, 2)

	assert.Equal(t, "att1", result[0].ID)
	assert.Equal(t, "file", result[0].Type)
	assert.Equal(t, "test.go", result[0].Name)
	assert.Equal(t, "/tmp/test.go", result[0].Path)
	assert.Equal(t, "text/x-go", result[0].MimeType)
	assert.Equal(t, int64(1024), result[0].Size)

	assert.Equal(t, "att2", result[1].ID)
	assert.Equal(t, "image", result[1].Type)
	assert.Equal(t, 800, result[1].Width)
	assert.Equal(t, 600, result[1].Height)
}

func TestRunner_StoreOrDeferMessage_WhenIdle(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)

	msg := &models.Message{ID: "msg1", Role: "user", Content: "hello"}

	// Core runner starts with inActiveTurn=false, so should store immediately
	storeNow := backend.StoreOrDeferMessage(msg)
	assert.True(t, storeNow, "should store immediately when idle")
	assert.Nil(t, backend.TakePendingUserMessage(), "no pending message when stored immediately")
}

func TestRunner_StoreOrDeferMessage_WhenActive(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)

	// Simulate active turn
	backend.SetInActiveTurn(true)

	msg := &models.Message{ID: "msg1", Role: "user", Content: "hello"}
	storeNow := backend.StoreOrDeferMessage(msg)
	assert.False(t, storeNow, "should defer when in active turn")

	// Take pending should return the deferred message
	pending := backend.TakePendingUserMessage()
	assert.NotNil(t, pending)
	assert.Equal(t, "msg1", pending.ID)
}

func TestRunner_EndTurnAndTakePending(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)

	// Simulate active turn with deferred message
	backend.SetInActiveTurn(true)
	msg := &models.Message{ID: "msg1", Role: "user", Content: "hello"}
	backend.StoreOrDeferMessage(msg)

	// End turn should clear active and return pending
	pending := backend.EndTurnAndTakePending()
	assert.NotNil(t, pending)
	assert.Equal(t, "msg1", pending.ID)
	assert.False(t, backend.IsInActiveTurn(), "should be idle after EndTurnAndTakePending")
}

func TestRunner_EndTurnAndTakePending_NoPending(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)

	backend.SetInActiveTurn(true)
	pending := backend.EndTurnAndTakePending()
	assert.Nil(t, pending)
	assert.False(t, backend.IsInActiveTurn())
}

func TestRunner_StateDelegation(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)

	// SessionID
	backend.SetSessionID("test-session")
	assert.Equal(t, "test-session", backend.GetSessionID())

	// Plan mode
	backend.SetPlanModeFromEvent(true)
	assert.True(t, backend.IsPlanModeActive())
	backend.SetPlanModeFromEvent(false)
	assert.False(t, backend.IsPlanModeActive())

	// Active turn
	backend.SetInActiveTurn(true)
	assert.True(t, backend.IsInActiveTurn())
	backend.SetInActiveTurn(false)
	assert.False(t, backend.IsInActiveTurn())

	// Error event
	assert.False(t, backend.SawErrorEvent())
	backend.SetSawErrorEvent()
	assert.True(t, backend.SawErrorEvent())

	// Produced output
	assert.False(t, backend.ProducedOutput())
	backend.SetProducedOutput()
	assert.True(t, backend.ProducedOutput())
}

func TestRunner_Options(t *testing.T) {
	svc := &chatml.Services{}
	factory := NewBackendFactory(svc, nil)

	opts := agent.ProcessOptions{
		Model:   "claude-sonnet-4-6",
		Workdir: t.TempDir(),
	}
	backend, err := factory(opts, "sk-ant-test-key", "")
	require.NoError(t, err)

	result := backend.Options()
	assert.Equal(t, "claude-sonnet-4-6", result.Model)
}
