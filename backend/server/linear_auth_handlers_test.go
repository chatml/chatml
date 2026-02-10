package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/crypto"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/store"
)

// setupMockLinearServer creates a mock Linear OAuth + API server for testing
func setupMockLinearServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)

			if body["code"] == "bad_code" {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{
					"error":             "invalid_grant",
					"error_description": "code expired",
				})
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token":  "lin_access_test",
				"refresh_token": "lin_refresh_test",
				"token_type":    "Bearer",
				"scope":         "read",
				"expires_in":    3600,
			})
		case "/graphql":
			auth := r.Header.Get("Authorization")
			if auth == "" || auth == "Bearer " {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"data": map[string]interface{}{
					"viewer": map[string]interface{}{
						"id":          "user-lin-1",
						"name":        "Linear Test User",
						"email":       "test@linear.app",
						"displayName": "LTU",
						"avatarUrl":   "https://linear.app/avatar.png",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

// newTestLinearClient creates a Linear client configured to use the mock server
func newTestLinearClient(t *testing.T, mockServer *httptest.Server) *linear.Client {
	t.Helper()
	client := linear.NewClient("test_linear_client_id")
	client.SetOAuthURL(mockServer.URL + "/oauth")
	client.SetAPIURL(mockServer.URL + "/graphql")
	return client
}

// newTestLinearAuthHandlers creates handlers with an in-memory store and mock Linear client
func newTestLinearAuthHandlers(t *testing.T, mockServer *httptest.Server) (*LinearAuthHandlers, *linear.Client, *store.SQLiteStore) {
	t.Helper()
	lc := newTestLinearClient(t, mockServer)
	s, err := store.NewSQLiteStoreInMemory()
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	h := NewLinearAuthHandlers(lc, s)
	return h, lc, s
}

// ============================================================================
// Callback Tests
// ============================================================================

func TestLinearAuthHandlers_Callback_Success(t *testing.T) {
	mockServer := setupMockLinearServer(t)
	defer mockServer.Close()

	h, lc, s := newTestLinearAuthHandlers(t, mockServer)

	body := bytes.NewBufferString(`{"code":"test_code","code_verifier":"test_verifier","redirect_uri":"chatml://oauth/callback"}`)
	req := httptest.NewRequest("POST", "/api/auth/linear/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Callback(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp LinearCallbackResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if resp.User == nil {
		t.Fatal("Expected user in response")
	}
	if resp.User.Email != "test@linear.app" {
		t.Errorf("Expected email test@linear.app, got %s", resp.User.Email)
	}
	if resp.User.DisplayName != "LTU" {
		t.Errorf("Expected displayName LTU, got %s", resp.User.DisplayName)
	}

	// Verify client state was updated
	if !lc.IsAuthenticated() {
		t.Error("Expected client to be authenticated")
	}
	user := lc.GetStoredUser()
	if user == nil || user.ID != "user-lin-1" {
		t.Error("Expected user stored in client")
	}

	// Verify tokens were persisted to store
	ctx := context.Background()
	encAccess, found, err := s.GetSetting(ctx, settingLinearAccessToken)
	if err != nil || !found {
		t.Fatal("Expected access token to be persisted")
	}
	decAccess, err := crypto.Decrypt(encAccess)
	if err != nil || decAccess != "lin_access_test" {
		t.Errorf("Expected persisted access token to decrypt to lin_access_test, got %s", decAccess)
	}

	encRefresh, found, _ := s.GetSetting(ctx, settingLinearRefreshToken)
	if !found {
		t.Fatal("Expected refresh token to be persisted")
	}
	decRefresh, _ := crypto.Decrypt(encRefresh)
	if decRefresh != "lin_refresh_test" {
		t.Errorf("Expected persisted refresh token to decrypt to lin_refresh_test, got %s", decRefresh)
	}

	_, found, _ = s.GetSetting(ctx, settingLinearTokenExpiry)
	if !found {
		t.Fatal("Expected token expiry to be persisted")
	}

	encUser, found, _ := s.GetSetting(ctx, settingLinearUser)
	if !found {
		t.Fatal("Expected user to be persisted")
	}
	decUser, _ := crypto.Decrypt(encUser)
	var persistedUser linear.User
	json.Unmarshal([]byte(decUser), &persistedUser)
	if persistedUser.Email != "test@linear.app" {
		t.Errorf("Expected persisted user email to be test@linear.app, got %s", persistedUser.Email)
	}
}

func TestLinearAuthHandlers_Callback_DefaultRedirectURI(t *testing.T) {
	mockServer := setupMockLinearServer(t)
	defer mockServer.Close()

	h, _, _ := newTestLinearAuthHandlers(t, mockServer)

	// Omit redirect_uri — should default to chatml://oauth/callback
	body := bytes.NewBufferString(`{"code":"test_code","code_verifier":"v"}`)
	req := httptest.NewRequest("POST", "/api/auth/linear/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Callback(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLinearAuthHandlers_Callback_EmptyCode(t *testing.T) {
	mockServer := setupMockLinearServer(t)
	defer mockServer.Close()

	h, _, _ := newTestLinearAuthHandlers(t, mockServer)

	body := bytes.NewBufferString(`{"code":""}`)
	req := httptest.NewRequest("POST", "/api/auth/linear/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Callback(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestLinearAuthHandlers_Callback_InvalidJSON(t *testing.T) {
	mockServer := setupMockLinearServer(t)
	defer mockServer.Close()

	h, _, _ := newTestLinearAuthHandlers(t, mockServer)

	body := bytes.NewBufferString(`{invalid}`)
	req := httptest.NewRequest("POST", "/api/auth/linear/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Callback(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestLinearAuthHandlers_Callback_ExchangeError(t *testing.T) {
	mockServer := setupMockLinearServer(t)
	defer mockServer.Close()

	h, lc, _ := newTestLinearAuthHandlers(t, mockServer)

	body := bytes.NewBufferString(`{"code":"bad_code","code_verifier":"v"}`)
	req := httptest.NewRequest("POST", "/api/auth/linear/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Callback(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("Expected status 502, got %d: %s", w.Code, w.Body.String())
	}

	// Client should NOT be authenticated after failed exchange
	if lc.IsAuthenticated() {
		t.Error("Expected client to remain unauthenticated after failed exchange")
	}
}

// ============================================================================
// GetStatus Tests
// ============================================================================

func TestLinearAuthHandlers_GetStatus_Unauthenticated(t *testing.T) {
	lc := linear.NewClient("")
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	req := httptest.NewRequest("GET", "/api/auth/linear/status", nil)
	w := httptest.NewRecorder()

	h.GetStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp LinearAuthStatusResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Authenticated {
		t.Error("Expected authenticated=false")
	}
	if resp.User != nil {
		t.Error("Expected user to be nil")
	}
}

func TestLinearAuthHandlers_GetStatus_Authenticated(t *testing.T) {
	lc := linear.NewClient("")
	lc.SetTokens(&linear.TokenSet{AccessToken: "tok", ExpiresAt: time.Now().Add(1 * time.Hour)})
	lc.SetUser(&linear.User{ID: "u1", Name: "Test", Email: "test@test.com", DisplayName: "TU"})

	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	req := httptest.NewRequest("GET", "/api/auth/linear/status", nil)
	w := httptest.NewRecorder()

	h.GetStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp LinearAuthStatusResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if !resp.Authenticated {
		t.Error("Expected authenticated=true")
	}
	if resp.User == nil || resp.User.DisplayName != "TU" {
		t.Errorf("Expected user with displayName TU, got %+v", resp.User)
	}
}

// ============================================================================
// Logout Tests
// ============================================================================

func TestLinearAuthHandlers_Logout(t *testing.T) {
	lc := linear.NewClient("")
	lc.SetTokens(&linear.TokenSet{AccessToken: "tok"})
	lc.SetUser(&linear.User{ID: "u1"})

	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()

	// Pre-populate settings to verify they get cleared
	ctx := context.Background()
	s.SetSetting(ctx, settingLinearAccessToken, "enc-access")
	s.SetSetting(ctx, settingLinearRefreshToken, "enc-refresh")
	s.SetSetting(ctx, settingLinearTokenExpiry, "2025-01-01T00:00:00Z")
	s.SetSetting(ctx, settingLinearUser, "enc-user")

	h := NewLinearAuthHandlers(lc, s)

	req := httptest.NewRequest("POST", "/api/auth/linear/logout", nil)
	w := httptest.NewRecorder()

	h.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify client state cleared
	if lc.IsAuthenticated() {
		t.Error("Expected client to be unauthenticated after logout")
	}
	if lc.GetStoredUser() != nil {
		t.Error("Expected user to be nil after logout")
	}

	// Verify all settings were removed
	for _, key := range []string{settingLinearAccessToken, settingLinearRefreshToken, settingLinearTokenExpiry, settingLinearUser} {
		_, found, _ := s.GetSetting(ctx, key)
		if found {
			t.Errorf("Expected setting %s to be deleted after logout", key)
		}
	}
}

func TestLinearAuthHandlers_Logout_WhenAlreadyLoggedOut(t *testing.T) {
	lc := linear.NewClient("")
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	req := httptest.NewRequest("POST", "/api/auth/linear/logout", nil)
	w := httptest.NewRecorder()

	h.Logout(w, req)

	// Should still succeed even if already logged out
	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

// ============================================================================
// RestoreFromStore Tests
// ============================================================================

func TestLinearAuthHandlers_RestoreFromStore_Success(t *testing.T) {
	lc := linear.NewClient("")
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	ctx := context.Background()

	// Encrypt and store tokens
	encAccess, _ := crypto.Encrypt("restored-access-token")
	s.SetSetting(ctx, settingLinearAccessToken, encAccess)

	encRefresh, _ := crypto.Encrypt("restored-refresh-token")
	s.SetSetting(ctx, settingLinearRefreshToken, encRefresh)

	expiry := time.Now().Add(1 * time.Hour).Format(time.RFC3339)
	s.SetSetting(ctx, settingLinearTokenExpiry, expiry)

	userJSON, _ := json.Marshal(linear.User{
		ID: "u-restored", Name: "Restored", Email: "restored@test.com", DisplayName: "R",
	})
	encUser, _ := crypto.Encrypt(string(userJSON))
	s.SetSetting(ctx, settingLinearUser, encUser)

	// Restore
	h.RestoreFromStore(ctx)

	// Verify client is authenticated with restored tokens
	if !lc.IsAuthenticated() {
		t.Fatal("Expected client to be authenticated after restore")
	}

	tokens := lc.GetTokens()
	if tokens.AccessToken != "restored-access-token" {
		t.Errorf("Expected access token restored-access-token, got %s", tokens.AccessToken)
	}
	if tokens.RefreshToken != "restored-refresh-token" {
		t.Errorf("Expected refresh token restored-refresh-token, got %s", tokens.RefreshToken)
	}

	user := lc.GetStoredUser()
	if user == nil || user.ID != "u-restored" {
		t.Errorf("Expected restored user u-restored, got %+v", user)
	}
	if user.Email != "restored@test.com" {
		t.Errorf("Expected email restored@test.com, got %s", user.Email)
	}
}

func TestLinearAuthHandlers_RestoreFromStore_NoTokens(t *testing.T) {
	lc := linear.NewClient("")
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	// Don't store anything - restore should be a no-op
	h.RestoreFromStore(context.Background())

	if lc.IsAuthenticated() {
		t.Error("Expected client to remain unauthenticated when no tokens stored")
	}
}

func TestLinearAuthHandlers_RestoreFromStore_CorruptedToken(t *testing.T) {
	lc := linear.NewClient("")
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	ctx := context.Background()
	// Store invalid encrypted data
	s.SetSetting(ctx, settingLinearAccessToken, "not-valid-encrypted-data")

	h.RestoreFromStore(ctx)

	// Should gracefully handle decryption failure
	if lc.IsAuthenticated() {
		t.Error("Expected client to remain unauthenticated with corrupted tokens")
	}
}

func TestLinearAuthHandlers_RestoreFromStore_WithoutUser(t *testing.T) {
	lc := linear.NewClient("")
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()
	h := NewLinearAuthHandlers(lc, s)

	ctx := context.Background()
	encAccess, _ := crypto.Encrypt("access-tok")
	s.SetSetting(ctx, settingLinearAccessToken, encAccess)
	s.SetSetting(ctx, settingLinearTokenExpiry, time.Now().Add(1*time.Hour).Format(time.RFC3339))

	h.RestoreFromStore(ctx)

	// Should be authenticated even without user info
	if !lc.IsAuthenticated() {
		t.Fatal("Expected client to be authenticated")
	}
	if lc.GetStoredUser() != nil {
		t.Error("Expected no user when user setting is absent")
	}
}

// ============================================================================
// PersistLinearTokens Tests
// ============================================================================

func TestPersistLinearTokens(t *testing.T) {
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()

	ctx := context.Background()
	tokens := &linear.TokenSet{
		AccessToken:  "persist-access",
		RefreshToken: "persist-refresh",
		ExpiresAt:    time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC),
	}

	err := PersistLinearTokens(ctx, s, tokens)
	if err != nil {
		t.Fatalf("PersistLinearTokens failed: %v", err)
	}

	// Verify access token
	enc, found, _ := s.GetSetting(ctx, settingLinearAccessToken)
	if !found {
		t.Fatal("Expected access token setting")
	}
	dec, _ := crypto.Decrypt(enc)
	if dec != "persist-access" {
		t.Errorf("Expected persist-access, got %s", dec)
	}

	// Verify refresh token
	enc, found, _ = s.GetSetting(ctx, settingLinearRefreshToken)
	if !found {
		t.Fatal("Expected refresh token setting")
	}
	dec, _ = crypto.Decrypt(enc)
	if dec != "persist-refresh" {
		t.Errorf("Expected persist-refresh, got %s", dec)
	}

	// Verify expiry
	expiryStr, found, _ := s.GetSetting(ctx, settingLinearTokenExpiry)
	if !found {
		t.Fatal("Expected token expiry setting")
	}
	if expiryStr != "2026-06-15T12:00:00Z" {
		t.Errorf("Expected 2026-06-15T12:00:00Z, got %s", expiryStr)
	}
}

func TestPersistLinearTokens_NoRefreshToken(t *testing.T) {
	s, _ := store.NewSQLiteStoreInMemory()
	defer s.Close()

	ctx := context.Background()
	tokens := &linear.TokenSet{
		AccessToken: "access-only",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
	}

	err := PersistLinearTokens(ctx, s, tokens)
	if err != nil {
		t.Fatalf("PersistLinearTokens failed: %v", err)
	}

	// Access token should be stored
	_, found, _ := s.GetSetting(ctx, settingLinearAccessToken)
	if !found {
		t.Fatal("Expected access token to be stored")
	}

	// Refresh token should NOT be stored (empty)
	_, found, _ = s.GetSetting(ctx, settingLinearRefreshToken)
	if found {
		t.Error("Expected refresh token to NOT be stored when empty")
	}
}
