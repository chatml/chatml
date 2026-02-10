package linear

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExchangeCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth/token" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected content-type: %s", r.Header.Get("Content-Type"))
		}

		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}

		if body["grant_type"] != "authorization_code" {
			t.Errorf("expected grant_type=authorization_code, got %s", body["grant_type"])
		}
		if body["code"] != "test-code" {
			t.Errorf("expected code=test-code, got %s", body["code"])
		}
		if body["code_verifier"] != "test-verifier" {
			t.Errorf("expected code_verifier=test-verifier, got %s", body["code_verifier"])
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token":  "access-123",
			"refresh_token": "refresh-456",
			"token_type":    "Bearer",
			"scope":         "read",
			"expires_in":    3600,
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")

	tokens, err := client.ExchangeCode(context.Background(), "test-code", "test-verifier", "chatml://oauth/callback")
	if err != nil {
		t.Fatalf("ExchangeCode failed: %v", err)
	}

	if tokens.AccessToken != "access-123" {
		t.Errorf("expected access_token=access-123, got %s", tokens.AccessToken)
	}
	if tokens.RefreshToken != "refresh-456" {
		t.Errorf("expected refresh_token=refresh-456, got %s", tokens.RefreshToken)
	}
	if tokens.TokenType != "Bearer" {
		t.Errorf("expected token_type=Bearer, got %s", tokens.TokenType)
	}
	if time.Until(tokens.ExpiresAt) < 59*time.Minute {
		t.Errorf("expected ExpiresAt ~1h from now, got %v", tokens.ExpiresAt)
	}
}

func TestExchangeCodeError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"error":             "invalid_grant",
			"error_description": "code expired",
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")

	_, err := client.ExchangeCode(context.Background(), "bad-code", "verifier", "chatml://oauth/callback")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestExchangeCodeMissingClientID(t *testing.T) {
	client := NewClient("")
	_, err := client.ExchangeCode(context.Background(), "code", "verifier", "redirect")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestRefreshToken(t *testing.T) {
	var refreshedTokensPersisted bool

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)

		if body["grant_type"] != "refresh_token" {
			t.Errorf("expected grant_type=refresh_token, got %s", body["grant_type"])
		}
		if body["refresh_token"] != "old-refresh" {
			t.Errorf("expected refresh_token=old-refresh, got %s", body["refresh_token"])
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token":  "new-access",
			"refresh_token": "new-refresh",
			"token_type":    "Bearer",
			"scope":         "read",
			"expires_in":    3600,
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")
	client.SetTokens(&TokenSet{
		AccessToken:  "old-access",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now().Add(-1 * time.Hour), // expired
	})
	client.SetOnTokenRefresh(func(ts *TokenSet) {
		refreshedTokensPersisted = true
		if ts.AccessToken != "new-access" {
			t.Errorf("callback got wrong access_token: %s", ts.AccessToken)
		}
	})

	tokens, err := client.RefreshToken(context.Background())
	if err != nil {
		t.Fatalf("RefreshToken failed: %v", err)
	}

	if tokens.AccessToken != "new-access" {
		t.Errorf("expected new-access, got %s", tokens.AccessToken)
	}
	if !refreshedTokensPersisted {
		t.Error("onTokenRefresh callback was not called")
	}
}

func TestGetViewer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer valid-token" {
			t.Errorf("expected Bearer valid-token, got %s", auth)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"viewer": map[string]interface{}{
					"id":          "user-1",
					"name":        "Test User",
					"email":       "test@example.com",
					"displayName": "Test",
					"avatarUrl":   "https://example.com/avatar.png",
				},
			},
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetAPIURL(srv.URL)
	client.SetTokens(&TokenSet{
		AccessToken: "valid-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
	})

	user, err := client.GetViewer(context.Background())
	if err != nil {
		t.Fatalf("GetViewer failed: %v", err)
	}

	if user.ID != "user-1" {
		t.Errorf("expected id=user-1, got %s", user.ID)
	}
	if user.Email != "test@example.com" {
		t.Errorf("expected email=test@example.com, got %s", user.Email)
	}
}

