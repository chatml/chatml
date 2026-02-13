package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/skills"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// ListSkills Handler Tests
// ============================================================================

func TestListSkills_ReturnsCatalog(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/skills", nil)
	w := httptest.NewRecorder()

	h.ListSkills(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	// Should return all built-in skills
	assert.Equal(t, len(skills.BuiltInSkills), len(result))

	// Verify first skill matches catalog
	assert.Equal(t, skills.BuiltInSkills[0].ID, result[0].ID)
	assert.Equal(t, skills.BuiltInSkills[0].Name, result[0].Name)

	// None should be installed by default
	for _, s := range result {
		assert.False(t, s.Installed, "skill %s should not be installed by default", s.ID)
		assert.Nil(t, s.InstalledAt)
	}
}

func TestListSkills_FilterByCategory(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/skills?category=security", nil)
	w := httptest.NewRecorder()

	h.ListSkills(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	// All returned skills should be in the security category
	require.NotEmpty(t, result)
	for _, s := range result {
		assert.Equal(t, models.SkillCategorySecurity, s.Category, "expected security category for skill %s", s.ID)
	}

	// Count expected security skills from the catalog
	expected := skills.FilterSkills("security", "")
	assert.Equal(t, len(expected), len(result))
}

func TestListSkills_FilterBySearch(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Search for "debugging" which should match the systematic-debugging skill
	req := httptest.NewRequest("GET", "/api/skills?search=debugging", nil)
	w := httptest.NewRecorder()

	h.ListSkills(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	require.NotEmpty(t, result)

	// Verify the systematic-debugging skill is in the results
	found := false
	for _, s := range result {
		if s.ID == "systematic-debugging" {
			found = true
			break
		}
	}
	assert.True(t, found, "expected systematic-debugging skill in search results")

	// Count should match what FilterSkills returns
	expected := skills.FilterSkills("", "debugging")
	assert.Equal(t, len(expected), len(result))
}

// ============================================================================
// ListInstalledSkills Handler Tests
// ============================================================================

func TestListInstalledSkills_Empty(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/skills/installed", nil)
	w := httptest.NewRecorder()

	h.ListInstalledSkills(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	// Should return empty array when no skills are installed
	assert.Empty(t, result)
}

func TestListInstalledSkills_WithInstalled(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	// Install the first skill from the catalog
	skillID := skills.BuiltInSkills[0].ID
	require.Equal(t, "tdd-workflow", skillID)
	require.NoError(t, s.InstallSkill(ctx, skillID))

	req := httptest.NewRequest("GET", "/api/skills/installed", nil)
	w := httptest.NewRecorder()

	h.ListInstalledSkills(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	// Should return only the one installed skill
	require.Len(t, result, 1)
	assert.Equal(t, skillID, result[0].ID)
	assert.True(t, result[0].Installed)
	assert.NotNil(t, result[0].InstalledAt)
}

// ============================================================================
// InstallSkill Handler Tests
// ============================================================================

func TestInstallSkill_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	skillID := skills.BuiltInSkills[0].ID

	req := httptest.NewRequest("POST", "/api/skills/"+skillID+"/install", nil)
	req = withChiContext(req, map[string]string{"id": skillID})
	w := httptest.NewRecorder()

	h.InstallSkill(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]bool
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	assert.True(t, result["success"])

	// Verify the skill is now installed by listing installed skills
	req2 := httptest.NewRequest("GET", "/api/skills/installed", nil)
	w2 := httptest.NewRecorder()
	h.ListInstalledSkills(w2, req2)

	var installed []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &installed))
	require.Len(t, installed, 1)
	assert.Equal(t, skillID, installed[0].ID)
}

func TestInstallSkill_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("POST", "/api/skills/nonexistent-skill/install", nil)
	req = withChiContext(req, map[string]string{"id": "nonexistent-skill"})
	w := httptest.NewRecorder()

	h.InstallSkill(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
	assert.Contains(t, apiErr.Error, "skill")
}

func TestInstallSkill_Idempotent(t *testing.T) {
	h, _ := setupTestHandlers(t)

	skillID := skills.BuiltInSkills[0].ID

	// Install once
	req := httptest.NewRequest("POST", "/api/skills/"+skillID+"/install", nil)
	req = withChiContext(req, map[string]string{"id": skillID})
	w := httptest.NewRecorder()
	h.InstallSkill(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Install again — should not error due to ON CONFLICT DO NOTHING
	req2 := httptest.NewRequest("POST", "/api/skills/"+skillID+"/install", nil)
	req2 = withChiContext(req2, map[string]string{"id": skillID})
	w2 := httptest.NewRecorder()
	h.InstallSkill(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var result map[string]bool
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &result))
	assert.True(t, result["success"])

	// Verify still only one installed skill
	req3 := httptest.NewRequest("GET", "/api/skills/installed", nil)
	w3 := httptest.NewRecorder()
	h.ListInstalledSkills(w3, req3)

	var installed []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w3.Body.Bytes(), &installed))
	assert.Len(t, installed, 1)
}

