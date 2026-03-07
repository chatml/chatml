package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// GetDotMcpTrust
// ============================================================================

func TestGetDotMcpTrust_Unknown(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-trust", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "unknown", response["status"])
}

func TestGetDotMcpTrust_Trusted(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "dot-mcp-trust:ws-1", "trusted"))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-trust", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "trusted", response["status"])
}

func TestGetDotMcpTrust_Denied(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "dot-mcp-trust:ws-1", "denied"))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-trust", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "denied", response["status"])
}

func TestGetDotMcpTrust_InvalidValueReturnsUnknown(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Store an invalid value — should be treated as unknown
	require.NoError(t, s.SetSetting(ctx, "dot-mcp-trust:ws-1", "garbage"))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-trust", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "unknown", response["status"])
}

func TestGetDotMcpTrust_WorkspaceIsolation(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "dot-mcp-trust:ws-1", "trusted"))
	// ws-2 has no trust setting

	// ws-1 should be trusted
	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-trust", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()
	h.GetDotMcpTrust(w, req)
	var resp1 map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp1))
	assert.Equal(t, "trusted", resp1["status"])

	// ws-2 should be unknown
	req2 := httptest.NewRequest("GET", "/api/repos/ws-2/dot-mcp-trust", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-2"})
	w2 := httptest.NewRecorder()
	h.GetDotMcpTrust(w2, req2)
	var resp2 map[string]string
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp2))
	assert.Equal(t, "unknown", resp2["status"])
}

// ============================================================================
// SetDotMcpTrust
// ============================================================================

func TestSetDotMcpTrust_Trusted(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	body, _ := json.Marshal(map[string]string{"status": "trusted"})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/dot-mcp-trust", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "trusted", response["status"])

	// Verify persisted
	val, found, err := s.GetSetting(ctx, "dot-mcp-trust:ws-1")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "trusted", val)
}

func TestSetDotMcpTrust_Denied(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	body, _ := json.Marshal(map[string]string{"status": "denied"})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/dot-mcp-trust", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	val, found, err := s.GetSetting(ctx, "dot-mcp-trust:ws-1")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "denied", val)
}

func TestSetDotMcpTrust_InvalidStatus(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(map[string]string{"status": "maybe"})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/dot-mcp-trust", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetDotMcpTrust_EmptyStatus(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(map[string]string{"status": ""})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/dot-mcp-trust", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetDotMcpTrust_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/dot-mcp-trust", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetDotMcpTrust_OverwriteExisting(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Start as trusted
	require.NoError(t, s.SetSetting(ctx, "dot-mcp-trust:ws-1", "trusted"))

	// Revoke to denied
	body, _ := json.Marshal(map[string]string{"status": "denied"})
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/dot-mcp-trust", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetDotMcpTrust(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	val, _, err := s.GetSetting(ctx, "dot-mcp-trust:ws-1")
	require.NoError(t, err)
	assert.Equal(t, "denied", val)
}

// ============================================================================
// GetDotMcpInfo
// ============================================================================

func TestGetDotMcpInfo_NoFile(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoDir := t.TempDir()
	createTestRepo(t, s, "ws-1", repoDir)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, false, response["exists"])
	servers := response["servers"].([]interface{})
	assert.Empty(t, servers)
}

func TestGetDotMcpInfo_WithStdioServers(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoDir := t.TempDir()
	createTestRepo(t, s, "ws-1", repoDir)

	mcpConfig := map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"test-server": map[string]interface{}{
				"type":    "stdio",
				"command": "npx",
			},
		},
	}
	data, _ := json.Marshal(mcpConfig)
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, ".mcp.json"), data, 0644))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, true, response["exists"])

	servers := response["servers"].([]interface{})
	require.Len(t, servers, 1)

	server := servers[0].(map[string]interface{})
	assert.Equal(t, "test-server", server["name"])
	assert.Equal(t, "stdio", server["type"])
	assert.Equal(t, "npx", server["command"])
}

func TestGetDotMcpInfo_MultipleServers(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoDir := t.TempDir()
	createTestRepo(t, s, "ws-1", repoDir)

	mcpConfig := map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"stdio-server": map[string]interface{}{
				"type":    "stdio",
				"command": "echo",
			},
			"sse-server": map[string]interface{}{
				"type": "sse",
				"url":  "http://localhost:3000",
			},
		},
	}
	data, _ := json.Marshal(mcpConfig)
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, ".mcp.json"), data, 0644))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, true, response["exists"])

	servers := response["servers"].([]interface{})
	assert.Len(t, servers, 2)
}

func TestGetDotMcpInfo_DefaultsToStdioType(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoDir := t.TempDir()
	createTestRepo(t, s, "ws-1", repoDir)

	// Server config without explicit type — should default to "stdio"
	mcpConfig := map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"implicit-stdio": map[string]interface{}{
				"command": "echo",
			},
		},
	}
	data, _ := json.Marshal(mcpConfig)
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, ".mcp.json"), data, 0644))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	servers := response["servers"].([]interface{})
	require.Len(t, servers, 1)
	server := servers[0].(map[string]interface{})
	assert.Equal(t, "stdio", server["type"])
}

func TestGetDotMcpInfo_InvalidJSON(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoDir := t.TempDir()
	createTestRepo(t, s, "ws-1", repoDir)

	require.NoError(t, os.WriteFile(filepath.Join(repoDir, ".mcp.json"), []byte("not json"), 0644))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, true, response["exists"])
	servers := response["servers"].([]interface{})
	assert.Empty(t, servers)
}

func TestGetDotMcpInfo_RepoNotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/nonexistent/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "nonexistent"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetDotMcpInfo_EmptyMcpServers(t *testing.T) {
	h, s := setupTestHandlers(t)

	repoDir := t.TempDir()
	createTestRepo(t, s, "ws-1", repoDir)

	mcpConfig := map[string]interface{}{
		"mcpServers": map[string]interface{}{},
	}
	data, _ := json.Marshal(mcpConfig)
	require.NoError(t, os.WriteFile(filepath.Join(repoDir, ".mcp.json"), data, 0644))

	req := httptest.NewRequest("GET", "/api/repos/ws-1/dot-mcp-info", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetDotMcpInfo(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, true, response["exists"])
	servers := response["servers"].([]interface{})
	assert.Empty(t, servers)
}
