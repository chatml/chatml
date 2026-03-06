package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chatml/chatml-backend/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetWorkspacesBaseDir_Default(t *testing.T) {
	h, s := setupTestHandlers(t)

	// Clear the workspaces-base-dir setting so the handler falls back to the default path
	require.NoError(t, s.DeleteSetting(context.Background(), "workspaces-base-dir"))

	req := httptest.NewRequest("GET", "/api/settings/workspaces-base-dir", nil)
	w := httptest.NewRecorder()

	h.GetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.NotEmpty(t, response["path"], "default path should be non-empty")
	assert.Contains(t, response["path"], "workspaces", "default path should contain 'workspaces'")
}

func TestGetWorkspacesBaseDir_CustomPath(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Pre-configure a custom path
	require.NoError(t, s.SetSetting(ctx, "workspaces-base-dir", "/custom/workspaces"))

	req := httptest.NewRequest("GET", "/api/settings/workspaces-base-dir", nil)
	w := httptest.NewRecorder()

	h.GetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "/custom/workspaces", response["path"])
}

func TestSetWorkspacesBaseDir_ValidPath(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Use a real temp directory
	validDir := t.TempDir()

	body, _ := json.Marshal(map[string]string{"path": validDir})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, validDir, response["path"])

	// Verify persisted in store
	val, found, err := s.GetSetting(ctx, "workspaces-base-dir")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, validDir, val)
}

