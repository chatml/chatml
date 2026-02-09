package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// GetMcpServers Tests
// ============================================================================

func TestGetMcpServers_Empty(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	req := httptest.NewRequest("GET", "/api/repos/ws-1/mcp-servers", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Empty(t, result)
}

func TestGetMcpServers_AfterSet(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "test-server", Type: "stdio", Command: "echo", Args: []string{"hello"}, Enabled: true},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	// Set servers
	setReq := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	setReq.Header.Set("Content-Type", "application/json")
	setReq = withChiContext(setReq, map[string]string{"id": "ws-1"})
	setW := httptest.NewRecorder()
	h.SetMcpServers(setW, setReq)
	assert.Equal(t, http.StatusOK, setW.Code)

	// Get servers
	getReq := httptest.NewRequest("GET", "/api/repos/ws-1/mcp-servers", nil)
	getReq = withChiContext(getReq, map[string]string{"id": "ws-1"})
	getW := httptest.NewRecorder()
	h.GetMcpServers(getW, getReq)

	assert.Equal(t, http.StatusOK, getW.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(getW.Body.Bytes(), &result)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "test-server", result[0].Name)
	assert.Equal(t, "stdio", result[0].Type)
	assert.Equal(t, "echo", result[0].Command)
	assert.Equal(t, []string{"hello"}, result[0].Args)
	assert.True(t, result[0].Enabled)
}

// ============================================================================
// SetMcpServers Tests
// ============================================================================

func TestSetMcpServers_StdioServer(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{
			Name:    "my-stdio",
			Type:    "stdio",
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-filesystem"},
			Env:     map[string]string{"NODE_ENV": "production"},
			Enabled: true,
		},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "my-stdio", result[0].Name)
	assert.Equal(t, "stdio", result[0].Type)
	assert.Equal(t, "npx", result[0].Command)
	assert.Equal(t, []string{"-y", "@modelcontextprotocol/server-filesystem"}, result[0].Args)
	assert.Equal(t, map[string]string{"NODE_ENV": "production"}, result[0].Env)
	assert.True(t, result[0].Enabled)
}

func TestSetMcpServers_SseServer(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{
			Name:    "my-sse",
			Type:    "sse",
			URL:     "https://mcp.example.com/events",
			Headers: map[string]string{"Authorization": "Bearer tok123"},
			Enabled: true,
		},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "my-sse", result[0].Name)
	assert.Equal(t, "sse", result[0].Type)
	assert.Equal(t, "https://mcp.example.com/events", result[0].URL)
	assert.Equal(t, map[string]string{"Authorization": "Bearer tok123"}, result[0].Headers)
}

func TestSetMcpServers_HttpServer(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{
			Name:    "my-http",
			Type:    "http",
			URL:     "https://mcp.example.com/api",
			Headers: map[string]string{"X-Api-Key": "abc"},
			Enabled: true,
		},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "my-http", result[0].Name)
	assert.Equal(t, "http", result[0].Type)
	assert.Equal(t, "https://mcp.example.com/api", result[0].URL)
}

func TestSetMcpServers_MultipleServers(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "stdio-srv", Type: "stdio", Command: "echo", Enabled: true},
		{Name: "sse-srv", Type: "sse", URL: "http://localhost:3000", Enabled: true},
		{Name: "http-srv", Type: "http", URL: "http://localhost:4000", Enabled: false},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Len(t, result, 3)
	assert.Equal(t, "stdio-srv", result[0].Name)
	assert.Equal(t, "sse-srv", result[1].Name)
	assert.Equal(t, "http-srv", result[2].Name)
	assert.False(t, result[2].Enabled)
}

func TestSetMcpServers_EmptyArray(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	body, err := json.Marshal([]models.McpServerConfig{})
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Empty(t, result)
}

func TestSetMcpServers_InvalidJSON(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", strings.NewReader("{invalid json}"))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// ============================================================================
// Validation Tests
// ============================================================================

func TestSetMcpServers_MissingName(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "", Type: "stdio", Command: "echo", Enabled: true},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "missing a name")
}

func TestSetMcpServers_StdioMissingCommand(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "bad-stdio", Type: "stdio", Command: "", Enabled: true},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "missing a command")
}

func TestSetMcpServers_SseMissingURL(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "bad-sse", Type: "sse", URL: "", Enabled: true},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "missing a URL")
}

