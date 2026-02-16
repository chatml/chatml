// backend/server/auth_handlers_test.go
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/store"
)

// setupMockGitHubServer creates a mock GitHub API server for testing
func setupMockGitHubServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/user":
			// Check auth header
			auth := r.Header.Get("Authorization")
			if auth == "" || auth == "Bearer " || auth == "Bearer invalid_token" {
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"message": "Bad credentials"}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"login":      "testuser",
				"name":       "Test User",
				"avatar_url": "https://github.com/testuser.png",
			})
		case "/login/oauth/access_token":
			// OAuth code exchange
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"access_token": "gho_test_token_from_oauth",
				"token_type":   "bearer",
				"scope":        "repo,read:user",
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

// newTestGitHubClient creates a GitHub client configured to use the mock server
func newTestGitHubClient(t *testing.T, mockServer *httptest.Server) *github.Client {
	t.Helper()
	client := github.NewClient("test_client_id", "test_client_secret")
	client.SetAPIURL(mockServer.URL)
	client.SetBaseURL(mockServer.URL)
	return client
}

// newTestStore creates an in-memory SQLite store for testing
func newTestAuthStore(t *testing.T) *store.SQLiteStore {
	t.Helper()
	s, err := store.NewSQLiteStoreInMemory()
	if err != nil {
		t.Fatalf("Failed to create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestAuthHandlers_SetToken(t *testing.T) {
	mockServer := setupMockGitHubServer(t)
	defer mockServer.Close()

	ghClient := newTestGitHubClient(t, mockServer)
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{"token":"test_token_123"}`)
	req := httptest.NewRequest("POST", "/api/auth/token", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetToken(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify token was stored
	if ghClient.GetToken() != "test_token_123" {
		t.Errorf("Token not stored correctly, got %s", ghClient.GetToken())
	}

	// Verify user was fetched and stored
	user := ghClient.GetStoredUser()
	if user == nil || user.Login != "testuser" {
		t.Errorf("User not stored correctly, got %+v", user)
	}
}

func TestAuthHandlers_SetToken_InvalidToken(t *testing.T) {
	mockServer := setupMockGitHubServer(t)
	defer mockServer.Close()

	ghClient := newTestGitHubClient(t, mockServer)
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{"token":"invalid_token"}`)
	req := httptest.NewRequest("POST", "/api/auth/token", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetToken(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}

	// Token should not be stored
	if ghClient.GetToken() != "" {
		t.Errorf("Token should not be stored for invalid token")
	}
}

func TestAuthHandlers_SetToken_EmptyToken(t *testing.T) {
	mockServer := setupMockGitHubServer(t)
	defer mockServer.Close()

	ghClient := newTestGitHubClient(t, mockServer)
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{"token":""}`)
	req := httptest.NewRequest("POST", "/api/auth/token", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetToken(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestAuthHandlers_SetToken_InvalidJSON(t *testing.T) {
	mockServer := setupMockGitHubServer(t)
	defer mockServer.Close()

	ghClient := newTestGitHubClient(t, mockServer)
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{invalid json}`)
	req := httptest.NewRequest("POST", "/api/auth/token", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetToken(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestAuthHandlers_SetToken_SkipsWhenAlreadyAuthenticated(t *testing.T) {
	mockServer := setupMockGitHubServer(t)
	defer mockServer.Close()

	ghClient := newTestGitHubClient(t, mockServer)
	// Pre-set tokens (simulating SQLite restore)
	ghClient.SetTokens(&github.TokenSet{AccessToken: "existing_token"})
	ghClient.SetUser(&github.User{Login: "existinguser"})
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{"token":"frontend_token"}`)
	req := httptest.NewRequest("POST", "/api/auth/token", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetToken(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Token should still be the existing one, not the frontend one
	if ghClient.GetToken() != "existing_token" {
		t.Errorf("Token should remain existing_token, got %s", ghClient.GetToken())
	}
}

func TestAuthHandlers_GetStatus_Unauthenticated(t *testing.T) {
	ghClient := github.NewClient("", "")
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	req := httptest.NewRequest("GET", "/api/auth/status", nil)
	w := httptest.NewRecorder()

	handlers.GetStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp AuthStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if resp.Authenticated {
		t.Error("Expected authenticated=false")
	}
	if resp.User != nil {
		t.Error("Expected user to be nil when unauthenticated")
	}
}

func TestAuthHandlers_GetStatus_Authenticated(t *testing.T) {
	ghClient := github.NewClient("", "")
	ghClient.SetToken("test_token")
	ghClient.SetUser(&github.User{Login: "testuser", Name: "Test User"})
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	req := httptest.NewRequest("GET", "/api/auth/status", nil)
	w := httptest.NewRecorder()

	handlers.GetStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp AuthStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !resp.Authenticated {
		t.Error("Expected authenticated=true")
	}
	if resp.User == nil || resp.User.Login != "testuser" {
		t.Error("Expected user info")
	}
}

func TestAuthHandlers_Logout(t *testing.T) {
	ghClient := github.NewClient("", "")
	ghClient.SetToken("test_token")
	ghClient.SetUser(&github.User{Login: "testuser"})
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	w := httptest.NewRecorder()

	handlers.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if ghClient.IsAuthenticated() {
		t.Error("Expected token to be cleared")
	}

	if ghClient.GetStoredUser() != nil {
		t.Error("Expected user to be cleared")
	}
}

func TestAuthHandlers_GitHubCallback(t *testing.T) {
	mockServer := setupMockGitHubServer(t)
	defer mockServer.Close()

	ghClient := newTestGitHubClient(t, mockServer)
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{"code":"test_oauth_code"}`)
	req := httptest.NewRequest("POST", "/api/auth/github/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.GitHubCallback(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp GitHubCallbackResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if resp.Token != "gho_test_token_from_oauth" {
		t.Errorf("Expected token gho_test_token_from_oauth, got %s", resp.Token)
	}
	if resp.User == nil || resp.User.Login != "testuser" {
		t.Error("Expected user info in response")
	}

	// Verify state was stored
	if ghClient.GetToken() != "gho_test_token_from_oauth" {
		t.Error("Token not stored in client")
	}
	if ghClient.GetStoredUser() == nil || ghClient.GetStoredUser().Login != "testuser" {
		t.Error("User not stored in client")
	}
}

func TestAuthHandlers_GitHubCallback_EmptyCode(t *testing.T) {
	ghClient := github.NewClient("", "")
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{"code":""}`)
	req := httptest.NewRequest("POST", "/api/auth/github/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.GitHubCallback(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestAuthHandlers_GitHubCallback_InvalidJSON(t *testing.T) {
	ghClient := github.NewClient("", "")
	handlers := NewAuthHandlers(ghClient, newTestAuthStore(t))

	body := bytes.NewBufferString(`{invalid}`)
	req := httptest.NewRequest("POST", "/api/auth/github/callback", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.GitHubCallback(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}
