// Package skills provides skill loading and execution for the native Go loop.
// Skills are reusable prompt templates that can be invoked by the LLM via the
// Skill tool (triggered by "/<skill-name>" in user messages).
//
// Skills are loaded from:
// 1. ~/.claude/skills/ (user-level)
// 2. .claude/skills/ (project-level)
// 3. Bundled skills (compiled into the binary)
package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Skill defines a reusable prompt template.
type Skill struct {
	Name            string   `yaml:"name" json:"name"`
	Description     string   `yaml:"description" json:"description"`
	WhenToUse       string   `yaml:"whenToUse,omitempty" json:"when_to_use,omitempty"`
	ArgumentHint    string   `yaml:"argumentHint,omitempty" json:"argument_hint,omitempty"`
	AllowedTools    []string `yaml:"allowedTools,omitempty" json:"allowed_tools,omitempty"`
	Model           string   `yaml:"model,omitempty" json:"model,omitempty"`
	UserInvocable   bool     `yaml:"userInvocable,omitempty" json:"user_invocable,omitempty"`
	Prompt          string   `yaml:"-" json:"-"` // Loaded from SKILL.md body
	Source          string   `yaml:"-" json:"source,omitempty"` // "bundled", "user", "project"
	FilePath        string   `yaml:"-" json:"file_path,omitempty"`
}

// Catalog holds all loaded skills indexed by name.
type Catalog struct {
	skills map[string]*Skill
	order  []string
}

// NewCatalog creates an empty skill catalog.
func NewCatalog() *Catalog {
	return &Catalog{skills: make(map[string]*Skill)}
}

// Add registers a skill. Existing skills with the same name are overwritten.
func (c *Catalog) Add(s *Skill) {
	if _, exists := c.skills[s.Name]; !exists {
		c.order = append(c.order, s.Name)
	}
	c.skills[s.Name] = s
}

// Get returns a skill by name, or nil.
func (c *Catalog) Get(name string) *Skill {
	return c.skills[name]
}

// All returns all skills in load order.
func (c *Catalog) All() []*Skill {
	result := make([]*Skill, 0, len(c.order))
	for _, name := range c.order {
		if s, ok := c.skills[name]; ok {
			result = append(result, s)
		}
	}
	return result
}

// UserInvocable returns skills that can be invoked by the user (via /name).
func (c *Catalog) UserInvocable() []*Skill {
	var result []*Skill
	for _, s := range c.All() {
		if s.UserInvocable {
			result = append(result, s)
		}
	}
	return result
}

// Count returns the number of loaded skills.
func (c *Catalog) Count() int { return len(c.skills) }

// LoadAll loads skills from all standard locations.
// Priority (last wins): bundled < user (~/.claude/skills/) < project (.claude/skills/)
func LoadAll(workdir string) *Catalog {
	catalog := NewCatalog()

	// 1. Bundled skills
	for _, s := range bundledSkills {
		catalog.Add(s)
	}

	// 2. User skills (.claude first as fallback, then .chatml overwrites on collision)
	if home, err := os.UserHomeDir(); err == nil {
		loadDir(catalog, filepath.Join(home, ".claude", "skills"), "user")
		loadDir(catalog, filepath.Join(home, ".chatml", "skills"), "user")
	}

	// 3. Project skills (.claude first as fallback, then .chatml overwrites on collision)
	if workdir != "" {
		loadDir(catalog, filepath.Join(workdir, ".claude", "skills"), "project")
		loadDir(catalog, filepath.Join(workdir, ".chatml", "skills"), "project")
	}

	return catalog
}

// loadDir loads all SKILL.md files from a directory.
func loadDir(catalog *Catalog, dir, source string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			// Look for SKILL.md inside the directory
			skillPath := filepath.Join(dir, entry.Name(), "SKILL.md")
			if s, err := loadSkillFile(skillPath, source); err == nil {
				if s.Name == "" {
					s.Name = entry.Name()
				}
				catalog.Add(s)
			}
		} else if strings.EqualFold(entry.Name(), "SKILL.md") {
			// SKILL.md directly in the dir
			skillPath := filepath.Join(dir, entry.Name())
			if s, err := loadSkillFile(skillPath, source); err == nil {
				catalog.Add(s)
			}
		}
	}
}

