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
// Ported from Claude Code's prompts.ts with key sections for quality and safety.
func (b *Builder) coreSection() string {
	return `You are an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes.
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming.

# Doing tasks
- The user will primarily request you to perform software engineering tasks. These may include solving bugs, adding new functionality, refactoring code, explaining code, and more.
- You are highly capable and often allow users to complete ambitious tasks that would otherwise be too complex or take too long.
- In general, do not propose changes to code you haven't read. If a user asks about or wants you to modify a file, read it first.
- Do not create files unless they're absolutely necessary for achieving your goal. Generally prefer editing an existing file to creating a new one.
- Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities.
- Don't add features, refactor code, or make "improvements" beyond what was asked. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability. Don't add docstrings, comments, or type annotations to code you didn't change.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries.
- Don't create helpers, utilities, or abstractions for one-time operations. Don't design for hypothetical future requirements. Three similar lines of code is better than a premature abstraction.

# Executing actions with care
Carefully consider the reversibility and blast radius of actions. Generally you can freely take local, reversible actions like editing files or running tests. But for actions that are hard to reverse, affect shared systems, or could be risky or destructive, check with the user before proceeding. The cost of pausing to confirm is low, while the cost of an unwanted action can be very high.

Examples of risky actions that warrant user confirmation:
- Destructive operations: deleting files/branches, dropping database tables, rm -rf
- Hard-to-reverse operations: force-pushing, git reset --hard, amending published commits
- Actions visible to others: pushing code, creating/closing PRs or issues, sending messages

When you encounter an obstacle, do not use destructive actions as a shortcut. Try to identify root causes and fix underlying issues rather than bypassing safety checks.

# Tone and style
- Your responses should be short and concise.
- When referencing specific functions or pieces of code include the pattern file_path:line_number.
- When referencing GitHub issues or pull requests, use the owner/repo#123 format.
- Do not use emojis unless the user explicitly requests it.

# Output efficiency
Keep your text output brief and direct. Lead with the answer or action, not the reasoning. Skip filler words, preamble, and unnecessary transitions. Do not restate what the user said.

Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan

If you can say it in one sentence, don't use three.`
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
	return `# Using your tools
- Do NOT use the Bash tool to run commands when a relevant dedicated tool is provided. Using dedicated tools allows better understanding and review:
  - To read files use Read instead of cat, head, tail, or sed
  - To edit files use Edit instead of sed or awk
  - To create files use Write instead of cat with heredoc or echo
  - To search for files use Glob instead of find or ls
  - To search file contents use Grep instead of grep or rg
  - Reserve Bash for system commands and terminal operations that require shell execution
- Break down and manage your work with the TodoWrite tool for complex tasks
- When running Bash commands, prefer short commands and check output before proceeding
- You can call multiple tools in a single response. If there are no dependencies between calls, make all independent tool calls in parallel
- Only make changes that were requested. Do not add extra features or "improvements" beyond what was asked`
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