func TestIsAuthenticated(t *testing.T) {
	client := NewClient("test")

	if client.IsAuthenticated() {
		t.Error("expected not authenticated initially")
	}

	client.SetTokens(&TokenSet{AccessToken: "tok"})
	if !client.IsAuthenticated() {
		t.Error("expected authenticated after SetTokens")
	}

	client.ClearAuth()
	if client.IsAuthenticated() {
		t.Error("expected not authenticated after ClearAuth")
	}
}

func TestSetGetUser(t *testing.T) {
	client := NewClient("test")

	if client.GetStoredUser() != nil {
		t.Error("expected nil user initially")
	}

	client.SetUser(&User{ID: "u1", Name: "User"})
	u := client.GetStoredUser()
	if u == nil || u.ID != "u1" {
		t.Errorf("expected user with ID=u1, got %+v", u)
	}

	// Verify it's a copy (mutation shouldn't affect stored)
	u.Name = "Modified"
	stored := client.GetStoredUser()
	if stored.Name != "User" {
		t.Error("GetStoredUser should return copies")
	}

	client.SetUser(nil)
	if client.GetStoredUser() != nil {
		t.Error("expected nil after SetUser(nil)")
	}
}

// ============================================================================
// ExchangeCode edge cases
// ============================================================================

func TestExchangeCode_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")

	_, err := client.ExchangeCode(context.Background(), "code", "verifier", "redirect")
	if err == nil {
		t.Fatal("expected error on 500 response")
	}
}

func TestExchangeCode_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")

	_, err := client.ExchangeCode(context.Background(), "code", "verifier", "redirect")
	if err == nil {
		t.Fatal("expected error on invalid JSON response")
	}
}

func TestExchangeCode_ContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Slow handler
		time.Sleep(5 * time.Second)
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.ExchangeCode(ctx, "code", "verifier", "redirect")
	if err == nil {
		t.Fatal("expected error on cancelled context")
	}
}

// ============================================================================
// RefreshToken edge cases
// ============================================================================

func TestRefreshToken_NoRefreshToken(t *testing.T) {
	client := NewClient("test")
	client.SetTokens(&TokenSet{AccessToken: "access", ExpiresAt: time.Now()})

	_, err := client.RefreshToken(context.Background())
	if err == nil {
		t.Fatal("expected error when no refresh token")
	}
}

func TestRefreshToken_NoTokensAtAll(t *testing.T) {
	client := NewClient("test")

	_, err := client.RefreshToken(context.Background())
	if err == nil {
		t.Fatal("expected error when no tokens at all")
	}
}

func TestRefreshToken_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("bad request"))
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")
	client.SetTokens(&TokenSet{
		AccessToken:  "old",
		RefreshToken: "refresh-tok",
		ExpiresAt:    time.Now(),
	})

	_, err := client.RefreshToken(context.Background())
	if err == nil {
		t.Fatal("expected error on 400 response")
	}
}

func TestRefreshToken_ErrorResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"error":             "invalid_grant",
			"error_description": "refresh token revoked",
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")
	client.SetTokens(&TokenSet{
		AccessToken:  "old",
		RefreshToken: "revoked-refresh",
		ExpiresAt:    time.Now(),
	})

	_, err := client.RefreshToken(context.Background())
	if err == nil {
		t.Fatal("expected error on revoked refresh token")
	}
}

func TestRefreshToken_UpdatesStoredTokens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token":  "new-access",
			"refresh_token": "new-refresh",
			"token_type":    "Bearer",
			"expires_in":    7200,
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")
	client.SetTokens(&TokenSet{
		AccessToken:  "old-access",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now(),
	})

	_, err := client.RefreshToken(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify in-memory tokens were updated
	tokens := client.GetTokens()
	if tokens.AccessToken != "new-access" {
		t.Errorf("expected access token new-access, got %s", tokens.AccessToken)
	}
	if tokens.RefreshToken != "new-refresh" {
		t.Errorf("expected refresh token new-refresh, got %s", tokens.RefreshToken)
	}
}

// ============================================================================
// GetViewer edge cases
// ============================================================================

