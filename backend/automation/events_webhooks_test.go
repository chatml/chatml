package automation

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// EventBus
// ============================================================================

func TestEventBus_Reindex(t *testing.T) {
	s, engine := newTestEventBusSetup(t)

	// Create a workflow + event trigger
	w := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-1",
		WorkflowID: w.ID,
		Type:       "event",
		Config:     `{"eventName": "pr_created"}`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	eb := NewEventBus(context.Background(), engine, s)

	eb.mu.RLock()
	refs := eb.index["pr_created"]
	eb.mu.RUnlock()

	require.Len(t, refs, 1)
	assert.Equal(t, "trig-1", refs[0].TriggerID)
	assert.Equal(t, w.ID, refs[0].WorkflowID)
}

func TestEventBus_Reindex_DisabledTriggerSkipped(t *testing.T) {
	s, engine := newTestEventBusSetup(t)

	w := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-disabled",
		WorkflowID: w.ID,
		Type:       "event",
		Config:     `{"eventName": "session_completed"}`,
		Enabled:    false,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	eb := NewEventBus(context.Background(), engine, s)

	eb.mu.RLock()
	refs := eb.index["session_completed"]
	eb.mu.RUnlock()

	assert.Empty(t, refs)
}

func TestEventBus_Reindex_InvalidConfig(t *testing.T) {
	s, engine := newTestEventBusSetup(t)

	w := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-bad",
		WorkflowID: w.ID,
		Type:       "event",
		Config:     `not valid json`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	eb := NewEventBus(context.Background(), engine, s)

	// Should not panic, just skip the trigger
	eb.mu.RLock()
	total := len(eb.index)
	eb.mu.RUnlock()
	assert.Equal(t, 0, total)
}

func TestEventBus_Reindex_EmptyEventName(t *testing.T) {
	s, engine := newTestEventBusSetup(t)

	w := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-empty",
		WorkflowID: w.ID,
		Type:       "event",
		Config:     `{"eventName": ""}`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	eb := NewEventBus(context.Background(), engine, s)

	eb.mu.RLock()
	total := len(eb.index)
	eb.mu.RUnlock()
	assert.Equal(t, 0, total)
}

func TestEventBus_Reindex_MultipleEvents(t *testing.T) {
	s, engine := newTestEventBusSetup(t)

	w := createTestWorkflow(t, s, simpleLinearGraph())

	triggers := []*models.Trigger{
		{ID: "t1", WorkflowID: w.ID, Type: "event", Config: `{"eventName": "pr_created"}`, Enabled: true},
		{ID: "t2", WorkflowID: w.ID, Type: "event", Config: `{"eventName": "pr_created"}`, Enabled: true},
		{ID: "t3", WorkflowID: w.ID, Type: "event", Config: `{"eventName": "pr_merged"}`, Enabled: true},
	}
	for _, tr := range triggers {
		require.NoError(t, s.AddTrigger(context.Background(), tr))
	}

	eb := NewEventBus(context.Background(), engine, s)

	eb.mu.RLock()
	assert.Len(t, eb.index["pr_created"], 2)
	assert.Len(t, eb.index["pr_merged"], 1)
	eb.mu.RUnlock()
}

func TestEventBus_Emit_NoMatches(t *testing.T) {
	s, engine := newTestEventBusSetup(t)

	eb := NewEventBus(context.Background(), engine, s)

	// Should not panic
	eb.Emit("nonexistent_event", map[string]interface{}{"data": true})
}

// ============================================================================
// validateHMAC
// ============================================================================

