// backend/github/client_test.go
package github

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

	_, err := client.ExchangeCode(context.Background(), "invalid_code")
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

	_, err := client.ExchangeCode(context.Background(), "test_code")
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

	_, err := client.ExchangeCode(context.Background(), "test_code_123")
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