func TestGetViewer_NotAuthenticated(t *testing.T) {
	client := NewClient("test")

	_, err := client.GetViewer(context.Background())
	if err == nil {
		t.Fatal("expected error when not authenticated")
	}
}

func TestGetViewer_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("forbidden"))
	}))
	defer srv.Close()

	client := NewClient("test")
	client.SetAPIURL(srv.URL)
	client.SetTokens(&TokenSet{
		AccessToken: "tok",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
	})

	_, err := client.GetViewer(context.Background())
	if err == nil {
		t.Fatal("expected error on 403 response")
	}
}

func TestGetViewer_GraphQLError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errors": []map[string]string{
				{"message": "Authentication required"},
			},
		})
	}))
	defer srv.Close()

	client := NewClient("test")
	client.SetAPIURL(srv.URL)
	client.SetTokens(&TokenSet{
		AccessToken: "tok",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
	})

	_, err := client.GetViewer(context.Background())
	if err == nil {
		t.Fatal("expected error on GraphQL error response")
	}
}

func TestGetViewer_InvalidJSONResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	client := NewClient("test")
	client.SetAPIURL(srv.URL)
	client.SetTokens(&TokenSet{
		AccessToken: "tok",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
	})

	_, err := client.GetViewer(context.Background())
	if err == nil {
		t.Fatal("expected error on invalid JSON response")
	}
}

// ============================================================================
// Token management edge cases
// ============================================================================

func TestGetTokens_ReturnsCopy(t *testing.T) {
	client := NewClient("test")
	client.SetTokens(&TokenSet{AccessToken: "original"})

	tokens := client.GetTokens()
	tokens.AccessToken = "modified"

	stored := client.GetTokens()
	if stored.AccessToken != "original" {
		t.Error("GetTokens should return copies")
	}
}

func TestSetTokens_StoresCopy(t *testing.T) {
	client := NewClient("test")
	original := &TokenSet{AccessToken: "original"}
	client.SetTokens(original)

	original.AccessToken = "modified"

	stored := client.GetTokens()
	if stored.AccessToken != "original" {
		t.Error("SetTokens should store a copy")
	}
}

func TestSetTokens_Nil(t *testing.T) {
	client := NewClient("test")
	client.SetTokens(&TokenSet{AccessToken: "tok"})
	client.SetTokens(nil)

	if client.GetTokens() != nil {
		t.Error("expected nil tokens after SetTokens(nil)")
	}
	if client.IsAuthenticated() {
		t.Error("expected not authenticated after SetTokens(nil)")
	}
}

func TestIsAuthenticated_EmptyAccessToken(t *testing.T) {
	client := NewClient("test")
	client.SetTokens(&TokenSet{AccessToken: "", RefreshToken: "refresh"})

	if client.IsAuthenticated() {
		t.Error("expected not authenticated with empty access token")
	}
}

// ============================================================================
// Auto-refresh integration
// ============================================================================

func TestAutoRefreshOnGetViewer(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")

		if r.URL.Path == "/oauth/token" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token":  "refreshed-token",
				"refresh_token": "new-refresh",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
			return
		}

		// GraphQL endpoint
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"viewer": map[string]interface{}{
					"id":          "user-1",
					"name":        "Test",
					"email":       "test@test.com",
					"displayName": "Test",
					"avatarUrl":   "",
				},
			},
		})
	}))
	defer srv.Close()

	client := NewClient("test-client-id")
	client.SetOAuthURL(srv.URL + "/oauth")
	client.SetAPIURL(srv.URL + "/graphql")
	client.SetTokens(&TokenSet{
		AccessToken:  "expiring-soon",
		RefreshToken: "refresh-tok",
		ExpiresAt:    time.Now().Add(2 * time.Minute), // within 5min window
	})

	_, err := client.GetViewer(context.Background())
	if err != nil {
		t.Fatalf("GetViewer failed: %v", err)
	}

	// Should have hit both /oauth/token (refresh) and /graphql (viewer)
	if callCount != 2 {
		t.Errorf("expected 2 calls (refresh + viewer), got %d", callCount)
	}
}
