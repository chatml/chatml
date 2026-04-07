package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chatml/chatml-core/skills"
	"github.com/chatml/chatml-core/tool"
)

// SkillTool executes skills (prompt templates) invoked by the LLM.
// Skills are loaded from bundled, user, and project directories.
type SkillTool struct {
	catalog *skills.Catalog
}

// NewSkillTool creates a Skill tool with the given catalog.
func NewSkillTool(catalog *skills.Catalog) *SkillTool {
	return &SkillTool{catalog: catalog}
}

func (t *SkillTool) Name() string { return "Skill" }

func (t *SkillTool) Description() string {
	return "Execute a skill (prompt template) by name. Skills are reusable workflows like /commit, /review, /simplify. Use this when the user invokes a slash command."
}

func (t *SkillTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"skill": {
				"type": "string",
				"description": "The skill name (e.g., 'commit', 'review', 'simplify')"
			},
			"args": {
				"type": "string",
				"description": "Optional arguments for the skill"
			}
		},
		"required": ["skill"]
	}`)
}

func (t *SkillTool) IsConcurrentSafe() bool { return false }

func (t *SkillTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		Skill string `json:"skill"`
		Args  string `json:"args"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.Skill == "" {
		return tool.ErrorResult("skill name is required"), nil
	}

	// Strip leading "/" if present
	skillName := strings.TrimPrefix(in.Skill, "/")

	// Look up skill
	skill := t.catalog.Get(skillName)
	if skill == nil {
		// List available skills as suggestions
		available := t.catalog.UserInvocable()
		var names []string
		for _, s := range available {
			names = append(names, s.Name)
		}
		return tool.ErrorResult(fmt.Sprintf(
			"Skill %q not found. Available skills: %s",
			skillName, strings.Join(names, ", "),
		)), nil
	}

	// Build the prompt with arguments
	prompt := skill.Prompt
	if in.Args != "" {
		prompt = prompt + "\n\nArguments: " + in.Args
	}

	// Return the prompt as the tool result — the LLM will process it as instructions
	return tool.TextResult(fmt.Sprintf("<skill name=%q>\n%s\n</skill>", skill.Name, prompt)), nil
}

// Prompt implements PromptProvider to inject available skills into the system prompt.
func (t *SkillTool) Prompt() string {
	if t.catalog == nil || t.catalog.Count() == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("Available skills (invoke with Skill tool):\n")
	for _, s := range t.catalog.UserInvocable() {
		sb.WriteString(fmt.Sprintf("- %s: %s", s.Name, s.Description))
		if s.WhenToUse != "" {
			sb.WriteString(fmt.Sprintf(" (%s)", s.WhenToUse))
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

var _ tool.Tool = (*SkillTool)(nil)
var _ tool.PromptProvider = (*SkillTool)(nil)
