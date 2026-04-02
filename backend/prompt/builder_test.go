package prompt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuilder_Build_ContainsCoreSection(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "claude-sonnet-4-6", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "interactive agent")
	assert.Contains(t, prompt, "Doing tasks")
	assert.Contains(t, prompt, "Executing actions with care")
	assert.Contains(t, prompt, "NEVER generate or guess URLs")
	assert.Contains(t, prompt, "Do not use a colon before tool calls")
	assert.Contains(t, prompt, "measure twice, cut once")
	assert.Contains(t, prompt, "Dual-use security tools")
}

func TestBuilder_Build_ContainsSystemSection(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "claude-sonnet-4-6", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "# System")
	assert.Contains(t, prompt, "system-reminder")
	assert.Contains(t, prompt, "prompt injection")
	assert.Contains(t, prompt, "hooks")
	assert.Contains(t, prompt, "context limits")
	assert.Contains(t, prompt, "write down any important information")
}

func TestBuilder_Build_ContainsEnvironment(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "claude-sonnet-4-6", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "Primary working directory:")
	assert.Contains(t, prompt, "Platform:")
	assert.Contains(t, prompt, "Current date:")
	assert.Contains(t, prompt, "Claude 4.5/4.6")
}

func TestBuilder_Build_EnvironmentWithConfig(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilderWithConfig(BuilderConfig{
		Workdir:            dir,
		Model:              "claude-opus-4-6",
		ModelMarketingName: "Opus 4.6 (1M context)",
		ModelID:            "claude-opus-4-6[1m]",
		KnowledgeCutoff:    "May 2025",
		FastMode:           true,
		IsGitRepo:          true,
		GitBranch:          "feature/test",
		MainBranch:         "main",
		GitStatus:          "M foo.go\n?? bar.go",
		RecentCommits:      "abc1234 initial commit",
	})
	prompt := b.Build()

	assert.Contains(t, prompt, "Opus 4.6 (1M context)")
	assert.Contains(t, prompt, "claude-opus-4-6[1m]")
	assert.Contains(t, prompt, "May 2025")
	assert.Contains(t, prompt, "Fast mode")
	assert.Contains(t, prompt, "feature/test")
	assert.Contains(t, prompt, "Main branch")
	assert.Contains(t, prompt, "M foo.go")
	assert.Contains(t, prompt, "abc1234 initial commit")
}

func TestBuilder_Build_ContainsToolGuidelines(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "Using your tools")
	assert.Contains(t, prompt, "Read instead of cat")
	assert.Contains(t, prompt, "Edit instead of sed")
	assert.Contains(t, prompt, "TodoWrite")
}

func TestBuilder_Build_IncludesInstructions(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "", "Always use TypeScript")
	prompt := b.Build()

	assert.Contains(t, prompt, "Additional Instructions")
	assert.Contains(t, prompt, "Always use TypeScript")
}

func TestBuilder_Build_NoInstructionsWhenEmpty(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.NotContains(t, prompt, "Additional Instructions")
}

func TestBuilder_Build_LoadsClaudeMD(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("Use gofmt for formatting"), 0644)

	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "claudeMd")
	assert.Contains(t, prompt, "instructions OVERRIDE")
	assert.Contains(t, prompt, "Use gofmt for formatting")
}

func TestBuilder_Build_LoadsMemory(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".claude", "memory"), 0755)
	os.WriteFile(filepath.Join(dir, ".claude", "memory", "MEMORY.md"), []byte("User prefers Go"), 0644)

	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "auto-memory")
	assert.Contains(t, prompt, "User prefers Go")
}

func TestBuilder_Build_MemoryTruncatedAt200Lines(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".claude", "memory"), 0755)

	var lines []string
	for i := 0; i < 250; i++ {
		lines = append(lines, "memory line")
	}
	os.WriteFile(filepath.Join(dir, ".claude", "memory", "MEMORY.md"), []byte(strings.Join(lines, "\n")), 0644)

	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.Contains(t, prompt, "memory truncated at 200 lines")
}

func TestBuilder_Build_ToolPrompts(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "", "")
	b.SetToolPrompts([]string{"Tool A instructions", "Tool B instructions"})
	prompt := b.Build()

	assert.Contains(t, prompt, "Tool A instructions")
	assert.Contains(t, prompt, "Tool B instructions")
}

func TestBuilder_Build_NoGitStatusWhenNotRepo(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilderWithConfig(BuilderConfig{
		Workdir:   dir,
		IsGitRepo: false,
	})
	prompt := b.Build()

	assert.NotContains(t, prompt, "gitStatus:")
}

// --- CLAUDE.md loader tests ---

func TestLoadClaudeMD_SingleFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("project rules"), 0644)

	entries := LoadClaudeMD(dir)
	require.NotEmpty(t, entries)

	found := false
	for _, e := range entries {
		if strings.Contains(e.Content, "project rules") {
			found = true
			break
		}
	}
	assert.True(t, found, "expected to find 'project rules' in entries")
}