func TestSetWorkspacesBaseDir_ResetToDefault(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// First set a custom path
	require.NoError(t, s.SetSetting(ctx, "workspaces-base-dir", "/custom/path"))

	// Reset by sending empty path
	body, _ := json.Marshal(map[string]string{"path": ""})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	// Should return default path (contains "workspaces")
	assert.Contains(t, response["path"], "workspaces")

	// Verify setting was deleted from store
	_, found, err := s.GetSetting(ctx, "workspaces-base-dir")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestSetWorkspacesBaseDir_InvalidJSON(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSetWorkspacesBaseDir_PathNotExists(t *testing.T) {
	h, _ := setupTestHandlers(t)

	body, _ := json.Marshal(map[string]string{"path": "/nonexistent/absolutely/fake"})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path does not exist")
}

func TestSetWorkspacesBaseDir_PathIsFile(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Create a temp file (not a directory)
	tmpFile := filepath.Join(t.TempDir(), "not-a-dir.txt")
	require.NoError(t, os.WriteFile(tmpFile, []byte("hello"), 0644))

	body, _ := json.Marshal(map[string]string{"path": tmpFile})
	req := httptest.NewRequest("PUT", "/api/settings/workspaces-base-dir", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetWorkspacesBaseDir(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "path is not a directory")
}
func TestGetReviewPrompts_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w := httptest.NewRecorder()

	h.GetReviewPrompts(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestSetReviewPrompts_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	prompts := map[string]any{"prompts": map[string]string{"quick": "Also check accessibility"}}
	body, _ := json.Marshal(prompts)
	req := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetReviewPrompts(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify it was saved
	req2 := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w2 := httptest.NewRecorder()

	h.GetReviewPrompts(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	p := resp["prompts"].(map[string]any)
	assert.Equal(t, "Also check accessibility", p["quick"])
}

func TestSetReviewPrompts_EmptyDeletes(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "review-prompts", `{"quick":"old"}`))

	body, _ := json.Marshal(map[string]any{"prompts": map[string]string{}})
	req := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetReviewPrompts(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify deleted
	req2 := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w2 := httptest.NewRecorder()
	h.GetReviewPrompts(w2, req2)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestSetReviewPrompts_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader([]byte("invalid")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetReviewPrompts(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetWorkspaceReviewPrompts_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/settings/review-prompts", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetWorkspaceReviewPrompts(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestSetWorkspaceReviewPrompts_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	prompts := map[string]any{"prompts": map[string]string{"security": "Check OWASP top 10"}}
	body, _ := json.Marshal(prompts)
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/review-prompts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetWorkspaceReviewPrompts(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify saved
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/review-prompts", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()

	h.GetWorkspaceReviewPrompts(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	p := resp["prompts"].(map[string]any)
	assert.Equal(t, "Check OWASP top 10", p["security"])
}

func TestSetWorkspaceReviewPrompts_IsolatedPerWorkspace(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set for ws-1
	body1, _ := json.Marshal(map[string]any{"prompts": map[string]string{"quick": "ws1 instructions"}})
	req1 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/review-prompts", bytes.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1 = withChiContext(req1, map[string]string{"id": "ws-1"})
	w1 := httptest.NewRecorder()
	h.SetWorkspaceReviewPrompts(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// ws-2 should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-2/settings/review-prompts", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-2"})
	w2 := httptest.NewRecorder()
	h.GetWorkspaceReviewPrompts(w2, req2)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["prompts"].(map[string]any))
}

func TestReviewPrompts_GlobalAndWorkspaceIsolated(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set a global prompt
	globalBody, _ := json.Marshal(map[string]any{"prompts": map[string]string{"quick": "global instructions"}})
	req1 := httptest.NewRequest("PUT", "/api/settings/review-prompts", bytes.NewReader(globalBody))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	h.SetReviewPrompts(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Workspace endpoint should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/review-prompts", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()
	h.GetWorkspaceReviewPrompts(w2, req2)

	var wsResp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &wsResp))
	assert.Equal(t, map[string]any{}, wsResp["prompts"].(map[string]any))

	// Set a workspace prompt
	wsBody, _ := json.Marshal(map[string]any{"prompts": map[string]string{"security": "workspace instructions"}})
	req3 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/review-prompts", bytes.NewReader(wsBody))
	req3.Header.Set("Content-Type", "application/json")
	req3 = withChiContext(req3, map[string]string{"id": "ws-1"})
	w3 := httptest.NewRecorder()
	h.SetWorkspaceReviewPrompts(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)

	// Global should still only have "quick", not "security"
	req4 := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w4 := httptest.NewRecorder()
	h.GetReviewPrompts(w4, req4)

	var globalResp map[string]any
	require.NoError(t, json.Unmarshal(w4.Body.Bytes(), &globalResp))
	gp := globalResp["prompts"].(map[string]any)
	assert.Equal(t, "global instructions", gp["quick"])
	assert.Nil(t, gp["security"])
}

func TestGetReviewPrompts_CorruptedData(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Store invalid JSON
	require.NoError(t, s.SetSetting(ctx, "review-prompts", "not-json"))

	req := httptest.NewRequest("GET", "/api/settings/review-prompts", nil)
	w := httptest.NewRecorder()
	h.GetReviewPrompts(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetActionTemplates_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/settings/action-templates", nil)
	w := httptest.NewRecorder()

	h.GetActionTemplates(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["templates"].(map[string]any))
}

func TestSetActionTemplates_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	templates := map[string]any{"templates": map[string]string{"resolve-conflicts": "Custom conflict instructions"}}
	body, _ := json.Marshal(templates)
	req := httptest.NewRequest("PUT", "/api/settings/action-templates", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetActionTemplates(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify it was saved
	req2 := httptest.NewRequest("GET", "/api/settings/action-templates", nil)
	w2 := httptest.NewRecorder()

	h.GetActionTemplates(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	p := resp["templates"].(map[string]any)
	assert.Equal(t, "Custom conflict instructions", p["resolve-conflicts"])
}

func TestSetActionTemplates_EmptyDeletes(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	require.NoError(t, s.SetSetting(ctx, "action-templates", `{"resolve-conflicts":"old"}`))

	body, _ := json.Marshal(map[string]any{"templates": map[string]string{}})
	req := httptest.NewRequest("PUT", "/api/settings/action-templates", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetActionTemplates(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify deleted
	req2 := httptest.NewRequest("GET", "/api/settings/action-templates", nil)
	w2 := httptest.NewRecorder()
	h.GetActionTemplates(w2, req2)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["templates"].(map[string]any))
}

func TestSetActionTemplates_InvalidBody(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("PUT", "/api/settings/action-templates", bytes.NewReader([]byte("invalid")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetActionTemplates(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetWorkspaceActionTemplates_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/repos/ws-1/settings/action-templates", nil)
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.GetWorkspaceActionTemplates(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["templates"].(map[string]any))
}

func TestSetWorkspaceActionTemplates_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	templates := map[string]any{"templates": map[string]string{"sync-branch": "Use merge not rebase"}}
	body, _ := json.Marshal(templates)
	req := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/action-templates", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withChiContext(req, map[string]string{"id": "ws-1"})
	w := httptest.NewRecorder()

	h.SetWorkspaceActionTemplates(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Verify saved
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/action-templates", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()

	h.GetWorkspaceActionTemplates(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	p := resp["templates"].(map[string]any)
	assert.Equal(t, "Use merge not rebase", p["sync-branch"])
}

func TestSetWorkspaceActionTemplates_IsolatedPerWorkspace(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set for ws-1
	body1, _ := json.Marshal(map[string]any{"templates": map[string]string{"create-pr": "ws1 instructions"}})
	req1 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/action-templates", bytes.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1 = withChiContext(req1, map[string]string{"id": "ws-1"})
	w1 := httptest.NewRecorder()
	h.SetWorkspaceActionTemplates(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// ws-2 should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-2/settings/action-templates", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-2"})
	w2 := httptest.NewRecorder()
	h.GetWorkspaceActionTemplates(w2, req2)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	assert.Equal(t, map[string]any{}, resp["templates"].(map[string]any))
}

func TestActionTemplates_GlobalAndWorkspaceIsolated(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Set a global template
	globalBody, _ := json.Marshal(map[string]any{"templates": map[string]string{"merge-pr": "global merge instructions"}})
	req1 := httptest.NewRequest("PUT", "/api/settings/action-templates", bytes.NewReader(globalBody))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	h.SetActionTemplates(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Workspace endpoint should still be empty
	req2 := httptest.NewRequest("GET", "/api/repos/ws-1/settings/action-templates", nil)
	req2 = withChiContext(req2, map[string]string{"id": "ws-1"})
	w2 := httptest.NewRecorder()
	h.GetWorkspaceActionTemplates(w2, req2)

	var wsResp map[string]any
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &wsResp))
	assert.Equal(t, map[string]any{}, wsResp["templates"].(map[string]any))

	// Set a workspace template
	wsBody, _ := json.Marshal(map[string]any{"templates": map[string]string{"fix-issues": "workspace fix instructions"}})
	req3 := httptest.NewRequest("PUT", "/api/repos/ws-1/settings/action-templates", bytes.NewReader(wsBody))
	req3.Header.Set("Content-Type", "application/json")
	req3 = withChiContext(req3, map[string]string{"id": "ws-1"})
	w3 := httptest.NewRecorder()
	h.SetWorkspaceActionTemplates(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)

	// Global should still only have "merge-pr", not "fix-issues"
	req4 := httptest.NewRequest("GET", "/api/settings/action-templates", nil)
	w4 := httptest.NewRecorder()
	h.GetActionTemplates(w4, req4)

	var globalResp map[string]any
	require.NoError(t, json.Unmarshal(w4.Body.Bytes(), &globalResp))
	gp := globalResp["templates"].(map[string]any)
	assert.Equal(t, "global merge instructions", gp["merge-pr"])
	assert.Nil(t, gp["fix-issues"])
}

func TestGetActionTemplates_CorruptedData(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Store invalid JSON
	require.NoError(t, s.SetSetting(ctx, "action-templates", "not-json"))

	req := httptest.NewRequest("GET", "/api/settings/action-templates", nil)
	w := httptest.NewRecorder()
	h.GetActionTemplates(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetEnvSettings_Empty(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	req := httptest.NewRequest("GET", "/api/settings/env", nil)
	w := httptest.NewRecorder()

	h.GetEnvSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, "", result["envVars"])
}

func TestSetEnvSettings_Success(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	envVars := "API_KEY=test123\nDEBUG=true"
	reqBody := map[string]string{"envVars": envVars}
	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/settings/env", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetEnvSettings(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]string
	err = json.Unmarshal(w.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, envVars, result["envVars"])
}

func TestGetEnvSettings_AfterSet(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	envVars := "FOO=bar\nBAZ=qux"
	reqBody := map[string]string{"envVars": envVars}
	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	// Set env vars
	setReq := httptest.NewRequest("PUT", "/api/settings/env", bytes.NewReader(body))
	setReq.Header.Set("Content-Type", "application/json")
	setW := httptest.NewRecorder()
	h.SetEnvSettings(setW, setReq)
	assert.Equal(t, http.StatusOK, setW.Code)

	// Get env vars
	getReq := httptest.NewRequest("GET", "/api/settings/env", nil)
	getW := httptest.NewRecorder()
	h.GetEnvSettings(getW, getReq)

	assert.Equal(t, http.StatusOK, getW.Code)

	var result map[string]string
	err = json.Unmarshal(getW.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, envVars, result["envVars"])
}

func TestSetEnvSettings_InvalidJSON(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	req := httptest.NewRequest("PUT", "/api/settings/env", strings.NewReader("{invalid json}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SetEnvSettings(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
func TestParseEnvVars(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected map[string]string
	}{
		{
			name:  "basic KEY=VALUE parsing",
			input: "KEY1=value1\nKEY2=value2",
			expected: map[string]string{
				"KEY1": "value1",
				"KEY2": "value2",
			},
		},
		{
			name:  "strips export prefix",
			input: "export API_KEY=secret\nexport DEBUG=true",
			expected: map[string]string{
				"API_KEY": "secret",
				"DEBUG":   "true",
			},
		},
		{
			name:     "skips blank lines and comments",
			input:    "KEY1=value1\n\n# This is a comment\nKEY2=value2\n   \n# Another comment",
			expected: map[string]string{
				"KEY1": "value1",
				"KEY2": "value2",
			},
		},
		{
			name:  "handles values with = signs",
			input: "CONNECTION_STRING=host=localhost;user=admin;password=pass=123",
			expected: map[string]string{
				"CONNECTION_STRING": "host=localhost;user=admin;password=pass=123",
			},
		},
		{
			name:     "returns empty map for empty string",
			input:    "",
			expected: map[string]string{},
		},
		{
			name:     "returns empty map for only whitespace",
			input:    "   \n\n   \n",
			expected: map[string]string{},
		},
		{
			name:  "mixed format",
			input: "export KEY1=value1\nKEY2=value2\n\n# Comment\nexport KEY3=value=with=equals",
			expected: map[string]string{
				"KEY1": "value1",
				"KEY2": "value2",
				"KEY3": "value=with=equals",
			},
		},
		{
			name:  "strips double quotes from values",
			input: `MY_VAR="hello world"`,
			expected: map[string]string{
				"MY_VAR": "hello world",
			},
		},
		{
			name:  "strips single quotes from values",
			input: `MY_VAR='hello world'`,
			expected: map[string]string{
				"MY_VAR": "hello world",
			},
		},
		{
			name:  "preserves inner quotes",
			input: `MY_VAR="it's a test"`,
			expected: map[string]string{
				"MY_VAR": "it's a test",
			},
		},
		{
			name:  "does not strip mismatched quotes",
			input: `MY_VAR="hello'`,
			expected: map[string]string{
				"MY_VAR": `"hello'`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := store.ParseEnvVars(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// ---------------------------------------------------------------------------
// GetClaudeAuthStatus tests
// ---------------------------------------------------------------------------

func TestGetClaudeAuthStatus_NothingConfigured(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	// Ensure no env vars or credentials are present
	t.Setenv("ANTHROPIC_API_KEY", "")
	dir := t.TempDir()
	t.Setenv("HOME", dir) // Empty home — no Claude settings or credentials

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, false, result["configured"])
	assert.Equal(t, false, result["hasStoredKey"])
	assert.Equal(t, false, result["hasEnvKey"])
	assert.Equal(t, false, result["hasCliCredentials"])
	assert.Equal(t, false, result["hasBedrock"])
	assert.Equal(t, "", result["credentialSource"])
}

func TestGetClaudeAuthStatus_EnvKeyPresent(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, true, result["configured"])
	assert.Equal(t, true, result["hasEnvKey"])
	assert.Equal(t, false, result["hasBedrock"])
	assert.Equal(t, "env_var", result["credentialSource"])
}

func TestGetClaudeAuthStatus_BedrockViaClaudeSettings(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	t.Setenv("ANTHROPIC_API_KEY", "")

	// Create ~/.claude/settings.json with Bedrock config
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{
		"awsAuthRefresh": "aws sso login --profile core-dev",
		"env": {
			"CLAUDE_CODE_USE_BEDROCK": "true",
			"AWS_PROFILE": "core-dev",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "arn:aws:bedrock:us-east-1:123:application-inference-profile/abc"
		}
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, true, result["configured"])
	assert.Equal(t, true, result["hasBedrock"])
	assert.Equal(t, false, result["hasStoredKey"])
	assert.Equal(t, false, result["hasEnvKey"])
	assert.Equal(t, "aws_bedrock", result["credentialSource"])
}

func TestGetClaudeAuthStatus_BedrockViaChatMLEnvVars(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	t.Setenv("ANTHROPIC_API_KEY", "")
	dir := t.TempDir()
	t.Setenv("HOME", dir) // No Claude settings

	// Store env vars in ChatML settings
	ctx := context.Background()
	envVarsRaw := "CLAUDE_CODE_USE_BEDROCK=true\nANTHROPIC_DEFAULT_SONNET_MODEL=arn:aws:bedrock:us-east-1:123:model"
	require.NoError(t, st.SetSetting(ctx, "env-vars", envVarsRaw))

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, true, result["configured"])
	assert.Equal(t, true, result["hasBedrock"])
	assert.Equal(t, "aws_bedrock", result["credentialSource"])
}

func TestGetClaudeAuthStatus_BedrockPriorityHigherThanApiKey(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	// Both API key env var AND Bedrock are present
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")

	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	settings := `{"env": {"CLAUDE_CODE_USE_BEDROCK": "true"}}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, true, result["configured"])
	assert.Equal(t, true, result["hasEnvKey"])
	assert.Equal(t, true, result["hasBedrock"])
	// Bedrock takes priority in credentialSource (matches newAIClient order)
	assert.Equal(t, "aws_bedrock", result["credentialSource"])
}

func TestGetClaudeAuthStatus_BedrockFalseNotConfigured(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	t.Setenv("ANTHROPIC_API_KEY", "")

	// Settings with CLAUDE_CODE_USE_BEDROCK=false
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	settings := `{"env": {"CLAUDE_CODE_USE_BEDROCK": "false"}}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, false, result["configured"])
	assert.Equal(t, false, result["hasBedrock"])
	assert.Equal(t, "", result["credentialSource"])
}

func TestGetClaudeAuthStatus_ClaudeSettingsSkipsChatMLEnvVars(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	t.Setenv("ANTHROPIC_API_KEY", "")

	// Both Claude settings AND ChatML env vars have bedrock
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))
	settings := `{"env": {"CLAUDE_CODE_USE_BEDROCK": "true"}}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
	t.Setenv("HOME", dir)

	ctx := context.Background()
	require.NoError(t, st.SetSetting(ctx, "env-vars", "CLAUDE_CODE_USE_BEDROCK=true"))

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	// Claude settings detected first; check 6 is skipped
	assert.Equal(t, true, result["configured"])
	assert.Equal(t, true, result["hasBedrock"])
}

func TestGetClaudeAuthStatus_CliCredentialsFallbackToFile(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	t.Setenv("ANTHROPIC_API_KEY", "")

	// Create a valid credentials file with far-future expiry (year 3000)
	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	credContent := []byte(`{"claudeAiOauth":{"accessToken":"sk-ant-oat01-test","expiresAt":32503680000000}}`)
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), credContent, 0o600))
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/auth-status", nil)
	w := httptest.NewRecorder()
	h.GetClaudeAuthStatus(w, req)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, true, result["configured"])
	assert.Equal(t, true, result["hasCliCredentials"])
	assert.Equal(t, "claude_subscription", result["credentialSource"])
}

func TestGetClaudeEnv_NoFile(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	// HOME points to temp dir with no .claude/settings.json
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/claude-env", nil)
	w := httptest.NewRecorder()
	h.GetClaudeEnv(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	env, ok := result["env"].(map[string]interface{})
	require.True(t, ok)
	assert.Empty(t, env)
}

func TestGetClaudeEnv_WithEnvVars(t *testing.T) {
	h, st := setupTestHandlers(t)
	defer st.Close()

	dir := t.TempDir()
	claudeDir := filepath.Join(dir, ".claude")
	require.NoError(t, os.MkdirAll(claudeDir, 0o700))

	settings := `{
		"env": {
			"CLAUDE_CODE_USE_BEDROCK": "true",
			"AWS_PROFILE": "core-dev",
			"AWS_REGION": "us-east-1"
		}
	}`
	require.NoError(t, os.WriteFile(filepath.Join(claudeDir, "settings.json"), []byte(settings), 0o600))
	t.Setenv("HOME", dir)

	req := httptest.NewRequest("GET", "/api/settings/claude-env", nil)
	w := httptest.NewRecorder()
	h.GetClaudeEnv(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	env, ok := result["env"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "true", env["CLAUDE_CODE_USE_BEDROCK"])
	assert.Equal(t, "core-dev", env["AWS_PROFILE"])
	assert.Equal(t, "us-east-1", env["AWS_REGION"])
}
