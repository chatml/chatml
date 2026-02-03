package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/skills"
	"github.com/go-chi/chi/v5"
)

// ListSkills returns the full skill catalog with install status
func (h *Handlers) ListSkills(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	category := r.URL.Query().Get("category")
	search := r.URL.Query().Get("search")

	// Get installed skill IDs
	installedIDs, err := h.store.ListInstalledSkillIDs(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}
	installedSet := make(map[string]bool)
	for _, id := range installedIDs {
		installedSet[id] = true
	}

	// Filter skills based on query params
	filteredSkills := skills.FilterSkills(category, search)

	// Build response with install status
	result := make([]models.SkillWithInstallStatus, 0, len(filteredSkills))
	for _, skill := range filteredSkills {
		swis := models.SkillWithInstallStatus{
			Skill:     skill,
			Installed: installedSet[skill.ID],
		}
		if swis.Installed {
			installedAt, err := h.store.GetSkillInstalledAt(ctx, skill.ID)
			if err != nil {
				logger.Handlers.Warnf("Failed to get skill install time for %s: %v", skill.ID, err)
			}
			swis.InstalledAt = installedAt
		}
		result = append(result, swis)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ListInstalledSkills returns only installed skills
func (h *Handlers) ListInstalledSkills(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	installedIDs, err := h.store.ListInstalledSkillIDs(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}

	idSet := make(map[string]bool)
	for _, id := range installedIDs {
		idSet[id] = true
	}

	result := make([]models.SkillWithInstallStatus, 0)
	for _, skill := range skills.BuiltInSkills {
		if !idSet[skill.ID] {
			continue
		}
		installedAt, err := h.store.GetSkillInstalledAt(ctx, skill.ID)
		if err != nil {
			logger.Handlers.Warnf("Failed to get skill install time for %s: %v", skill.ID, err)
		}
		result = append(result, models.SkillWithInstallStatus{
			Skill:       skill,
			Installed:   true,
			InstalledAt: installedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// InstallSkill installs a skill (records preference)
func (h *Handlers) InstallSkill(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	skillID := chi.URLParam(r, "id")

	// Find skill in catalog
	skill := skills.GetSkillByID(skillID)
	if skill == nil {
		writeNotFound(w, "skill")
		return
	}

	// Record installation in DB
	if err := h.store.InstallSkill(ctx, skillID); err != nil {
		writeDBError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// UninstallSkill removes a skill installation
func (h *Handlers) UninstallSkill(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	skillID := chi.URLParam(r, "id")

	if err := h.store.UninstallSkill(ctx, skillID); err != nil {
		writeDBError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// GetSkillContent returns the content of a specific skill (for copying to worktree)
func (h *Handlers) GetSkillContent(w http.ResponseWriter, r *http.Request) {
	skillID := chi.URLParam(r, "id")

	skill := skills.GetSkillByID(skillID)
	if skill == nil {
		writeNotFound(w, "skill")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"id":        skill.ID,
		"name":      skill.Name,
		"skillPath": skill.SkillPath,
		"content":   skill.Content,
	})
}
