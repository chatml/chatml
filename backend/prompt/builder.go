package prompt

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Builder constructs the system prompt for the native Go agentic loop.
// It assembles multiple sections: core instructions, environment context,
// CLAUDE.md content, memory, and user-provided instructions.
type Builder struct {
	workdir      string
	model        string
	instructions string // Additional instructions from opts
}

// NewBuilder creates a prompt builder for the given workspace.
func NewBuilder(workdir, model, instructions string) *Builder {
	return &Builder{
		workdir:      workdir,
		model:        model,
		instructions: instructions,
	}
}

// Build assembles the full system prompt from all sections.
func (b *Builder) Build() string {
	var sections []string

	// 1. Core identity
	sections = append(sections, b.coreSection())

	// 2. Environment context
	sections = append(sections, b.environmentSection())

	// 3. Tool usage guidelines
	sections = append(sections, b.toolGuidelines())

	// 4. CLAUDE.md content
	if claudeMD := b.claudeMDSection(); claudeMD != "" {
		sections = append(sections, claudeMD)
	}

	// 5. Memory content
	if memory := b.memorySection(); memory != "" {
		sections = append(sections, memory)
	}

	// 6. Custom instructions
	if b.instructions != "" {
		sections = append(sections, fmt.Sprintf("# Additional Instructions\n\n%s", b.instructions))
	}

	return strings.Join(sections, "\n\n")
}

// coreSection returns the core identity and behavior instructions.
func (b *Builder) coreSection() string {
	return `You are an AI assistant helping with software engineering tasks. You have access to tools that let you read, write, and search files, execute shell commands, and interact with the codebase.

# Key Principles
- Read files before modifying them to understand existing code
- Prefer editing existing files over creating new ones
- Break complex tasks into steps
- Run tests after making changes when possible
- Keep responses concise and focused
- Only make changes that were requested — don't add extra features, refactoring, or "improvements"
- Be careful not to introduce security vulnerabilities`
}

// environmentSection returns dynamic environment context.
func (b *Builder) environmentSection() string {
	var parts []string
	parts = append(parts, "# Environment")

	// Working directory
	parts = append(parts, fmt.Sprintf("- Working directory: %s", b.workdir))

	// Platform
	parts = append(parts, fmt.Sprintf("- Platform: %s/%s", runtime.GOOS, runtime.GOARCH))

	// Shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "unknown"
	}
	parts = append(parts, fmt.Sprintf("- Shell: %s", filepath.Base(shell)))

	// Current date
	parts = append(parts, fmt.Sprintf("- Current date: %s", time.Now().Format("2006-01-02")))

	// Model
	if b.model != "" {
		parts = append(parts, fmt.Sprintf("- Model: %s", b.model))
	}

	// Git status
	if isGitRepo(b.workdir) {
		parts = append(parts, "- Git repository: yes")
		if branch := gitBranch(b.workdir); branch != "" {
			parts = append(parts, fmt.Sprintf("- Git branch: %s", branch))
		}
	}

	return strings.Join(parts, "\n")
}

// toolGuidelines returns tool-specific usage instructions.
func (b *Builder) toolGuidelines() string {
	return `# Tool Usage Guidelines
- Use the Read tool to examine files before modifying them
- Use the Edit tool for targeted changes (prefer over Write for existing files)
- Use the Glob tool to find files by pattern
- Use the Grep tool to search file contents
- Use the Bash tool for commands like git, running tests, installing packages
- When running Bash commands, prefer short commands and check output before proceeding`
}

// claudeMDSection loads and returns CLAUDE.md content.
func (b *Builder) claudeMDSection() string {
	entries := LoadClaudeMD(b.workdir)
	merged := MergeClaudeMD(entries)
	if merged == "" {
		return ""
	}
	return fmt.Sprintf("# Project Instructions (from CLAUDE.md)\n\n%s", merged)
}

// memorySection loads MEMORY.md content if it exists.
func (b *Builder) memorySection() string {
	// Check for .claude/memory/MEMORY.md in the workspace
	memoryPaths := []string{
		filepath.Join(b.workdir, ".claude", "memory", "MEMORY.md"),
		filepath.Join(b.workdir, ".claude", "MEMORY.md"),
	}

	// Also check user-level memory
	if home, err := os.UserHomeDir(); err == nil {
		memoryPaths = append(memoryPaths, filepath.Join(home, ".claude", "MEMORY.md"))
	}

	for _, path := range memoryPaths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		content := strings.TrimSpace(string(data))
		if content == "" {
			continue
		}
		// Limit to ~200 lines (matching Claude Code behavior)
		lines := strings.Split(content, "\n")
		if len(lines) > 200 {
			lines = lines[:200]
			content = strings.Join(lines, "\n") + "\n... (memory truncated at 200 lines)"
		}
		return fmt.Sprintf("# Memory\n\n%s", content)
	}

	return ""
}

// isGitRepo checks if the directory is inside a git repository.
func isGitRepo(dir string) bool {
	cmd := exec.Command("git", "rev-parse", "--is-inside-work-tree")
	cmd.Dir = dir
	out, err := cmd.Output()
	return err == nil && strings.TrimSpace(string(out)) == "true"
}

// gitBranch returns the current git branch name.
func gitBranch(dir string) string {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
