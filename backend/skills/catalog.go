package skills

import (
	"strings"
	"time"

	"github.com/chatml/chatml-backend/models"
)

// BuiltInSkills is the hardcoded catalog of available skills.
// Note: UsageCount, Rating, and RatingCount are placeholder values for UI display.
// These are not dynamically tracked and serve as mock data for the skills store UI.
var BuiltInSkills = []models.Skill{
	// Development Workflows
	{
		ID:          "tdd-workflow",
		Name:        "Test-Driven Development",
		Description: "A rigorous TDD workflow that guides you through writing tests first, then implementation, following the Red-Green-Refactor cycle.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Red-Green-Refactor cycle with automated test generation",
		UsageCount:  1250,
		Rating:      4.7,
		RatingCount: 89,
		SkillPath:   "tdd-workflow.md",
		Content:     tddWorkflowContent,
		CreatedAt:   time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 20, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "systematic-debugging",
		Name:        "Systematic Debugging",
		Description: "A structured approach to debugging that helps identify root causes through hypothesis testing and log analysis.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Structured debugging with hypothesis testing",
		UsageCount:  980,
		Rating:      4.5,
		RatingCount: 67,
		SkillPath:   "systematic-debugging.md",
		Content:     systematicDebuggingContent,
		CreatedAt:   time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 18, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "code-review",
		Name:        "Code Review Assistant",
		Description: "Thorough code review skill that checks for bugs, security issues, performance problems, and adherence to best practices.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Comprehensive code review with security and performance checks",
		UsageCount:  856,
		Rating:      4.6,
		RatingCount: 54,
		SkillPath:   "code-review.md",
		Content:     codeReviewContent,
		CreatedAt:   time.Date(2025, 1, 16, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 22, 0, 0, 0, 0, time.UTC),
	},

	// Documentation & Planning
	{
		ID:          "brainstorming",
		Name:        "Brainstorming",
		Description: "Structured brainstorming skill that helps explore ideas, requirements, and design options before implementation.",
		Category:    models.SkillCategoryDocumentation,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Explore requirements and design before coding",
		UsageCount:  723,
		Rating:      4.4,
		RatingCount: 41,
		SkillPath:   "brainstorming.md",
		Content:     brainstormingContent,
		CreatedAt:   time.Date(2025, 1, 17, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 19, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "writing-plans",
		Name:        "Writing Implementation Plans",
		Description: "Create detailed implementation plans with clear steps, dependencies, and verification criteria.",
		Category:    models.SkillCategoryDocumentation,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Detailed implementation plans with clear steps",
		UsageCount:  612,
		Rating:      4.3,
		RatingCount: 38,
		SkillPath:   "writing-plans.md",
		Content:     writingPlansContent,
		CreatedAt:   time.Date(2025, 1, 18, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 21, 0, 0, 0, 0, time.UTC),
	},

	// Version Control
	{
		ID:          "git-commit-helper",
		Name:        "Git Commit Helper",
		Description: "Helps create well-structured git commits with meaningful messages following conventional commit format.",
		Category:    models.SkillCategoryVersionControl,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Conventional commits with meaningful messages",
		UsageCount:  1456,
		Rating:      4.8,
		RatingCount: 112,
		SkillPath:   "git-commit-helper.md",
		Content:     gitCommitHelperContent,
		CreatedAt:   time.Date(2025, 1, 14, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 23, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "pr-creation",
		Name:        "Pull Request Creation",
		Description: "Create well-documented pull requests with clear descriptions, test plans, and review guidelines.",
		Category:    models.SkillCategoryVersionControl,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Well-documented PRs with clear descriptions",
		UsageCount:  934,
		Rating:      4.5,
		RatingCount: 73,
		SkillPath:   "pr-creation.md",
		Content:     prCreationContent,
		CreatedAt:   time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 20, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "branch-management",
		Name:        "Branch Management",
		Description: "Best practices for git branch management including naming conventions, merging strategies, and cleanup.",
		Category:    models.SkillCategoryVersionControl,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Branch naming, merging, and cleanup best practices",
		UsageCount:  567,
		Rating:      4.2,
		RatingCount: 29,
		SkillPath:   "branch-management.md",
		Content:     branchManagementContent,
		CreatedAt:   time.Date(2025, 1, 19, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 24, 0, 0, 0, 0, time.UTC),
	},
}

// GetSkillByID returns a skill by its ID, or nil if not found
func GetSkillByID(id string) *models.Skill {
	for i := range BuiltInSkills {
		if BuiltInSkills[i].ID == id {
			return &BuiltInSkills[i]
		}
	}
	return nil
}

// FilterSkills filters skills by category and search query
func FilterSkills(category string, search string) []models.Skill {
	var result []models.Skill
	searchLower := strings.ToLower(search)

	for _, skill := range BuiltInSkills {
		// Filter by category
		if category != "" && string(skill.Category) != category {
			continue
		}
		// Filter by search (name, description, author)
		if search != "" {
			nameLower := strings.ToLower(skill.Name)
			descLower := strings.ToLower(skill.Description)
			authorLower := strings.ToLower(skill.Author)
			if !strings.Contains(nameLower, searchLower) &&
				!strings.Contains(descLower, searchLower) &&
				!strings.Contains(authorLower, searchLower) {
				continue
			}
		}
		result = append(result, skill)
	}
	return result
}

// Skill content as embedded strings
const tddWorkflowContent = `---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development Workflow

Follow the Red-Green-Refactor cycle:

## 1. Red Phase - Write Failing Test
- Write a test that describes the desired behavior
- Run the test to confirm it fails
- The failure message should clearly indicate what's missing

## 2. Green Phase - Make Test Pass
- Write the minimum code needed to pass the test
- Don't optimize or add extra features
- Focus only on making the test green

## 3. Refactor Phase - Improve Code
- Clean up the implementation
- Remove duplication
- Improve naming and structure
- Ensure tests still pass

## Guidelines
- One test at a time
- Small incremental steps
- Tests should be fast and isolated
- Test behavior, not implementation details
`

const systematicDebuggingContent = `---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior
---

# Systematic Debugging

## 1. Reproduce the Issue
- Document exact steps to reproduce
- Note the expected vs actual behavior
- Identify the minimal reproduction case

## 2. Form Hypotheses
- List possible causes (most likely first)
- Consider recent changes
- Check related code paths

## 3. Test Hypotheses
- Add logging/breakpoints strategically
- Test one hypothesis at a time
- Eliminate possibilities systematically

## 4. Fix and Verify
- Apply the fix
- Verify the original issue is resolved
- Check for regressions
- Add tests to prevent recurrence
`

const codeReviewContent = `---
name: code-review
description: Use when reviewing code changes for quality, security, and best practices
---

# Code Review Checklist

## Correctness
- [ ] Logic is correct and handles edge cases
- [ ] Error handling is appropriate
- [ ] No race conditions or concurrency issues

## Security
- [ ] No SQL injection, XSS, or command injection
- [ ] Sensitive data is protected
- [ ] Authentication/authorization is correct

## Performance
- [ ] No N+1 queries or unnecessary loops
- [ ] Resources are properly released
- [ ] Caching is used where appropriate

## Maintainability
- [ ] Code is readable and well-organized
- [ ] No unnecessary complexity
- [ ] Tests cover the changes
`

const brainstormingContent = `---
name: brainstorming
description: Use before any creative work - creating features, building components, adding functionality
---

# Brainstorming Skill

## 1. Understand the Goal
- What problem are we solving?
- Who is the user?
- What are the constraints?

## 2. Explore Options
- Generate multiple approaches
- Consider trade-offs
- Think about edge cases

## 3. Evaluate and Decide
- Compare options against requirements
- Consider implementation complexity
- Choose the best approach

## 4. Document Decision
- Record the chosen approach
- Note why alternatives were rejected
- List any open questions
`

const writingPlansContent = `---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task
---

# Writing Implementation Plans

## Plan Structure

### Overview
- Brief description of what will be implemented
- Key goals and constraints

### Steps
For each step include:
1. Clear description of what to do
2. Files to create/modify
3. Dependencies on other steps
4. Verification criteria

### Verification
- How to test the implementation
- Expected outcomes
- Edge cases to consider
`

const gitCommitHelperContent = `---
name: git-commit-helper
description: Use when creating git commits
---

# Git Commit Helper

## Commit Message Format

type(scope): subject

body (optional)

footer (optional)

## Types
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Adding tests
- chore: Maintenance

## Guidelines
- Subject line under 50 characters
- Use imperative mood ("Add" not "Added")
- Explain why, not what
- Reference issues when relevant
`

const prCreationContent = `---
name: pr-creation
description: Use when creating pull requests
---

# Pull Request Creation

## PR Title
- Clear, concise summary
- Include ticket number if applicable
- Use imperative mood

## PR Description

### Summary
Brief overview of changes

### Changes Made
- List key changes
- Explain architectural decisions

### Test Plan
- How to test the changes
- Expected behavior

### Screenshots
Include if UI changes

## Checklist
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
`

const branchManagementContent = `---
name: branch-management
description: Use for git branch operations
---

# Branch Management

## Branch Naming
- feature/description - new features
- fix/description - bug fixes
- refactor/description - code restructuring
- docs/description - documentation

## Best Practices
- Keep branches short-lived
- Rebase frequently from main
- Delete branches after merge
- Use descriptive names

## Merge Strategy
- Squash for feature branches
- Merge for release branches
- Rebase for keeping history clean
`
