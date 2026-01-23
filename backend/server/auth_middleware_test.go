package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// testHandler is a simple handler that returns 200 OK with "success" body
func testHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})
}

func TestTokenAuthMiddleware_NoTokenConfigured(t *testing.T) {
	// When CHATML_AUTH_TOKEN is not set, all requests should be allowed
	os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	tests := []struct {
		name   string
		auth   string
		path   string
		expect int
	}{
		{"no auth header", "", "/api/repos", http.StatusOK},
		{"empty auth header", "Bearer ", "/api/repos", http.StatusOK},
		{"random token", "Bearer random123", "/api/repos", http.StatusOK},
		{"health endpoint", "", "/health", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.path, nil)
			if tt.auth != "" {
				req.Header.Set("Authorization", tt.auth)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.expect {
				t.Errorf("Expected status %d, got %d", tt.expect, w.Code)
			}
		})
	}
}

func TestTokenAuthMiddleware_TokenConfigured_ValidToken(t *testing.T) {
	// Set a known token for testing
	expectedToken := "test-token-abc123"
	os.Setenv("CHATML_AUTH_TOKEN", expectedToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	req := httptest.NewRequest("GET", "/api/repos", nil)
	req.Header.Set("Authorization", "Bearer "+expectedToken)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "success" {
		t.Errorf("Expected body 'success', got '%s'", w.Body.String())
	}
}

func TestTokenAuthMiddleware_TokenConfigured_NoAuthHeader(t *testing.T) {
	os.Setenv("CHATML_AUTH_TOKEN", "test-token-abc123")
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	req := httptest.NewRequest("GET", "/api/repos", nil)
	// No Authorization header
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestTokenAuthMiddleware_TokenConfigured_InvalidToken(t *testing.T) {
	os.Setenv("CHATML_AUTH_TOKEN", "correct-token")
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	req := httptest.NewRequest("GET", "/api/repos", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestTokenAuthMiddleware_TokenConfigured_EmptyBearerToken(t *testing.T) {
	os.Setenv("CHATML_AUTH_TOKEN", "test-token")
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	req := httptest.NewRequest("GET", "/api/repos", nil)
	req.Header.Set("Authorization", "Bearer ")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

func TestTokenAuthMiddleware_TokenConfigured_WrongAuthScheme(t *testing.T) {
	os.Setenv("CHATML_AUTH_TOKEN", "test-token")
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	tests := []struct {
		name string
		auth string
	}{
		{"Basic auth", "Basic dXNlcjpwYXNz"},
		{"No scheme", "test-token"},
		{"Lowercase bearer", "bearer test-token"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/repos", nil)
			req.Header.Set("Authorization", tt.auth)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Errorf("Expected status 401, got %d", w.Code)
			}
		})
	}
}

func TestTokenAuthMiddleware_HealthEndpointAlwaysAllowed(t *testing.T) {
	os.Setenv("CHATML_AUTH_TOKEN", "test-token")
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	tests := []struct {
		name string
		auth string
	}{
		{"no auth", ""},
		{"wrong token", "Bearer wrong"},
		{"correct token", "Bearer test-token"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/health", nil)
			if tt.auth != "" {
				req.Header.Set("Authorization", tt.auth)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200 for /health, got %d", w.Code)
			}
		})
	}
}

func TestTokenAuthMiddleware_DifferentHTTPMethods(t *testing.T) {
	expectedToken := "test-token"
	os.Setenv("CHATML_AUTH_TOKEN", expectedToken)
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	methods := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"}

	for _, method := range methods {
		t.Run(method+" with valid token", func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/repos", nil)
			req.Header.Set("Authorization", "Bearer "+expectedToken)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status 200 for %s, got %d", method, w.Code)
			}
		})

		t.Run(method+" without token", func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/repos", nil)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Errorf("Expected status 401 for %s, got %d", method, w.Code)
			}
		})
	}
}

func TestTokenAuthMiddleware_TimingAttackResistance(t *testing.T) {
	// This test verifies we're using constant-time comparison
	// We can't truly test timing, but we can verify behavior is consistent
	os.Setenv("CHATML_AUTH_TOKEN", "correct-token-12345")
	defer os.Unsetenv("CHATML_AUTH_TOKEN")

	handler := TokenAuthMiddleware(testHandler())

	// Test tokens of different lengths - all should fail equally
	tokens := []string{
		"c",
		"co",
		"cor",
		"corr",
		"corre",
		"correct-token-1234", // one char short
		"correct-token-12345", // correct
		"correct-token-123456", // one char long
		"wrong-token-12345",
		"",
	}

	for _, token := range tokens {
		t.Run("token: "+token, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/repos", nil)
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if token == "correct-token-12345" {
				if w.Code != http.StatusOK {
					t.Errorf("Expected status 200 for correct token, got %d", w.Code)
				}
			} else {
				if w.Code != http.StatusUnauthorized {
					t.Errorf("Expected status 401 for token '%s', got %d", token, w.Code)
				}
			}
		})
	}
}
