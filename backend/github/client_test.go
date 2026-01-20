// backend/github/client_test.go
package github

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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

	token, err := client.ExchangeCode(context.Background(), "test_code")
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
