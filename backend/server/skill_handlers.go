package server

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-core/paths"
	"github.com/chatml/chatml-backend/skills"
	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"
)

// skillFileDir returns the path to the skill directory.
// Uses ~/.chatml/skills/{id}/ as primary, falls back to ~/.claude/skills/chatml-{id}/.
func skillFileDir(skillID string) (string, error) {
	primary := paths.SkillDir(skillID)
	if primary != "" {
		return primary, nil
	}
	// Fallback
	fb := paths.SkillDirFallback(skillID)
	if fb != "" {
		return fb, nil
	}
	return "", fmt.Errorf("cannot determine home directory for skills")
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

	// Build SKILL.md with a single frontmatter block. skill.Content may already
	// contain its own frontmatter (e.g., GStack skills), so we merge rather than wrap.
	content := buildSkillFileContent(skill)

	return os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(content), 0644)
}

// buildSkillFileContent produces a SKILL.md string with a single frontmatter block.
// If skill.Content already contains YAML frontmatter, the existing fields are preserved
// while name and description are overridden to match the catalog entry. If the content
// has no frontmatter, a new block is created.
func buildSkillFileContent(skill *models.Skill) string {
	trimmed := strings.TrimLeft(skill.Content, " \t\r\n")

	// Normalise CRLF → LF so all downstream fence searching and YAML parsing
	// works with a single line-ending convention.
	trimmed = strings.ReplaceAll(trimmed, "\r\n", "\n")

	// Check if content starts with a frontmatter fence
	if !strings.HasPrefix(trimmed, "---\n") {
		// No existing frontmatter — create one from scratch
		return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", skill.ID, skill.Description, skill.Content)
	}

	// Find the closing fence. Search after the opening "---\n".
	rest := trimmed[4:] // skip "---\n"
	closingIdx := strings.Index(rest, "\n---\n")
	if closingIdx == -1 {
		// Check for closing fence at end of string
		if strings.HasSuffix(rest, "\n---") {
			closingIdx = len(rest) - 4 // position before "\n---"
		} else {
			// Malformed frontmatter — wrap from scratch
			return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", skill.ID, skill.Description, skill.Content)
		}
	}

	fmYAML := rest[:closingIdx]
	body := rest[closingIdx+4:] // skip "\n---"
	// body starts with "\n..." (the content after the closing fence)

	// Parse existing frontmatter into an ordered map
	var fm yaml.Node
	if err := yaml.Unmarshal([]byte(fmYAML), &fm); err != nil {
		// Parse failed — wrap from scratch
		return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", skill.ID, skill.Description, skill.Content)
	}

	// yaml.Unmarshal wraps in a Document node; the mapping is the first child
	if fm.Kind != yaml.DocumentNode || len(fm.Content) == 0 || fm.Content[0].Kind != yaml.MappingNode {
		return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", skill.ID, skill.Description, skill.Content)
	}
	mapping := fm.Content[0]

	// Override name and description in the mapping node
	setYAMLField(mapping, "name", skill.ID)
	setYAMLField(mapping, "description", skill.Description)

	out, err := yaml.Marshal(&fm)
	if err != nil {
		return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", skill.ID, skill.Description, skill.Content)
	}

	// fmYAML has no leading "---", so the parsed DocumentNode is implicit.
	// yaml.Marshal on an implicit document omits the document-start marker,
	// which lets us prepend our own "---\n" without duplication.
	// It does add a trailing newline; trim it so we get clean "---\n<yaml>\n---".
	yamlStr := strings.TrimRight(string(out), "\n")
	return "---\n" + yamlStr + "\n---" + body
}

// setYAMLField sets or adds a scalar field in a YAML mapping node.
func setYAMLField(mapping *yaml.Node, key, value string) {
	// Content is interleaved [key0, val0, key1, val1, ...]; step by 2.
	for i := 0; i < len(mapping.Content)-1; i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Value: value}
			return
		}
	}
	// Key not found — append it
	mapping.Content = append(mapping.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Value: value},
	)
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