func TestLoadClaudeMD_DotClaudeDir(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".claude"), 0755)
	os.WriteFile(filepath.Join(dir, ".claude", "CLAUDE.md"), []byte("dot claude rules"), 0644)

	entries := LoadClaudeMD(dir)
	found := false
	for _, e := range entries {
		if strings.Contains(e.Content, "dot claude rules") {
			found = true
		}
	}
	assert.True(t, found)
}

func TestLoadClaudeMD_RulesGlob(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".claude", "rules"), 0755)
	os.WriteFile(filepath.Join(dir, ".claude", "rules", "testing.md"), []byte("always write tests"), 0644)
	os.WriteFile(filepath.Join(dir, ".claude", "rules", "style.md"), []byte("use camelCase"), 0644)

	entries := LoadClaudeMD(dir)
	var contents []string
	for _, e := range entries {
		contents = append(contents, e.Content)
	}
	merged := strings.Join(contents, " ")
	assert.Contains(t, merged, "always write tests")
	assert.Contains(t, merged, "use camelCase")
}

func TestLoadClaudeMD_LocalFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "CLAUDE.local.md"), []byte("local overrides"), 0644)

	entries := LoadClaudeMD(dir)
	require.NotEmpty(t, entries)

	// Local should have highest priority
	last := entries[len(entries)-1]
	assert.Contains(t, last.Content, "local overrides")
}

func TestLoadClaudeMD_NoFiles(t *testing.T) {
	dir := t.TempDir()
	entries := LoadClaudeMD(dir)
	_ = entries
}

func TestMergeClaudeMD_Empty(t *testing.T) {
	assert.Equal(t, "", MergeClaudeMD(nil))
}

func TestMergeClaudeMD_Combines(t *testing.T) {
	entries := []ClaudeMDEntry{
		{Content: "global rules", Priority: 0},
		{Content: "project rules", Priority: 1},
	}
	merged := MergeClaudeMD(entries)
	assert.Contains(t, merged, "global rules")
	assert.Contains(t, merged, "project rules")
}

func TestMergeClaudeMD_TruncatesAtLimit(t *testing.T) {
	big := strings.Repeat("x", maxClaudeMDChars+1000)
	entries := []ClaudeMDEntry{
		{Content: big, Priority: 0},
	}
	merged := MergeClaudeMD(entries)
	assert.LessOrEqual(t, len(merged), maxClaudeMDChars+50)
	assert.Contains(t, merged, "truncated")
}

func TestStripBlockComments(t *testing.T) {
	input := "before <!-- comment --> after"
	assert.Equal(t, "before  after", stripBlockComments(input))
}

func TestStripBlockComments_Multiline(t *testing.T) {
	input := "before\n<!--\nmultiline\ncomment\n-->\nafter"
	result := stripBlockComments(input)
	assert.Contains(t, result, "before")
	assert.Contains(t, result, "after")
	assert.NotContains(t, result, "multiline")
}

func TestDirectoryChainToRoot(t *testing.T) {
	chain := directoryChainToRoot("/home/user/project")
	assert.Contains(t, chain, "/home/user/project")
	assert.Contains(t, chain, "/home/user")
	assert.Contains(t, chain, "/home")
	assert.Contains(t, chain, "/")
}

func TestDirectoryChainToRoot_Root(t *testing.T) {
	chain := directoryChainToRoot("/")
	assert.Len(t, chain, 1)
	assert.Equal(t, "/", chain[0])
}

func TestLoadClaudeMD_Priority(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("project"), 0644)
	os.WriteFile(filepath.Join(dir, "CLAUDE.local.md"), []byte("local"), 0644)

	entries := LoadClaudeMD(dir)
	require.NotEmpty(t, entries)

	maxPriority := -1
	var highestContent string
	for _, e := range entries {
		if e.Priority > maxPriority {
			maxPriority = e.Priority
			highestContent = e.Content
		}
	}
	assert.Equal(t, "local", highestContent)
}

func TestMergeClaudeMD_PriorityOrder(t *testing.T) {
	entries := []ClaudeMDEntry{
		{Content: "high", Priority: 10},
		{Content: "low", Priority: 0},
	}
	merged := MergeClaudeMD(entries)
	lowIdx := strings.Index(merged, "low")
	highIdx := strings.Index(merged, "high")
	assert.Less(t, lowIdx, highIdx, "lower priority content should appear first")
}

func TestStripBlockComments_NoComments(t *testing.T) {
	input := "no comments here"
	assert.Equal(t, "no comments here", stripBlockComments(input))
}

func TestStripBlockComments_MultipleComments(t *testing.T) {
	input := "a <!-- c1 --> b <!-- c2 --> c"
	assert.Equal(t, "a  b  c", stripBlockComments(input))
}

func TestLoadClaudeMD_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte(""), 0644)

	entries := LoadClaudeMD(dir)
	for _, e := range entries {
		assert.NotEqual(t, filepath.Join(dir, "CLAUDE.md"), e.Path, "empty file should not be loaded")
	}
}

func TestBuilder_Build_NoClaudeMDSection(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.NotContains(t, prompt, "# claudeMd")
}

func TestBuilder_Build_NoMemorySection(t *testing.T) {
	dir := t.TempDir()
	b := NewBuilder(dir, "", "")
	prompt := b.Build()

	assert.NotContains(t, prompt, "Contents of")
}
