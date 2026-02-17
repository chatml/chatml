package automation

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
)

// WebhookHandler handles incoming external webhook requests.
type WebhookHandler struct {
	engine *Engine
	store  *store.SQLiteStore
}

// NewWebhookHandler creates a new webhook receiver.
func NewWebhookHandler(engine *Engine, s *store.SQLiteStore) *WebhookHandler {
	return &WebhookHandler{engine: engine, store: s}
}

// HandleWebhook processes POST /api/webhooks/{triggerId}.
func (wh *WebhookHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	triggerID := chi.URLParam(r, "triggerId")
	ctx := r.Context()

	trigger, err := wh.store.GetTrigger(ctx, triggerID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if trigger == nil {
		http.Error(w, "trigger not found", http.StatusNotFound)
		return
	}
	if !trigger.Enabled {
		http.Error(w, "trigger is disabled", http.StatusForbidden)
		return
	}
	if trigger.Type != "webhook" {
		http.Error(w, "not a webhook trigger", http.StatusBadRequest)
		return
	}

	// Read body
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	// Optional HMAC signature validation
	var cfg webhookTriggerConfig
	if err := json.Unmarshal([]byte(trigger.Config), &cfg); err == nil && cfg.Secret != "" {
		signature := r.Header.Get("X-Webhook-Signature")
		if signature == "" {
			signature = r.Header.Get("X-Hub-Signature-256") // GitHub format
		}
		if !validateHMAC(body, cfg.Secret, signature) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
	}

	// Parse body as JSON for input data
	var payload interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		payload = string(body)
	}

	inputData := map[string]interface{}{
		"trigger": "webhook",
		"headers": flattenHeaders(r.Header),
		"body":    payload,
		"method":  r.Method,
		"path":    r.URL.Path,
	}

	run, err := wh.engine.StartRun(ctx, trigger.WorkflowID, triggerID, "webhook", inputData)
	if err != nil {
		logger.Automation.Errorf("Webhook trigger %s: failed to start run: %v", triggerID, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"runId":  run.ID,
		"status": string(run.Status),
	})
}

type webhookTriggerConfig struct {
	Secret string `json:"secret,omitempty"`
}

func validateHMAC(body []byte, secret, signature string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expectedHex := hex.EncodeToString(mac.Sum(nil))

	// Support both "sha256=<hex>" (GitHub format) and raw "<hex>" signatures
	if strings.HasPrefix(signature, "sha256=") {
		return hmac.Equal([]byte("sha256="+expectedHex), []byte(signature))
	}
	return hmac.Equal([]byte(expectedHex), []byte(signature))
}

func flattenHeaders(headers http.Header) map[string]string {
	flat := make(map[string]string, len(headers))
	for k, v := range headers {
		if len(v) > 0 {
			flat[k] = v[0]
		}
	}
	return flat
}
