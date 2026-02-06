package models

import "time"

// SkillCategory represents a category of skills
type SkillCategory string

const (
	SkillCategoryDevelopment    SkillCategory = "development"
	SkillCategoryDocumentation  SkillCategory = "documentation"
	SkillCategoryVersionControl SkillCategory = "version-control"
)

// ValidSkillCategories is the set of valid skill category values
var ValidSkillCategories = map[SkillCategory]bool{
	SkillCategoryDevelopment:    true,
	SkillCategoryDocumentation:  true,
	SkillCategoryVersionControl: true,
}

// Skill represents a skill definition in the catalog
type Skill struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Category    SkillCategory `json:"category"`
	Author      string        `json:"author"`
	Version     string        `json:"version"`
	Preview     string        `json:"preview"`   // Short preview of what the skill does
	SkillPath   string        `json:"skillPath"` // Relative path within .claude/skills/
	Content     string        `json:"-"`           // The actual skill file content (not sent in API)
	CreatedAt   time.Time     `json:"createdAt"`
	UpdatedAt   time.Time     `json:"updatedAt"`
}

// UserSkillPreference tracks which skills a user has installed
type UserSkillPreference struct {
	ID          string    `json:"id"`
	SkillID     string    `json:"skillId"`
	InstalledAt time.Time `json:"installedAt"`
}

// SkillWithInstallStatus combines skill data with user's install status
type SkillWithInstallStatus struct {
	Skill
	Installed   bool       `json:"installed"`
	InstalledAt *time.Time `json:"installedAt,omitempty"`
}
