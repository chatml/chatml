package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- Memory TokenStore Tests ---

func TestMemoryTokenStore_RegisterConsumeLifecycle(t *testing.T) {
	s := newMemoryTokenStore(5 * time.Minute)
	ctx := context.Background()

	// Register
	if err := s.Register(ctx, "tok1", 5*time.Minute); err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Exists
	ok, err := s.Exists(ctx, "tok1")
	if err != nil || !ok {
		t.Fatal("Exists should return true after Register")
	}

	// Count
	n, err := s.Count(ctx)
	if err != nil || n != 1 {
		t.Fatalf("Count: got %d, want 1", n)
	}

	// Consume
	consumed, err := s.Consume(ctx, "tok1")
	if err != nil || !consumed {
		t.Fatal("Consume should return true for existing token")
	}

	// Exists after consume
	ok, _ = s.Exists(ctx, "tok1")
	if ok {
		t.Fatal("Exists should return false after Consume")
	}

	// Consume again
	consumed, _ = s.Consume(ctx, "tok1")
	if consumed {
		t.Fatal("Consume should return false for already-consumed token")
	}
}

func TestMemoryTokenStore_RegisterDuplicate(t *testing.T) {
	s := newMemoryTokenStore(5 * time.Minute)
	ctx := context.Background()

	if err := s.Register(ctx, "tok1", 5*time.Minute); err != nil {
		t.Fatalf("first Register: %v", err)
	}
	if err := s.Register(ctx, "tok1", 5*time.Minute); err != ErrTokenExists {
		t.Fatalf("second Register: got %v, want ErrTokenExists", err)
	}
}

func TestMemoryTokenStore_ReRegistrationAfterConsume(t *testing.T) {
	s := newMemoryTokenStore(5 * time.Minute)
	ctx := context.Background()

	s.Register(ctx, "tok1", 5*time.Minute)
	s.Consume(ctx, "tok1")

	// Re-register should succeed after consume
	if err := s.Register(ctx, "tok1", 5*time.Minute); err != nil {
		t.Fatalf("re-Register after Consume: %v", err)
	}
}

func TestMemoryTokenStore_Cleanup(t *testing.T) {
	s := newMemoryTokenStore(50 * time.Millisecond)
	ctx := context.Background()

	s.Register(ctx, "tok1", 50*time.Millisecond)
	s.Register(ctx, "tok2", 50*time.Millisecond)

	time.Sleep(100 * time.Millisecond)

	s.Cleanup(ctx)

	n, _ := s.Count(ctx)
	if n != 0 {
		t.Fatalf("Count after cleanup: got %d, want 0", n)
	}
}

func TestMemoryTokenStore_Close(t *testing.T) {
	s := newMemoryTokenStore(5 * time.Minute)
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

// --- Relay Handler Tests ---

func newTestRelay(t *testing.T) *Relay {
	t.Helper()
	cfg := &Config{
		Env:              "dev",
		Port:             0,
		MaxRegistrations: 100,
		MaxActivePairs:   10,
		PairingTTL:       5 * time.Minute,
		MaxBodySize:      1024,
		ShutdownTimeout:  5 * time.Second,
		InstanceID:       "test",
		StoreBackend:     "memory",
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	tokens := newMemoryTokenStore(cfg.PairingTTL)
	return NewRelay(ctx, cfg, setupLogger("dev"), tokens)
}

func TestHealthEndpoint(t *testing.T) {
	relay := newTestRelay(t)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	relay.HandleHealth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", w.Code)
	}

	var body map[string]interface{}
	json.NewDecoder(w.Body).Decode(&body)
	if body["status"] != "ok" {
		t.Fatalf("status field: got %v, want ok", body["status"])
	}
	if body["instance"] != "test" {
		t.Fatalf("instance field: got %v, want test", body["instance"])
	}
}

func TestReadyEndpoint_Healthy(t *testing.T) {
	relay := newTestRelay(t)

	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	relay.HandleReady(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", w.Code)
	}

	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["status"] != "ready" {
		t.Fatalf("status field: got %v, want ready", body["status"])
	}
}

func TestReadyEndpoint_Draining(t *testing.T) {
	relay := newTestRelay(t)
	relay.draining.Store(true)

	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	relay.HandleReady(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d, want 503", w.Code)
	}
}

func TestPairRegisterHandler_Success(t *testing.T) {
	relay := newTestRelay(t)

	body := `{"token":"test-token-12345678901234567890"}`
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	relay.HandlePairRegister(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200, body: %s", w.Code, w.Body.String())
	}
}

func TestPairRegisterHandler_Duplicate(t *testing.T) {
	relay := newTestRelay(t)

	body := `{"token":"test-token-12345678901234567890"}`

	// First registration
	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	relay.HandlePairRegister(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first register: got %d, want 200", w.Code)
	}

	// Second registration — should be 409
	req = httptest.NewRequest("POST", "/api/pair", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	relay.HandlePairRegister(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("second register: got %d, want 409", w.Code)
	}
}

func TestPairRegisterHandler_MissingToken(t *testing.T) {
	relay := newTestRelay(t)

	req := httptest.NewRequest("POST", "/api/pair", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	relay.HandlePairRegister(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", w.Code)
	}
}