// loadSkillFile reads a SKILL.md file with YAML frontmatter.
func loadSkillFile(path, source string) (*Skill, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	content := string(data)
	skill := &Skill{
		Source:        source,
		FilePath:      path,
		UserInvocable: true, // Default: user-invocable
	}

	// Parse YAML frontmatter (between --- delimiters)
	if strings.HasPrefix(content, "---") {
		parts := strings.SplitN(content[3:], "---", 2)
		if len(parts) == 2 {
			if err := yaml.Unmarshal([]byte(parts[0]), skill); err != nil {
				return nil, fmt.Errorf("parse frontmatter: %w", err)
			}
			skill.Prompt = strings.TrimSpace(parts[1])
		} else {
			skill.Prompt = strings.TrimSpace(content)
		}
	} else {
		skill.Prompt = strings.TrimSpace(content)
	}

	if skill.Name == "" {
		// Derive name from parent directory
		skill.Name = filepath.Base(filepath.Dir(path))
	}

	return skill, nil
}

// --- Bundled Skills ---

var bundledSkills = []*Skill{
	{
		Name:          "init",
		Description:   "Initialize CLAUDE.md, skills, and hooks for the project",
		WhenToUse:     "When the user runs /init or asks to set up the project",
		UserInvocable: true,
		Source:        "bundled",
		Prompt: `You are initializing this project for Claude Code / ChatML. Follow these phases:

**Phase 1: Ask Preferences**
Ask the user:
- Which CLAUDE.md files? (Project CLAUDE.md checked in, Personal CLAUDE.local.md gitignored, or Both)
- Also set up skills and hooks? (Skills only / Hooks only / Both / Neither)

**Phase 2: Codebase Survey**
Launch a sub-agent to survey the project:
- Read: package.json, Cargo.toml, go.mod, README.md, Makefile, CI config (.github/workflows/), .cursor/rules, .mcp.json
- Detect: languages, frameworks, build/test/lint commands, formatters, project structure
- Identify what can be discovered from code vs. what needs user interview

**Phase 3: Gap-Filling Interview**
Ask the user questions to fill blind spots the codebase survey couldn't answer:
- Team conventions, deployment process, testing philosophy
- Any gotchas or things Claude should know

**Phase 4: Write CLAUDE.md**
Write a minimal CLAUDE.md where every line passes the test: "Would removing this cause Claude to make mistakes?"
Include: build/test/lint commands, key conventions, architecture overview, common patterns.

**Phase 5: Skills & Hooks Setup** (if user opted in)
- Create useful skills in .claude/skills/ (e.g., /deploy, /test-all)
- Create hooks in .claude/settings.json (e.g., format-on-edit, lint-on-save)

**Phase 6: Write Files**
Write all generated files to disk. Confirm with the user before writing.

Be concise. Don't over-generate. Every line in CLAUDE.md must earn its place.`,
	},
	{
		Name:          "commit",
		Description:   "Create a git commit with a well-crafted message",
		WhenToUse:     "When the user asks to commit changes",
		UserInvocable: true,
		Source:        "bundled",
		Prompt:        "Create a git commit for the current changes. Follow the repository's commit message conventions. Include a Co-Authored-By trailer.",
	},
	{
		Name:          "review",
		Description:   "Review code changes for quality and correctness",
		WhenToUse:     "When the user asks to review code or a PR",
		UserInvocable: true,
		Source:        "bundled",
		Prompt:        "Review the current code changes. Check for bugs, security issues, performance problems, and style inconsistencies. Provide actionable feedback.",
	},
	{
		Name:          "simplify",
		Description:   "Review changed code for reuse, quality, and efficiency",
		WhenToUse:     "When the user asks to simplify or clean up code",
		UserInvocable: true,
		Source:        "bundled",
		Prompt:        "Review the recently changed code for opportunities to simplify, reduce duplication, and improve efficiency. Fix any issues found.",
	},
	{
		Name:          "remember",
		Description:   "Review and manage auto-memory entries",
		WhenToUse:     "When the user wants to review saved memories",
		UserInvocable: true,
		Source:        "bundled",
		Prompt:        "Review the auto-memory entries in the MEMORY.md file and associated memory files. Identify any entries that are outdated or incorrect and offer to update or remove them.",
	},
	{
		Name:          "debug",
		Description:   "Debug a failing test or error",
		WhenToUse:     "When the user asks to debug something",
		UserInvocable: true,
		Source:        "bundled",
		Prompt:        "Help debug the issue described by the user. Read error messages, trace through code, identify root causes, and suggest fixes. Run tests to verify.",
	},
}
