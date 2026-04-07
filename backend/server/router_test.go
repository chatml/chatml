package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chatml/chatml-backend/agent"
	gitpkg "github.com/chatml/chatml-core/git"
	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/linear"
	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/require"
)

// setupTestRouter creates a router with minimal dependencies for testing
func setupTestRouter(t *testing.T) (http.Handler, *store.SQLiteStore) {
	t.Helper()

	// Create in-memory store
	s, err := store.NewSQLiteStoreInMemory()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })

	// Create minimal dependencies
	hub := NewHub()
	go hub.Run()

	// Create worktree manager for agent manager
	wm := gitpkg.NewWorktreeManager()
	agentMgr := agent.NewManager(context.Background(), s, wm, 9876)
	ghClient := github.NewClient("", "")
	prCache := github.NewPRCache(5*time.Minute, 10*time.Minute, 100)
	t.Cleanup(func() { prCache.Close() })

	linearClient := linear.NewClient("")

	// Create router without branch watcher, pr watcher, stats cache, or diff cache
	router, _, cleanup := NewRouter(context.Background(), s, hub, agentMgr, ghClient, linearClient, nil, nil, prCache, nil, nil, nil, nil, nil, nil, nil)
	t.Cleanup(cleanup)

	return router, s
}

// ============================================================================
// Health Endpoint Tests
// ============================================================================

func TestNewRouter_HealthEndpoint(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	require.Equal(t, "ok", response["status"])
}

// ============================================================================
// Auth Route Tests
// ============================================================================

func TestNewRouter_AuthRoutes(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Test auth status endpoint
	t.Run("GET /api/auth/status", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/status", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		// Should return OK (unauthenticated state)
		require.Equal(t, http.StatusOK, w.Code)
	})

	// Test logout endpoint (should work even when not authenticated)
	t.Run("POST /api/auth/logout", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/auth/logout", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusOK, w.Code)
	})
}

// ============================================================================
// Repository Route Tests
// ============================================================================

func TestNewRouter_RepoRoutes(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Test list repos
	t.Run("GET /api/repos", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/repos", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusOK, w.Code)
	})

	// Test get non-existent repo
	t.Run("GET /api/repos/{id} - not found", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/repos/nonexistent", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusNotFound, w.Code)
	})

	// Test delete non-existent repo (returns 204 even if not found - idempotent delete)
	t.Run("DELETE /api/repos/{id} - idempotent", func(t *testing.T) {
		req := httptest.NewRequest("DELETE", "/api/repos/nonexistent", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		// Delete is idempotent - returns success even if already deleted/not found
		require.Equal(t, http.StatusNoContent, w.Code)
	})
}

// ============================================================================
// WebSocket Route Tests
// ============================================================================

func TestNewRouter_WebSocketEndpoint(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Test that the WebSocket endpoint exists (will fail upgrade without proper headers)
	req := httptest.NewRequest("GET", "/ws", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Without proper WebSocket headers, this should return an error
	// but the route should exist (not 404)
	require.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestNewRouter_WebSocketStatsEndpoint(t *testing.T) {
	router, _ := setupTestRouter(t)

	req := httptest.NewRequest("GET", "/ws/stats", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	// Should return JSON stats
	var stats map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &stats)
	require.NoError(t, err)
}

// ============================================================================
// Conversation Route Tests
// ============================================================================

func TestNewRouter_ConversationRoutes(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Test get non-existent conversation
	t.Run("GET /api/conversations/{convId} - not found", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/conversations/nonexistent", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusNotFound, w.Code)
	})
}

// ============================================================================
// Agent Route Tests
// ============================================================================

func TestNewRouter_AgentRoutes(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Test get non-existent agent
	t.Run("GET /api/agents/{id} - not found", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/agents/nonexistent", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusNotFound, w.Code)
	})

	// Test stop non-existent agent (returns 204 - idempotent stop)
	t.Run("POST /api/agents/{id}/stop - idempotent", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/agents/nonexistent/stop", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		// Stop is idempotent - returns success even if agent not running
		require.Equal(t, http.StatusNoContent, w.Code)
	})
}

// ============================================================================
// CORS Tests
// ============================================================================

func TestNewRouter_CORSHeaders(t *testing.T) {
	router, _ := setupTestRouter(t)

	// Test preflight request
	t.Run("OPTIONS request with allowed origin", func(t *testing.T) {
		req := httptest.NewRequest("OPTIONS", "/api/repos", nil)
		req.Header.Set("Origin", "tauri://localhost")
		req.Header.Set("Access-Control-Request-Method", "GET")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		// CORS preflight should return 204 (No Content) or 200
		require.True(t, w.Code == http.StatusOK || w.Code == http.StatusNoContent,
			"expected 200 or 204, got %d", w.Code)
		require.Contains(t, w.Header().Get("Access-Control-Allow-Origin"), "tauri://localhost")
	})

	t.Run("GET request with allowed origin", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/repos", nil)
		req.Header.Set("Origin", "https://tauri.localhost")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusOK, w.Code)
		require.Contains(t, w.Header().Get("Access-Control-Allow-Origin"), "https://tauri.localhost")
	})
}

// ============================================================================
// Method Tests
// ============================================================================

func TestNewRouter_AllowedMethods(t *testing.T) {
	router, _ := setupTestRouter(t)

	testCases := []struct {
		method string
		path   string
		expect int // expected status (not 404 = route exists, not 405 = method allowed)
	}{
		{"GET", "/api/repos", http.StatusOK},
		{"POST", "/api/repos", http.StatusBadRequest}, // Bad request because no body, but route exists
		{"GET", "/health", http.StatusOK},
	}

	for _, tc := range testCases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			require.NotEqual(t, http.StatusNotFound, w.Code, "route should exist")
			require.NotEqual(t, http.StatusMethodNotAllowed, w.Code, "method should be allowed")
		})
	}
}

// ============================================================================
// Session Route Tests
// ============================================================================

func TestNewRouter_SessionRoutes(t *testing.T) {
	router, s := setupTestRouter(t)

	// First, create a test repo
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)

	// Test list sessions (empty)
	t.Run("GET /api/repos/{id}/sessions - empty list", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/repos/"+repo.ID+"/sessions", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusOK, w.Code)

		var sessions []interface{}
		err := json.Unmarshal(w.Body.Bytes(), &sessions)
		require.NoError(t, err)
		require.Empty(t, sessions)
	})

	// Test get non-existent session
	t.Run("GET /api/repos/{id}/sessions/{sessionId} - not found", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/repos/"+repo.ID+"/sessions/nonexistent", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusNotFound, w.Code)
	})
}

// ============================================================================
// Tab Route Tests
// ============================================================================

func TestNewRouter_TabRoutes(t *testing.T) {
	router, s := setupTestRouter(t)

	// First, create a test repo
	repoPath := createTestGitRepo(t)
	repo := createTestRepo(t, s, "repo-1", repoPath)

	// Test list tabs (empty)
	t.Run("GET /api/repos/{id}/tabs - empty list", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/repos/"+repo.ID+"/tabs", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusOK, w.Code)
	})
}
