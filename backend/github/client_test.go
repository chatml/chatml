// backend/github/client_test.go
package github

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestExchangeCode(t *testing.T) {
	// Mock GitHub OAuth server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"access_token": "gho_test_token_123",
				"token_type":   "bearer",
				"scope":        "repo,read:user",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL // Override for testing

	token, err := client.ExchangeCode(context.Background(), "test_code", "")
	if err != nil {
		t.Fatalf("ExchangeCode failed: %v", err)
	}
	if token != "gho_test_token_123" {
		t.Errorf("Expected token gho_test_token_123, got %s", token)
	}
}

func TestGetUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/user" {
			// Check auth header
			auth := r.Header.Get("Authorization")
			if auth != "Bearer test_token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{
				"login":      "testuser",
				"name":       "Test User",
				"avatar_url": "https://github.com/testuser.png",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL

	user, err := client.GetUser(context.Background(), "test_token")
	if err != nil {
		t.Fatalf("GetUser failed: %v", err)
	}
	if user.Login != "testuser" {
		t.Errorf("Expected login testuser, got %s", user.Login)
	}
}

func TestExchangeCode_OAuthError(t *testing.T) {
	// Mock GitHub OAuth server that returns an OAuth error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"error":             "bad_verification_code",
				"error_description": "The code passed is incorrect or expired.",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL

	_, err := client.ExchangeCode(context.Background(), "invalid_code", "")
	if err == nil {
		t.Fatal("Expected error for OAuth error response, got nil")
	}
	if !strings.Contains(err.Error(), "bad_verification_code") {
		t.Errorf("Expected error to contain 'bad_verification_code', got: %v", err)
	}
	if !strings.Contains(err.Error(), "The code passed is incorrect or expired") {
		t.Errorf("Expected error to contain error description, got: %v", err)
	}
}

func TestExchangeCode_Non200Status(t *testing.T) {
	// Mock GitHub OAuth server that returns a non-200 status code
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("Internal Server Error"))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL

	_, err := client.ExchangeCode(context.Background(), "test_code", "")
	if err == nil {
		t.Fatal("Expected error for non-200 status, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("Expected error to contain status code 500, got: %v", err)
	}
}

func TestExchangeCode_VerifyRequest(t *testing.T) {
	// Mock GitHub OAuth server that verifies HTTP method and request body
	var receivedMethod string
	var receivedBody string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			receivedMethod = r.Method

			body, _ := io.ReadAll(r.Body)
			receivedBody = string(body)

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"access_token": "gho_test_token",
				"token_type":   "bearer",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL

	_, err := client.ExchangeCode(context.Background(), "test_code_123", "")
	if err != nil {
		t.Fatalf("ExchangeCode failed: %v", err)
	}

	// Verify HTTP method is POST
	if receivedMethod != "POST" {
		t.Errorf("Expected HTTP method POST, got %s", receivedMethod)
	}

	// Verify request body contains required fields
	if !strings.Contains(receivedBody, "client_id=test_client_id") {
		t.Errorf("Request body missing client_id, got: %s", receivedBody)
	}
	if !strings.Contains(receivedBody, "client_secret=test_client_secret") {
		t.Errorf("Request body missing client_secret, got: %s", receivedBody)
	}
	if !strings.Contains(receivedBody, "code=test_code_123") {
		t.Errorf("Request body missing code, got: %s", receivedBody)
	}
}

func TestExchangeCode_WithPKCE(t *testing.T) {
	// Mock GitHub OAuth server that verifies PKCE code_verifier is included
	var receivedBody string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			body, _ := io.ReadAll(r.Body)
			receivedBody = string(body)

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"access_token": "gho_test_token",
				"token_type":   "bearer",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL

	// Test with PKCE code verifier
	_, err := client.ExchangeCode(context.Background(), "test_code", "test_verifier_abc123")
	if err != nil {
		t.Fatalf("ExchangeCode with PKCE failed: %v", err)
	}

	// Verify code_verifier is included in request
	if !strings.Contains(receivedBody, "code_verifier=test_verifier_abc123") {
		t.Errorf("Request body missing code_verifier, got: %s", receivedBody)
	}
}

// ============================================================================
// Additional Tests
// ============================================================================

func TestNewClient(t *testing.T) {
	client := NewClient("my-client-id", "my-client-secret")

	require.NotNil(t, client)
	require.Equal(t, "my-client-id", client.clientID)
	require.Equal(t, "my-client-secret", client.clientSecret)
	require.Equal(t, "https://github.com", client.baseURL)
	require.Equal(t, "https://api.github.com", client.apiURL)
	require.NotNil(t, client.httpClient)
}

func TestClient_ExchangeCode_MissingClientID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Server should not be called when client ID is missing")
	}))
	defer server.Close()

	client := NewClient("", "test_client_secret")
	client.baseURL = server.URL

	_, err := client.ExchangeCode(context.Background(), "test_code", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "GITHUB_CLIENT_ID not configured")
}

