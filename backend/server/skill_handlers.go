package server

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/skills"
	"github.com/go-chi/chi/v5"
)

// skillFileDir returns the path to ~/.claude/skills/chatml-{id}/
func skillFileDir(skillID string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "skills", "chatml-"+skillID), nil
}

// writeSkillFile writes a SKILL.md file to ~/.claude/skills/chatml-{id}/SKILL.md
func writeSkillFile(skill *models.Skill) error {
	dir, err := skillFileDir(skill.ID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("cannot create skill directory: %w", err)
	}

	// Build SKILL.md with frontmatter matching the SDK's expected format
	content := fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", skill.ID, skill.Description, skill.Content)

	return os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(content), 0644)
}

// removeSkillFile removes ~/.claude/skills/chatml-{id}/
func removeSkillFile(skillID string) error {
	dir, err := skillFileDir(skillID)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

// ListSkills returns the full skill catalog with install status
func (h *Handlers) ListSkills(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	category := r.URL.Query().Get("category")
	search := r.URL.Query().Get("search")

	// Get all installed skills with timestamps in a single query
	installedSkills, err := h.store.ListInstalledSkillsWithTimestamps(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Filter skills based on query params
	filteredSkills := skills.FilterSkills(category, search)

	// Build response with install status
	result := make([]models.SkillWithInstallStatus, 0, len(filteredSkills))
	for _, skill := range filteredSkills {
		swis := models.SkillWithInstallStatus{
			Skill:     skill,
			Installed: false,
		}
		if installedAt, ok := installedSkills[skill.ID]; ok {
			swis.Installed = true
			swis.InstalledAt = &installedAt
		}
		result = append(result, swis)
	}

	writeJSON(w, result)
}

// ListInstalledSkills returns only installed skills
func (h *Handlers) ListInstalledSkills(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get all installed skills with timestamps in a single query
	installedSkills, err := h.store.ListInstalledSkillsWithTimestamps(ctx)
	if err != nil {
		writeDBError(w, err)
		return
	}

	result := make([]models.SkillWithInstallStatus, 0, len(installedSkills))
	for _, skill := range skills.BuiltInSkills {
		installedAt, ok := installedSkills[skill.ID]
		if !ok {
			continue
		}
		result = append(result, models.SkillWithInstallStatus{
			Skill:       skill,
			Installed:   true,
			InstalledAt: &installedAt,
		})
	}

	writeJSON(w, result)
}

// InstallSkill installs a skill (records preference and writes SKILL.md to ~/.claude/skills/)
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

	// Write SKILL.md to ~/.claude/skills/chatml-{id}/ so the SDK discovers it globally
	if err := writeSkillFile(skill); err != nil {
		log.Printf("WARN: Failed to write skill file for %s: %v", skillID, err)
		// Non-fatal: skill is recorded in DB, file write is best-effort
	}

	writeJSON(w, map[string]bool{"success": true})
}

// UninstallSkill removes a skill installation
func (h *Handlers) UninstallSkill(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	skillID := chi.URLParam(r, "id")

	if err := h.store.UninstallSkill(ctx, skillID); err != nil {
		writeDBError(w, err)
		return
	}

	// Remove SKILL.md from ~/.claude/skills/chatml-{id}/
	if err := removeSkillFile(skillID); err != nil {
		log.Printf("WARN: Failed to remove skill file for %s: %v", skillID, err)
		// Non-fatal: preference is removed from DB, file removal is best-effort
	}

	writeJSON(w, map[string]bool{"success": true})
}

// GetSkillContent returns the content of a specific skill (for copying to worktree)
func (h *Handlers) GetSkillContent(w http.ResponseWriter, r *http.Request) {
	skillID := chi.URLParam(r, "id")

	skill := skills.GetSkillByID(skillID)
	if skill == nil {
		writeNotFound(w, "skill")
		return
	}

	writeJSON(w, map[string]string{
		"id":        skill.ID,
		"name":      skill.Name,
		"skillPath": skill.SkillPath,
		"content":   skill.Content,
	})
}
