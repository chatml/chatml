package skills

import (
	"strings"
	"time"

	"github.com/chatml/chatml-backend/models"
)

// BuiltInSkills is the hardcoded catalog of available skills.
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
		SkillPath:   "tdd-workflow.md",
		Content:     tddWorkflowContent,
		CreatedAt:   time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 20, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "unit-testing",
		Name:        "Unit Testing Guide",
		Description: "Write effective unit tests across languages — test structure, patterns, doubles, async testing, error paths, anti-patterns, and framework-specific guidance for Vitest, Go, pytest, and Rust.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Comprehensive test writing with patterns, doubles, and polyglot guidance",
		SkillPath:   "unit-testing.md",
		Content:     unitTestingContent,
		CreatedAt:   time.Date(2025, 2, 10, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 10, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "systematic-debugging",
		Name:        "Systematic Debugging",
		Description: "A structured approach to debugging that helps identify root causes through hypothesis testing and log analysis.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Structured debugging with hypothesis testing",
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
		SkillPath:   "code-review.md",
		Content:     codeReviewContent,
		CreatedAt:   time.Date(2025, 1, 16, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 22, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "api-design",
		Name:        "API Design",
		Description: "Design REST and GraphQL APIs with consistent conventions — endpoint naming, versioning, error responses, pagination, and documentation.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Consistent API conventions and endpoint design",
		SkillPath:   "api-design.md",
		Content:     apiDesignContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "refactoring-guide",
		Name:        "Refactoring Guide",
		Description: "Plan and execute large refactors safely — identify scope, break into phases, maintain tests, and avoid breaking changes.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Safe, phased refactoring with test coverage",
		SkillPath:   "refactoring-guide.md",
		Content:     refactoringGuideContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "performance-optimization",
		Name:        "Performance Optimization",
		Description: "Find and fix performance bottlenecks — profiling strategy, N+1 queries, memory leaks, caching, and lazy loading.",
		Category:    models.SkillCategoryDevelopment,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Profile, identify, and fix performance bottlenecks",
		SkillPath:   "performance-optimization.md",
		Content:     performanceOptimizationContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},

	// Security
	{
		ID:          "security-audit",
		Name:        "Security Audit",
		Description: "Audit code for OWASP Top 10 vulnerabilities — injection, broken auth, XSS, CSRF, secrets exposure, and insecure dependencies.",
		Category:    models.SkillCategorySecurity,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "OWASP Top 10 vulnerability audit",
		SkillPath:   "security-audit.md",
		Content:     securityAuditContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "dependency-review",
		Name:        "Dependency Review",
		Description: "Evaluate third-party dependencies before adopting — license, maintenance health, security history, bundle size, and alternatives.",
		Category:    models.SkillCategorySecurity,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Evaluate dependencies before adoption",
		SkillPath:   "dependency-review.md",
		Content:     dependencyReviewContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
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
		SkillPath:   "writing-plans.md",
		Content:     writingPlansContent,
		CreatedAt:   time.Date(2025, 1, 18, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 21, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "architecture-decision-records",
		Name:        "Architecture Decision Records",
		Description: "Capture architectural decisions in a structured format — context, decision, consequences, and status tracking.",
		Category:    models.SkillCategoryDocumentation,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Structured format for capturing architecture decisions",
		SkillPath:   "architecture-decision-records.md",
		Content:     architectureDecisionRecordsContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "technical-writing",
		Name:        "Technical Writing",
		Description: "Write clear technical documentation — READMEs, API guides, runbooks, and onboarding docs with consistent structure and tone.",
		Category:    models.SkillCategoryDocumentation,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Clear, structured technical documentation",
		SkillPath:   "technical-writing.md",
		Content:     technicalWritingContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "project-scaffolding",
		Name:        "Project Scaffolding",
		Description: "Set up new projects from scratch — directory structure, tooling, CI/CD, linting, testing framework, and initial configuration.",
		Category:    models.SkillCategoryDocumentation,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "New project setup with tooling and CI/CD",
		SkillPath:   "project-scaffolding.md",
		Content:     projectScaffoldingContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
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
		SkillPath:   "branch-management.md",
		Content:     branchManagementContent,
		CreatedAt:   time.Date(2025, 1, 19, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 1, 24, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "code-migration",
		Name:        "Code Migration Guide",
		Description: "Plan and execute language, framework, or library migrations — compatibility analysis, incremental strategy, and rollback procedures.",
		Category:    models.SkillCategoryVersionControl,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "Plan and execute framework or library migrations",
		SkillPath:   "code-migration.md",
		Content:     codeMigrationContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
	},
	{
		ID:          "accessibility-audit",
		Name:        "Accessibility Audit",
		Description: "Audit UI components for WCAG compliance — semantic HTML, ARIA attributes, keyboard navigation, color contrast, and screen reader support.",
		Category:    models.SkillCategoryVersionControl,
		Author:      "ChatML Team",
		Version:     "1.0.0",
		Preview:     "WCAG compliance audit for UI components",
		SkillPath:   "accessibility-audit.md",
		Content:     accessibilityAuditContent,
		CreatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
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
description: A rigorous TDD workflow following the Red-Green-Refactor cycle
category: development
version: 1.0.0
---

# Test-Driven Development

A disciplined approach to writing software by writing tests before implementation. Every feature or bugfix starts with a failing test.

## The Red-Green-Refactor Cycle

### 1. Red — Write a Failing Test

Start by writing a test that describes the **desired behavior**, not the implementation.

- Focus on one small piece of functionality at a time
- The test name should read like a specification: ` + "`" + `it should return an error when the input is empty` + "`" + `
- Run the test and confirm it fails with a clear, expected error message
- If the test passes immediately, it is not testing anything new

**Checklist:**

- [ ] Test describes behavior, not implementation
- [ ] Test fails for the right reason
- [ ] Failure message clearly indicates what is missing

### 2. Green — Make the Test Pass

Write the **minimum code** needed to make the test pass. Nothing more.

- Do not optimize, do not handle extra edge cases, do not refactor
- It is fine if the code looks ugly — correctness first
- If you are tempted to add more logic, write another test for it instead
- Run the full test suite to confirm nothing else broke

**Checklist:**

- [ ] Only the code needed for this test was added
- [ ] The failing test now passes
- [ ] All other tests still pass

### 3. Refactor — Improve the Code

Now that the test is green, clean up while keeping all tests passing.

- Remove duplication between implementation and tests
- Improve naming, extract functions, simplify logic
- Run tests after every change — if anything goes red, undo immediately
- This is the only phase where you restructure code

**Checklist:**

- [ ] Duplication removed
- [ ] Naming is clear and consistent
- [ ] All tests still pass after each change

## Guidelines

| Principle | Why |
|---|---|
| One test at a time | Keeps the feedback loop tight and changes small |
| Test behavior, not implementation | Tests survive refactors; implementation-coupled tests break constantly |
| Fast tests | A slow suite discourages running tests; aim for milliseconds per test |
| Isolated tests | No shared state, no test ordering dependencies, no filesystem or network unless necessary |
| Descriptive test names | The test name is documentation; a reader should understand the requirement without reading the code |

## When to Break the Cycle

TDD is not always the right approach. Skip it when:

- Writing exploratory or throwaway code (spikes)
- The test would just duplicate the implementation (trivial getters, simple config)
- You are learning a new API and need to experiment first

In these cases, write tests **after** — but always write them.
`

const systematicDebuggingContent = `---
name: systematic-debugging
description: A structured approach to identifying root causes through hypothesis testing
category: development
version: 1.0.0
---

# Systematic Debugging

A methodical process for finding and fixing bugs. Resist the urge to change code randomly — form a hypothesis, test it, and narrow down the cause.

## Step 1: Reproduce the Issue

You cannot fix what you cannot see. Before anything else, get a reliable reproduction.

- **Document exact steps** — what input, what action, what sequence
- **Note expected vs actual behavior** — be precise: "returns 404" not "it doesn't work"
- **Find the minimal reproduction** — strip away unrelated code and data until you have the smallest case that still fails
- **Check if it is environment-specific** — does it happen locally? In CI? Only on certain OS versions?

> If you cannot reproduce the bug, add logging and monitoring, then wait for it to happen again. Do not guess.

## Step 2: Gather Evidence

Before forming hypotheses, collect facts.

- **Read the error message carefully** — stack traces, error codes, and log timestamps are direct evidence
- **Check recent changes** — use ` + "`" + `git log --oneline -20` + "`" + ` and ` + "`" + `git diff` + "`" + ` to see what changed
- **Search for related issues** — has this been reported before? Is there a known pattern?
- **Identify the boundary** — where does the system transition from working to broken? Which layer, which function, which line?

## Step 3: Form Hypotheses

List possible causes ranked from most to least likely.

| # | Hypothesis | Likelihood | How to Test |
|---|---|---|---|
| 1 | Recent change to X broke Y | High | Revert commit, retest |
| 2 | Race condition in async handler | Medium | Add mutex, check ordering |
| 3 | Stale cache returning old data | Low | Clear cache, compare results |

**Rules:**

- Write hypotheses down — do not keep them in your head
- Rank by likelihood based on evidence, not gut feeling
- Each hypothesis must have a concrete test to prove or disprove it

## Step 4: Test One Hypothesis at a Time

Isolate each hypothesis and test it. Change one thing, observe the result.

- **Add targeted logging** — log the specific values or state transitions relevant to this hypothesis
- **Use binary search** — if the bug was introduced by a change, use ` + "`" + `git bisect` + "`" + ` to find the exact commit
- **Eliminate before continuing** — if a hypothesis is disproven, mark it off and move to the next
- **Do not change multiple things at once** — you will not know which change fixed it

## Step 5: Fix and Verify

Once you have identified the root cause:

1. **Write a failing test** that reproduces the bug
2. **Apply the minimal fix** — do not refactor adjacent code in the same change
3. **Run the full test suite** — confirm no regressions
4. **Verify in the original context** — does the original reproduction case now work?
5. **Check for related instances** — is the same pattern used elsewhere? Could the same bug exist in similar code?

## Common Debugging Traps

| Trap | Better Approach |
|---|---|
| Changing code randomly hoping it works | Form a hypothesis first |
| Fixing symptoms instead of root cause | Ask "why?" five times to dig deeper |
| Not reading the full error message | Read every line of the stack trace |
| Assuming the bug is in someone else's code | Verify your own code first |
| Debugging for hours without a break | Step away; fresh eyes find bugs faster |
`

const codeReviewContent = `---
name: code-review
description: A thorough code review process checking correctness, security, and maintainability
category: development
version: 1.0.0
---

# Code Review

A systematic approach to reviewing code changes. The goal is to catch bugs, security issues, and maintainability problems before they reach production.

## Before You Start

- Read the PR description and linked issue to understand the intent
- Check the diff size — if it is very large, ask the author to split it
- Note: you are reviewing the **change**, not the entire file

## 1. Correctness

The code should do what it claims to do.

- **Logic** — trace through the main code paths mentally. Does the logic match the stated intent?
- **Edge cases** — what happens with empty input, null values, zero, negative numbers, maximum values?
- **Error handling** — are errors caught, propagated, and reported correctly? Are there silent failures?
- **Concurrency** — if the code runs in parallel, are there race conditions? Is shared state protected?
- **Off-by-one errors** — check loop bounds, slice indices, and pagination

**Ask:**
- What happens if this input is empty?
- What happens if this external call fails?
- Is there a path where a variable is used before being initialized?

## 2. Security

Every change is a potential attack surface.

- **Injection** — is user input escaped before being used in SQL, shell commands, or HTML?
- **Authentication** — does this endpoint check that the user is logged in?
- **Authorization** — does it check that the user has permission for this specific resource?
- **Secrets** — are API keys, passwords, or tokens hardcoded or logged?
- **Dependencies** — does a new dependency introduce known vulnerabilities?

**Red flags:**

| Pattern | Risk |
|---|---|
| String concatenation in SQL queries | SQL injection |
| ` + "`" + `dangerouslySetInnerHTML` + "`" + ` or unescaped template output | XSS |
| ` + "`" + `exec()` + "`" + ` or ` + "`" + `eval()` + "`" + ` with user input | Command injection |
| Hardcoded credentials | Secret exposure |
| ` + "`" + `.env` + "`" + ` files committed | Secret exposure |

## 3. Performance

Look for obvious performance problems, not micro-optimizations.

- **N+1 queries** — is there a loop that makes a database call on each iteration?
- **Unbounded data** — is the code loading an entire table or collection into memory?
- **Missing indexes** — if new queries are added, do the relevant indexes exist?
- **Resource leaks** — are file handles, connections, and goroutines/threads properly closed?
- **Caching** — could a repeated expensive operation benefit from caching?

## 4. Maintainability

Code is read far more often than it is written.

- **Readability** — can you understand the code without asking the author to explain it?
- **Naming** — do variables and functions describe what they hold or do?
- **Complexity** — are there deeply nested conditionals that could be simplified?
- **Duplication** — is the same logic repeated in multiple places?
- **Test coverage** — are the new code paths tested? Do the tests test behavior or implementation details?

## 5. How to Give Feedback

- **Be specific** — "this could fail if ` + "`" + `user` + "`" + ` is nil on line 42" is better than "add null checks"
- **Distinguish blocking from non-blocking** — prefix suggestions with "nit:" or "optional:" when they are not required
- **Explain why** — "this is an N+1 query because the loop calls ` + "`" + `getUser()` + "`" + ` on each comment" is better than "fix the query"
- **Offer alternatives** — if you are suggesting a change, show the code you have in mind
- **Acknowledge good work** — if something is well-done, say so
`

const brainstormingContent = `---
name: brainstorming
description: A structured process for exploring ideas and requirements before implementation
category: documentation
version: 1.0.0
---

# Brainstorming

A structured process for thinking through a problem before writing code. The goal is to arrive at a clear, well-reasoned approach — not to generate as many ideas as possible.

## Phase 1: Define the Problem

Before exploring solutions, make sure you understand the problem.

**Questions to answer:**

- **What** is the user trying to accomplish?
- **Why** does this matter? What is the pain point or opportunity?
- **Who** is affected? A single user role, multiple roles, or internal tooling?
- **Where** does this fit in the existing system? Is it a new feature, an extension of something existing, or a replacement?

**Output:** A single paragraph describing the problem in plain language. If you cannot write this clearly, you do not understand the problem yet.

## Phase 2: Identify Constraints

Constraints narrow the solution space and prevent wasted effort.

| Constraint Type | Questions |
|---|---|
| Technical | What frameworks, languages, and APIs are we working with? What is already built? |
| Scope | What is explicitly out of scope? What is the minimum viable version? |
| Time | Is there a deadline? Should we optimize for speed of delivery or long-term quality? |
| Compatibility | Does this need to work with existing data, APIs, or UI patterns? |
| Performance | Are there latency, throughput, or memory requirements? |

## Phase 3: Explore Approaches

Generate 2-4 distinct approaches. For each one:

### Approach Template

**Name:** _Short descriptive name_

**How it works:** _One paragraph explaining the approach_

**Pros:**
- _Advantage 1_
- _Advantage 2_

**Cons:**
- _Disadvantage 1_
- _Disadvantage 2_

**Effort:** _Low / Medium / High_

**Risk:** _What could go wrong?_

> Do not evaluate while generating. List all reasonable approaches first, then compare.

## Phase 4: Evaluate and Decide

Compare the approaches against the constraints from Phase 2.

**Decision criteria (rank by importance for this project):**

1. Correctness — does it solve the problem fully?
2. Simplicity — is it the simplest approach that works?
3. Effort — can we build it within the time constraint?
4. Extensibility — will we need to modify this soon, and does the approach allow for that?

**Choose one approach** and write a one-sentence justification: _"We are going with [approach] because [reason]."_

## Phase 5: Capture Open Questions

List anything unresolved that needs to be answered before or during implementation.

- _Question 1 — who can answer this?_
- _Question 2 — can we defer this decision?_
- _Question 3 — what assumption are we making?_

Do not proceed to implementation with critical open questions. Resolve them first or flag them as risks.
`

const writingPlansContent = `---
name: writing-plans
description: Create detailed implementation plans with steps, dependencies, and verification
category: documentation
version: 1.0.0
---

# Writing Implementation Plans

A good plan reduces ambiguity, surfaces problems early, and gives your future self (or another developer) a clear roadmap to follow.

## Plan Structure

Every plan should have these sections:

### 1. Overview

A short summary of what will be built and why.

- **Goal:** One sentence describing the end result
- **Context:** Why this is needed now (link to issue or discussion)
- **Scope:** What is included and what is explicitly excluded

### 2. Files to Modify

List every file that will be created or changed. This forces you to think through the full scope.

| File | Action | Purpose |
|---|---|---|
| ` + "`" + `src/components/Auth.tsx` + "`" + ` | Modify | Add logout button |
| ` + "`" + `src/lib/auth.ts` + "`" + ` | Modify | Add logout API call |
| ` + "`" + `src/components/Auth.test.tsx` + "`" + ` | Create | Test logout flow |

### 3. Steps

Break the work into numbered steps. Each step should be independently verifiable.

**For each step:**

- **What:** Clear description of the change
- **How:** Key implementation details — not pseudocode, but enough that you will not have to re-think it later
- **Depends on:** Which previous steps must be complete first
- **Verify:** How to confirm this step is done correctly

**Example:**

> **Step 1: Add logout API function**
>
> Add ` + "`" + `logout()` + "`" + ` to ` + "`" + `src/lib/auth.ts` + "`" + ` that calls ` + "`" + `POST /api/auth/logout` + "`" + ` and clears the local session token.
>
> Depends on: None
>
> Verify: Unit test calls the function and confirms the token is cleared

### 4. Verification

How to confirm the entire plan is complete:

- [ ] All tests pass (` + "`" + `npm test` + "`" + ` / ` + "`" + `go test ./...` + "`" + `)
- [ ] Lint passes (` + "`" + `npm run lint` + "`" + `)
- [ ] Build succeeds (` + "`" + `npm run build` + "`" + `)
- [ ] Manual testing: _describe the scenario to walk through_

## Guidelines

| Do | Don't |
|---|---|
| Keep steps small and focused | Combine multiple unrelated changes in one step |
| List files explicitly | Say "update relevant files" |
| Include verification for each step | Leave testing until the end |
| Note dependencies between steps | Assume steps can be done in any order |
| Write the plan before coding | Plan and code simultaneously |

## When to Skip a Plan

Not everything needs a formal plan:

- Single-file bug fixes with an obvious cause
- Typo corrections and small copy changes
- Changes where the user has already specified the exact implementation

If you can describe the entire change in one sentence, a plan adds overhead without value.
`

const gitCommitHelperContent = `---
name: git-commit-helper
description: Create well-structured commits with meaningful messages
category: version-control
version: 1.0.0
---

# Git Commit Helper

Good commit messages make a project's history useful. A reader should be able to understand **what changed and why** from the commit log alone.

## Commit Message Format

` + "```" + `
type(scope): short summary in imperative mood

Optional body explaining the motivation for the change.
Wrap at 72 characters. Explain what and why, not how.

Optional footer with references or breaking change notes.
Refs: #123
` + "```" + `

### Types

| Type | When to use | Example |
|---|---|---|
| ` + "`" + `feat` + "`" + ` | New functionality | ` + "`" + `feat(auth): add password reset flow` + "`" + ` |
| ` + "`" + `fix` + "`" + ` | Bug fix | ` + "`" + `fix(api): return 404 for missing users` + "`" + ` |
| ` + "`" + `refactor` + "`" + ` | Code restructuring without behavior change | ` + "`" + `refactor(db): extract query builder` + "`" + ` |
| ` + "`" + `docs` + "`" + ` | Documentation only | ` + "`" + `docs: update API authentication guide` + "`" + ` |
| ` + "`" + `test` + "`" + ` | Adding or fixing tests | ` + "`" + `test(auth): add login edge case tests` + "`" + ` |
| ` + "`" + `chore` + "`" + ` | Build, CI, tooling, dependencies | ` + "`" + `chore: upgrade Go to 1.23` + "`" + ` |
| ` + "`" + `style` + "`" + ` | Formatting, whitespace, semicolons | ` + "`" + `style: fix indentation in handlers` + "`" + ` |
| ` + "`" + `perf` + "`" + ` | Performance improvement | ` + "`" + `perf(query): add index for user lookup` + "`" + ` |

### Scope

The scope is optional but helpful. It identifies which part of the codebase changed:

- ` + "`" + `auth` + "`" + `, ` + "`" + `api` + "`" + `, ` + "`" + `db` + "`" + `, ` + "`" + `ui` + "`" + `, ` + "`" + `cli` + "`" + ` — module or layer
- ` + "`" + `skills` + "`" + `, ` + "`" + `sessions` + "`" + `, ` + "`" + `workspaces` + "`" + ` — feature area

## Writing Good Summaries

**Do:**
- Use imperative mood — "add", "fix", "remove" (not "added", "fixes", "removed")
- Keep it under 50 characters
- Start with a lowercase letter after the type prefix
- Be specific — "fix login redirect loop" not "fix bug"

**Don't:**
- End with a period
- Write "misc changes" or "updates"
- Describe what you did — describe what the commit **does to the codebase**

## Writing the Body

The body is for explaining **why**, not **what** (the diff shows what).

Good body:

` + "```" + `
The previous implementation checked permissions after loading the
full resource, causing unnecessary database queries for unauthorized
users. Moving the auth check before the data fetch reduces load on
the database and returns 403 faster.
` + "```" + `

## When to Split Commits

One commit should represent one logical change. Split when:

- You are fixing a bug AND refactoring nearby code — two commits
- You are adding a feature AND updating tests — one commit (tests are part of the feature)
- You are renaming across many files — one commit for the rename, separate commits for behavior changes

## Pre-Commit Checklist

Before committing, verify:

- [ ] ` + "`" + `git diff --staged` + "`" + ` shows only the intended changes
- [ ] No debug code (` + "`" + `console.log` + "`" + `, ` + "`" + `fmt.Println` + "`" + `, ` + "`" + `TODO` + "`" + ` hacks)
- [ ] No secrets (` + "`" + `.env` + "`" + ` files, API keys, passwords)
- [ ] Tests pass
- [ ] Lint passes
`

const prCreationContent = `---
name: pr-creation
description: Create well-documented pull requests with clear descriptions and test plans
category: version-control
version: 1.0.0
---

# Pull Request Creation

A good PR is easy to review, clearly explains its purpose, and gives reviewers confidence that the change is correct.

## PR Title

The title should communicate the change at a glance.

- Keep it under 70 characters
- Use imperative mood: "Add logout button" not "Added logout button"
- Include a ticket reference if applicable: "Add logout button (CHA-42)"
- Be specific: "Fix null pointer in session cleanup" not "Fix crash"

## PR Description

Use this structure:

### Summary

1-3 bullet points explaining what this PR does and why. A reviewer should understand the purpose without reading the code.

### Changes Made

List the key changes grouped logically:

- **Auth module** — Added ` + "`" + `logout()` + "`" + ` function, clears session token on call
- **Header component** — Added logout button, wired to auth module
- **Tests** — Added unit tests for logout flow, updated header snapshot

### Test Plan

Describe how to verify the change works:

- [ ] Run ` + "`" + `npm test` + "`" + ` — all tests pass
- [ ] Run ` + "`" + `npm run build` + "`" + ` — build succeeds
- [ ] Manual test: click logout button, confirm redirect to login page
- [ ] Manual test: after logout, confirm accessing /dashboard returns 401

### Screenshots

Include before/after screenshots for any UI change. Annotate if the change is subtle.

## Sizing Guidelines

| PR Size | Lines Changed | Review Time | Recommendation |
|---|---|---|---|
| Small | < 100 | 15 min | Ideal |
| Medium | 100-300 | 30 min | Acceptable |
| Large | 300-500 | 1 hour | Consider splitting |
| Too large | 500+ | Hours | Split into smaller PRs |

Large PRs get worse reviews. If your PR is large, consider:

- Can the refactoring be a separate PR?
- Can the feature be split into incremental steps?
- Can tests be submitted separately (when adding a new test file)?

## Checklist Before Requesting Review

- [ ] Branch is up to date with the target branch
- [ ] All tests pass
- [ ] Lint passes with no new warnings
- [ ] Build succeeds
- [ ] PR description is complete
- [ ] No ` + "`" + `.env` + "`" + `, credentials, or debug code included
- [ ] Self-reviewed the diff one final time

## Responding to Review Feedback

- Respond to every comment, even if just "Done"
- If you disagree, explain your reasoning — do not just dismiss
- Push fixes as new commits during review (easier to re-review); squash before merge
- Re-request review after addressing all comments
`

const branchManagementContent = `---
name: branch-management
description: Git branch naming conventions, merging strategies, and cleanup practices
category: version-control
version: 1.0.0
---

# Branch Management

Consistent branch practices keep the repository clean and make collaboration predictable.

## Branch Naming

Use a prefix that describes the type of work, followed by a short kebab-case description:

| Prefix | Purpose | Example |
|---|---|---|
| ` + "`" + `feature/` + "`" + ` | New functionality | ` + "`" + `feature/user-profile-page` + "`" + ` |
| ` + "`" + `fix/` + "`" + ` | Bug fix | ` + "`" + `fix/login-redirect-loop` + "`" + ` |
| ` + "`" + `refactor/` + "`" + ` | Code restructuring | ` + "`" + `refactor/extract-auth-module` + "`" + ` |
| ` + "`" + `docs/` + "`" + ` | Documentation | ` + "`" + `docs/api-authentication-guide` + "`" + ` |
| ` + "`" + `chore/` + "`" + ` | Build, CI, deps | ` + "`" + `chore/upgrade-go-1.23` + "`" + ` |
| ` + "`" + `test/` + "`" + ` | Test additions | ` + "`" + `test/session-cleanup-edge-cases` + "`" + ` |

**Rules:**

- Use lowercase and hyphens only — no underscores, no spaces, no uppercase
- Keep it short but descriptive — a reader should understand the purpose without opening the PR
- Include ticket numbers when applicable: ` + "`" + `fix/CHA-42-login-redirect` + "`" + `
- Never work directly on ` + "`" + `main` + "`" + ` or ` + "`" + `master` + "`" + `

## Branch Lifecycle

### Creating a Branch

Always branch from an up-to-date main:

` + "```" + `bash
git checkout main
git pull origin main
git checkout -b feature/my-feature
` + "```" + `

### Keeping Up to Date

Rebase onto main regularly to avoid large merge conflicts later:

` + "```" + `bash
git fetch origin
git rebase origin/main
` + "```" + `

If there are conflicts, resolve them now while the diff is small rather than at PR time when it is large.

### Merging

| Strategy | When to use | Result |
|---|---|---|
| **Squash merge** | Feature branches with messy commit history | Clean single commit on main |
| **Merge commit** | Release branches or long-lived branches | Preserves full history |
| **Rebase merge** | Small branches with clean commits | Linear history, no merge commit |

**Default recommendation:** Squash merge for feature branches. It keeps main history clean and each commit on main represents a complete, working change.

### Deleting After Merge

Delete branches after they are merged:

` + "```" + `bash
# Delete local branch
git branch -d feature/my-feature

# Delete remote branch
git push origin --delete feature/my-feature
` + "```" + `

Stale branches clutter the repository. If a branch has been inactive for more than 2 weeks, either finish it, rebase it, or delete it.

## Best Practices

| Do | Don't |
|---|---|
| Keep branches short-lived (days, not weeks) | Let branches diverge from main for long periods |
| One branch per feature or fix | Combine unrelated changes in a single branch |
| Rebase onto main before opening a PR | Merge main into your branch (creates unnecessary merge commits) |
| Delete branches after merge | Accumulate stale branches |
| Use descriptive branch names | Use names like ` + "`" + `fix-stuff` + "`" + ` or ` + "`" + `test-branch` + "`" + ` |

## Handling Conflicts

When you encounter merge conflicts:

1. **Read the conflict markers carefully** — understand what both sides intended
2. **Keep the correct behavior**, not just "accept theirs" or "accept mine"
3. **Run tests after resolving** — conflicts can introduce subtle bugs
4. **If unsure, ask** — do not guess at the intent of someone else's code
`