func TestClient_ExchangeCode_MissingClientSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Server should not be called when client secret is missing")
	}))
	defer server.Close()

	client := NewClient("test_client_id", "")
	client.baseURL = server.URL

	_, err := client.ExchangeCode(context.Background(), "test_code", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "GITHUB_CLIENT_SECRET not configured")
}

func TestClient_ExchangeCode_NetworkError(t *testing.T) {
	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = "http://localhost:99999" // Invalid port

	_, err := client.ExchangeCode(context.Background(), "test_code", "")
	require.Error(t, err)
}

func TestClient_ExchangeCode_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL

	_, err := client.ExchangeCode(context.Background(), "test_code", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "decoding")
}

func TestClient_ExchangeCode_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		json.NewEncoder(w).Encode(map[string]string{"access_token": "token"})
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.ExchangeCode(ctx, "test_code", "")
	require.Error(t, err)
}

func TestClient_GetUser_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"message": "Bad credentials"}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL

	_, err := client.GetUser(context.Background(), "invalid_token")
	require.Error(t, err)
	require.Contains(t, err.Error(), "401")
}

func TestClient_GetUser_NetworkError(t *testing.T) {
	client := NewClient("", "")
	client.apiURL = "http://localhost:99999" // Invalid port

	_, err := client.GetUser(context.Background(), "test_token")
	require.Error(t, err)
}

func TestClient_GetUser_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL

	_, err := client.GetUser(context.Background(), "test_token")
	require.Error(t, err)
	require.Contains(t, err.Error(), "decoding")
}

func TestClient_SetToken_GetToken(t *testing.T) {
	client := NewClient("", "")

	require.Empty(t, client.GetToken())

	client.SetToken("my-test-token")
	require.Equal(t, "my-test-token", client.GetToken())

	client.SetToken("updated-token")
	require.Equal(t, "updated-token", client.GetToken())
}

func TestClient_SetUser_GetStoredUser(t *testing.T) {
	client := NewClient("", "")

	require.Nil(t, client.GetStoredUser())

	user := &User{
		Login:     "testuser",
		Name:      "Test User",
		AvatarURL: "https://example.com/avatar.png",
	}
	client.SetUser(user)

	stored := client.GetStoredUser()
	require.NotNil(t, stored)
	require.Equal(t, "testuser", stored.Login)
	require.Equal(t, "Test User", stored.Name)
	require.Equal(t, "https://example.com/avatar.png", stored.AvatarURL)

	// Verify it's a copy (modifying original doesn't affect stored)
	user.Name = "Modified"
	stored2 := client.GetStoredUser()
	require.Equal(t, "Test User", stored2.Name)

	// Verify returned is a copy (modifying returned doesn't affect stored)
	stored.Name = "Also Modified"
	stored3 := client.GetStoredUser()
	require.Equal(t, "Test User", stored3.Name)
}

func TestClient_SetUser_Nil(t *testing.T) {
	client := NewClient("", "")

	client.SetUser(&User{Login: "test"})
	require.NotNil(t, client.GetStoredUser())

	client.SetUser(nil)
	require.Nil(t, client.GetStoredUser())
}

func TestClient_ClearAuth(t *testing.T) {
	client := NewClient("", "")

	client.SetToken("test-token")
	client.SetUser(&User{Login: "testuser"})

	require.NotEmpty(t, client.GetToken())
	require.NotNil(t, client.GetStoredUser())

	client.ClearAuth()

	require.Empty(t, client.GetToken())
	require.Nil(t, client.GetStoredUser())
}

func TestClient_IsAuthenticated_True(t *testing.T) {
	client := NewClient("", "")

	client.SetToken("test-token")
	require.True(t, client.IsAuthenticated())
}

func TestClient_IsAuthenticated_False(t *testing.T) {
	client := NewClient("", "")

	require.False(t, client.IsAuthenticated())

	client.SetToken("")
	require.False(t, client.IsAuthenticated())
}

func TestClient_ConcurrentAccess(t *testing.T) {
	client := NewClient("", "")

	var wg sync.WaitGroup
	const numGoroutines = 100

	// Concurrent token access
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			// Mix of reads and writes
			if id%2 == 0 {
				client.SetToken("token-" + string(rune('0'+id%10)))
			} else {
				_ = client.GetToken()
			}
		}(i)
	}

	// Concurrent user access
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			if id%2 == 0 {
				client.SetUser(&User{Login: "user-" + string(rune('0'+id%10))})
			} else {
				_ = client.GetStoredUser()
			}
		}(i)
	}

	// Concurrent authentication check
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = client.IsAuthenticated()
		}()
	}

	wg.Wait()
}

func TestClient_SetBaseURL(t *testing.T) {
	client := NewClient("", "")
	require.Equal(t, "https://github.com", client.baseURL)

	client.SetBaseURL("https://github.example.com")
	require.Equal(t, "https://github.example.com", client.baseURL)
}