func TestSetMcpServers_HttpMissingURL(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "bad-http", Type: "http", URL: "", Enabled: true},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "missing a URL")
}

func TestSetMcpServers_InvalidType(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "bad-type", Type: "grpc", Enabled: true},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var apiErr APIError
	err = json.Unmarshal(w.Body.Bytes(), &apiErr)
	require.NoError(t, err)
	assert.Equal(t, ErrCodeValidation, apiErr.Code)
	assert.Contains(t, apiErr.Error, "invalid type")
}

func TestSetMcpServers_Overwrite(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	// First save
	first := []models.McpServerConfig{
		{Name: "original", Type: "stdio", Command: "echo", Enabled: true},
	}
	body1, _ := json.Marshal(first)
	req1 := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1 = withChiContext(req1, map[string]string{"id": "ws-1"})
	w1 := httptest.NewRecorder()
	h.SetMcpServers(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Overwrite with different servers
	second := []models.McpServerConfig{
		{Name: "replacement", Type: "sse", URL: "http://localhost", Enabled: true},
	}
	body2, _ := json.Marshal(second)
	req2 := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()
	h.SetMcpServers(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	// GET should return only the new servers
	getReq := httptest.NewRequest("GET", "/api/repos/ws-1/mcp-servers", nil)
	getReq = withChiContext(getReq, map[string]string{"id": "ws-1"})
	getW := httptest.NewRecorder()
	h.GetMcpServers(getW, getReq)

	var result []models.McpServerConfig
	err := json.Unmarshal(getW.Body.Bytes(), &result)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "replacement", result[0].Name)
}

func TestSetMcpServers_WithDisabledServer(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	servers := []models.McpServerConfig{
		{Name: "disabled-srv", Type: "stdio", Command: "echo", Enabled: false},
	}
	body, err := json.Marshal(servers)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/repos/ws-1/mcp-servers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetMcpServers(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.McpServerConfig
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.False(t, result[0].Enabled)
}

func TestGetMcpServers_DifferentWorkspaces(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	// Save to workspace A
	srvA := []models.McpServerConfig{
		{Name: "server-a", Type: "stdio", Command: "a", Enabled: true},
	}
	bodyA, _ := json.Marshal(srvA)
	reqA := httptest.NewRequest("PUT", "/api/repos/ws-a/mcp-servers", bytes.NewReader(bodyA))
	reqA.Header.Set("Content-Type", "application/json")
	reqA = withChiContext(reqA, map[string]string{"id": "ws-a"})
	wA := httptest.NewRecorder()
	h.SetMcpServers(wA, reqA)
	assert.Equal(t, http.StatusOK, wA.Code)

	// Save to workspace B
	srvB := []models.McpServerConfig{
		{Name: "server-b", Type: "sse", URL: "http://b", Enabled: true},
	}
	bodyB, _ := json.Marshal(srvB)
	reqB := httptest.NewRequest("PUT", "/api/repos/ws-b/mcp-servers", bytes.NewReader(bodyB))
	reqB.Header.Set("Content-Type", "application/json")
	reqB = withChiContext(reqB, map[string]string{"id": "ws-b"})
	wB := httptest.NewRecorder()
	h.SetMcpServers(wB, reqB)
	assert.Equal(t, http.StatusOK, wB.Code)

	// GET workspace A should only have server-a
	getA := httptest.NewRequest("GET", "/api/repos/ws-a/mcp-servers", nil)
	getA = withChiContext(getA, map[string]string{"id": "ws-a"})
	gWA := httptest.NewRecorder()
	h.GetMcpServers(gWA, getA)

	var resultA []models.McpServerConfig
	err := json.Unmarshal(gWA.Body.Bytes(), &resultA)
	require.NoError(t, err)
	require.Len(t, resultA, 1)
	assert.Equal(t, "server-a", resultA[0].Name)

	// GET workspace B should only have server-b
	getB := httptest.NewRequest("GET", "/api/repos/ws-b/mcp-servers", nil)
	getB = withChiContext(getB, map[string]string{"id": "ws-b"})
	gWB := httptest.NewRecorder()
	h.GetMcpServers(gWB, getB)

	var resultB []models.McpServerConfig
	err = json.Unmarshal(gWB.Body.Bytes(), &resultB)
	require.NoError(t, err)
	require.Len(t, resultB, 1)
	assert.Equal(t, "server-b", resultB[0].Name)
}