// ============================================================================
// UninstallSkill Handler Tests
// ============================================================================

func TestUninstallSkill_Success(t *testing.T) {
	h, s := setupTestHandlers(t)
	ctx := context.Background()

	skillID := skills.BuiltInSkills[0].ID

	// Install first
	require.NoError(t, s.InstallSkill(ctx, skillID))

	// Uninstall
	req := httptest.NewRequest("DELETE", "/api/skills/"+skillID+"/install", nil)
	req = withChiContext(req, map[string]string{"id": skillID})
	w := httptest.NewRecorder()

	h.UninstallSkill(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]bool
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	assert.True(t, result["success"])

	// Verify the skill is no longer installed
	req2 := httptest.NewRequest("GET", "/api/skills/installed", nil)
	w2 := httptest.NewRecorder()
	h.ListInstalledSkills(w2, req2)

	var installed []models.SkillWithInstallStatus
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &installed))
	assert.Empty(t, installed)
}

func TestUninstallSkill_NonExistent(t *testing.T) {
	h, _ := setupTestHandlers(t)

	// Uninstalling a skill that was never installed should not error
	req := httptest.NewRequest("DELETE", "/api/skills/tdd-workflow/install", nil)
	req = withChiContext(req, map[string]string{"id": "tdd-workflow"})
	w := httptest.NewRecorder()

	h.UninstallSkill(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]bool
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	assert.True(t, result["success"])
}

// ============================================================================
// GetSkillContent Handler Tests
// ============================================================================

func TestGetSkillContent_Success(t *testing.T) {
	h, _ := setupTestHandlers(t)

	skillID := skills.BuiltInSkills[0].ID

	req := httptest.NewRequest("GET", "/api/skills/"+skillID+"/content", nil)
	req = withChiContext(req, map[string]string{"id": skillID})
	w := httptest.NewRecorder()

	h.GetSkillContent(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))

	assert.Equal(t, skillID, result["id"])
	assert.Equal(t, skills.BuiltInSkills[0].Name, result["name"])
	assert.Equal(t, skills.BuiltInSkills[0].SkillPath, result["skillPath"])
	assert.NotEmpty(t, result["content"], "content should not be empty")
	assert.Equal(t, skills.BuiltInSkills[0].Content, result["content"])
}

func TestGetSkillContent_NotFound(t *testing.T) {
	h, _ := setupTestHandlers(t)

	req := httptest.NewRequest("GET", "/api/skills/nonexistent-skill/content", nil)
	req = withChiContext(req, map[string]string{"id": "nonexistent-skill"})
	w := httptest.NewRecorder()

	h.GetSkillContent(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var apiErr APIError
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &apiErr))
	assert.Equal(t, ErrCodeNotFound, apiErr.Code)
	assert.Contains(t, apiErr.Error, "skill")
}