func TestClient_SetAPIURL(t *testing.T) {
	client := NewClient("", "")
	require.Equal(t, "https://api.github.com", client.apiURL)

	client.SetAPIURL("https://api.github.example.com")
	require.Equal(t, "https://api.github.example.com", client.apiURL)
}

func TestUser_Struct(t *testing.T) {
	user := User{
		Login:     "octocat",
		Name:      "The Octocat",
		AvatarURL: "https://github.com/images/error/octocat_happy.gif",
	}

	require.Equal(t, "octocat", user.Login)
	require.Equal(t, "The Octocat", user.Name)
	require.Equal(t, "https://github.com/images/error/octocat_happy.gif", user.AvatarURL)
}

func TestUser_JSONSerialization(t *testing.T) {
	user := User{
		Login:     "octocat",
		Name:      "The Octocat",
		AvatarURL: "https://github.com/images/error/octocat_happy.gif",
	}

	data, err := json.Marshal(user)
	require.NoError(t, err)

	var decoded User
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	require.Equal(t, user.Login, decoded.Login)
	require.Equal(t, user.Name, decoded.Name)
	require.Equal(t, user.AvatarURL, decoded.AvatarURL)
}

// ============================================================================
// CreatePullRequest Tests
// ============================================================================

func TestClient_CreatePullRequest_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/repos/owner/repo/pulls", r.URL.Path)
		require.Equal(t, "POST", r.Method)
		require.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		require.Equal(t, "application/vnd.github+json", r.Header.Get("Accept"))

		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)

		var pr CreatePullRequestRequest
		require.NoError(t, json.Unmarshal(body, &pr))
		require.Equal(t, "Add auth flow", pr.Title)
		require.Equal(t, "Description here", pr.Body)
		require.Equal(t, "feature/auth", pr.Head)
		require.Equal(t, "main", pr.Base)
		require.True(t, pr.Draft)

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(CreatePullRequestResponse{
			Number:  42,
			HTMLURL: "https://github.com/owner/repo/pull/42",
			State:   "open",
			Title:   "Add auth flow",
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test-token")

	result, err := client.CreatePullRequest(context.Background(), "owner", "repo", CreatePullRequestRequest{
		Title: "Add auth flow",
		Body:  "Description here",
		Head:  "feature/auth",
		Base:  "main",
		Draft: true,
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 42, result.Number)
	require.Equal(t, "https://github.com/owner/repo/pull/42", result.HTMLURL)
	require.Equal(t, "open", result.State)
	require.Equal(t, "Add auth flow", result.Title)
}

func TestClient_CreatePullRequest_NotAuthenticated(t *testing.T) {
	client := NewClient("", "")
	// No token set

	_, err := client.CreatePullRequest(context.Background(), "owner", "repo", CreatePullRequestRequest{
		Title: "Test",
		Head:  "branch",
		Base:  "main",
	})

	require.Error(t, err)
	require.Contains(t, err.Error(), "not authenticated")
}

func TestClient_CreatePullRequest_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"A pull request already exists"}]}`))
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test-token")

	_, err := client.CreatePullRequest(context.Background(), "owner", "repo", CreatePullRequestRequest{
		Title: "Test",
		Head:  "branch",
		Base:  "main",
	})

	require.Error(t, err)
	require.Contains(t, err.Error(), "422")
	require.Contains(t, err.Error(), "already exists")
}

func TestClient_CreatePullRequest_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(CreatePullRequestResponse{Number: 1})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test-token")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.CreatePullRequest(ctx, "owner", "repo", CreatePullRequestRequest{
		Title: "Test",
		Head:  "branch",
		Base:  "main",
	})

	require.Error(t, err)
}

func TestClient_CreatePullRequest_NonDraft(t *testing.T) {
	var receivedDraft bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var pr CreatePullRequestRequest
		json.Unmarshal(body, &pr)
		receivedDraft = pr.Draft

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(CreatePullRequestResponse{Number: 1, State: "open"})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL
	client.SetToken("test-token")

	_, err := client.CreatePullRequest(context.Background(), "owner", "repo", CreatePullRequestRequest{
		Title: "Test",
		Head:  "branch",
		Base:  "main",
		Draft: false,
	})

	require.NoError(t, err)
	require.False(t, receivedDraft)
}

func TestClient_GetUser_Success_FullFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/user", r.URL.Path)
		require.Equal(t, "Bearer test_token", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Accept"))

		json.NewEncoder(w).Encode(map[string]interface{}{
			"login":      "octocat",
			"name":       "The Octocat",
			"avatar_url": "https://github.com/images/error/octocat_happy.gif",
		})
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL

	user, err := client.GetUser(context.Background(), "test_token")
	require.NoError(t, err)
	require.NotNil(t, user)
	require.Equal(t, "octocat", user.Login)
	require.Equal(t, "The Octocat", user.Name)
	require.Equal(t, "https://github.com/images/error/octocat_happy.gif", user.AvatarURL)
}
