package skills

import "embed"

//go:embed content/gstack/*.md
var gstackContent embed.FS

// gstackSkillContent reads the embedded SKILL.md content for a GStack skill.
func gstackSkillContent(name string) string {
	data, err := gstackContent.ReadFile("content/gstack/" + name + ".md")
	if err != nil {
		return ""
	}
	return string(data)
}