func TestValidateHMAC_ValidSignature(t *testing.T) {
	secret := "my-secret-key"
	body := []byte(`{"event": "push"}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	assert.True(t, validateHMAC(body, secret, signature))
}

func TestValidateHMAC_InvalidSignature(t *testing.T) {
	assert.False(t, validateHMAC([]byte("body"), "secret", "sha256=wrong"))
}

func TestValidateHMAC_EmptySignature(t *testing.T) {
	assert.False(t, validateHMAC([]byte("body"), "secret", ""))
}

func TestValidateHMAC_DifferentBody(t *testing.T) {
	secret := "my-secret"
	body1 := []byte("original")
	body2 := []byte("tampered")

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body1)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	assert.False(t, validateHMAC(body2, secret, signature))
}

// ============================================================================
// flattenHeaders
// ============================================================================

func TestFlattenHeaders_Basic(t *testing.T) {
	headers := http.Header{
		"Content-Type":  []string{"application/json"},
		"Authorization": []string{"Bearer token"},
	}

	flat := flattenHeaders(headers)
	assert.Equal(t, "application/json", flat["Content-Type"])
	assert.Equal(t, "Bearer token", flat["Authorization"])
}

func TestFlattenHeaders_MultipleValues(t *testing.T) {
	headers := http.Header{
		"Accept": []string{"text/html", "application/json"},
	}

	flat := flattenHeaders(headers)
	assert.Equal(t, "text/html", flat["Accept"]) // Takes first value
}

func TestFlattenHeaders_Empty(t *testing.T) {
	flat := flattenHeaders(http.Header{})
	assert.Empty(t, flat)
}

// ============================================================================
// WebhookHandler HTTP tests
// ============================================================================

func TestWebhookHandler_TriggerNotFound(t *testing.T) {
	engine, s := newTestEngine(t)
	wh := NewWebhookHandler(engine, s)

	req := httptest.NewRequest("POST", "/api/webhooks/nonexistent", strings.NewReader(`{}`))
	w := httptest.NewRecorder()

	// Set up chi URL param
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "nonexistent")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestWebhookHandler_DisabledTrigger(t *testing.T) {
	engine, s := newTestEngine(t)

	wf := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-disabled",
		WorkflowID: wf.ID,
		Type:       "webhook",
		Config:     `{}`,
		Enabled:    false,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	wh := NewWebhookHandler(engine, s)

	req := httptest.NewRequest("POST", "/api/webhooks/trig-disabled", strings.NewReader(`{}`))
	w := httptest.NewRecorder()

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "trig-disabled")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestWebhookHandler_WrongTriggerType(t *testing.T) {
	engine, s := newTestEngine(t)

	wf := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-event",
		WorkflowID: wf.ID,
		Type:       "event", // not webhook
		Config:     `{}`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	wh := NewWebhookHandler(engine, s)

	req := httptest.NewRequest("POST", "/api/webhooks/trig-event", strings.NewReader(`{}`))
	w := httptest.NewRecorder()

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "trig-event")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestWebhookHandler_InvalidHMAC(t *testing.T) {
	engine, s := newTestEngine(t)

	wf := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-hmac",
		WorkflowID: wf.ID,
		Type:       "webhook",
		Config:     `{"secret": "my-secret"}`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	wh := NewWebhookHandler(engine, s)

	req := httptest.NewRequest("POST", "/api/webhooks/trig-hmac", strings.NewReader(`{"data": true}`))
	req.Header.Set("X-Webhook-Signature", "sha256=invalidsignature")
	w := httptest.NewRecorder()

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "trig-hmac")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestWebhookHandler_ValidHMACAccepted(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	// Register a mock executor so the run can complete
	mock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{}`}, nil
	})
	engine.RegisterExecutor("action-webhook", mock)

	wf := createTestWorkflow(t, s, simpleLinearGraph())
	secret := "webhook-secret-123"
	trigger := &models.Trigger{
		ID:         "trig-valid",
		WorkflowID: wf.ID,
		Type:       "webhook",
		Config:     `{"secret": "` + secret + `"}`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	wh := NewWebhookHandler(engine, s)

	body := `{"event": "push"}`
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest("POST", "/api/webhooks/trig-valid", strings.NewReader(body))
	req.Header.Set("X-Webhook-Signature", signature)
	w := httptest.NewRecorder()

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "trig-valid")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusAccepted, w.Code)

	var resp map[string]string
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["runId"])
	assert.Equal(t, "pending", resp["status"])
}

func TestWebhookHandler_GithubSignatureHeader(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	mock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{}`}, nil
	})
	engine.RegisterExecutor("action-webhook", mock)

	wf := createTestWorkflow(t, s, simpleLinearGraph())
	secret := "gh-secret"
	trigger := &models.Trigger{
		ID:         "trig-gh",
		WorkflowID: wf.ID,
		Type:       "webhook",
		Config:     `{"secret": "` + secret + `"}`,
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	wh := NewWebhookHandler(engine, s)

	body := `{"action": "opened"}`
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest("POST", "/api/webhooks/trig-gh", strings.NewReader(body))
	req.Header.Set("X-Hub-Signature-256", signature) // GitHub format
	w := httptest.NewRecorder()

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "trig-gh")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusAccepted, w.Code)
}

func TestWebhookHandler_NoSecretSkipsValidation(t *testing.T) {
	engine, s := newTestEngine(t)
	engine.Start()

	mock := newMockExecutor(func(step StepContext) (*StepResult, error) {
		return &StepResult{OutputData: `{}`}, nil
	})
	engine.RegisterExecutor("action-webhook", mock)

	wf := createTestWorkflow(t, s, simpleLinearGraph())
	trigger := &models.Trigger{
		ID:         "trig-nosecret",
		WorkflowID: wf.ID,
		Type:       "webhook",
		Config:     `{}`, // no secret
		Enabled:    true,
	}
	require.NoError(t, s.AddTrigger(context.Background(), trigger))

	wh := NewWebhookHandler(engine, s)

	req := httptest.NewRequest("POST", "/api/webhooks/trig-nosecret", strings.NewReader(`{}`))
	w := httptest.NewRecorder()

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("triggerId", "trig-nosecret")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	wh.HandleWebhook(w, req)
	assert.Equal(t, http.StatusAccepted, w.Code)
}

// ============================================================================
// Helpers
// ============================================================================

func newTestEventBusSetup(t *testing.T) (*store.SQLiteStore, *Engine) {
	t.Helper()
	engine, s := newTestEngine(t)
	return s, engine
}
