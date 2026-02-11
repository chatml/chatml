# Skills System

Skills are specialized prompt templates that augment Claude's capabilities for specific tasks. They provide structured guidance, checklists, and methodologies that the AI follows when performing particular types of work.

## How Skills Work

A skill is a Markdown document with frontmatter metadata. When a skill is installed for a session, its content is injected into the system prompt, giving Claude domain-specific expertise and methodology to follow.

Skills don't add new tools or modify the agent's capabilities — they augment the agent's behavior through prompt engineering. A "Code Review" skill, for example, provides a structured checklist of what to examine (correctness, security, performance, maintainability) and how to give feedback.

## Skill Model

**File: `backend/models/skill.go`**

```go
type Skill struct {
    ID          string
    Name        string
    Description string
    Category    SkillCategory
    Author      string
    Version     string
    Preview     string       // Short preview text
    SkillPath   string       // Identifier path
    Content     string       // Full Markdown content
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```

### Categories

| Category | Skills |
|----------|--------|
| **Development** | TDD, Unit Testing, Debugging, Code Review, API Design, Refactoring, Performance |
| **Security** | Security Audit, Dependency Review |
| **Documentation** | Brainstorming, Writing Plans, ADRs, Technical Writing, Project Scaffolding |
| **Version Control** | Git Commits, PR Creation, Branch Management, Code Migration, Accessibility Audit |

## Built-In Skills Catalog

**File: `backend/skills/catalog.go`**

ChatML ships with 19 built-in skills:

### Development Skills

**Test-Driven Development** (`tdd-workflow`)
Guides the Red-Green-Refactor cycle: write a failing test, make it pass with minimal code, then refactor. Includes checklists for each phase and guidelines on when to break the cycle.

**Unit Testing Guide** (`unit-testing`)
Comprehensive test writing guidance covering test structure, patterns, test doubles (mocks, stubs, spies), async testing, error path coverage, and framework-specific guidance for Vitest, Go, pytest, and Rust.

**Systematic Debugging** (`systematic-debugging`)
A structured five-step process: reproduce the issue, gather evidence, form hypotheses (ranked by likelihood), test one hypothesis at a time, then fix and verify. Includes a table of common debugging traps.

**Code Review Assistant** (`code-review`)
A thorough review methodology covering correctness (logic, edge cases, concurrency), security (injection, auth, secrets), performance (N+1 queries, resource leaks), and maintainability (readability, complexity, test coverage). Includes guidance on giving constructive feedback.

**API Design** (`api-design`)
REST and GraphQL API conventions including endpoint naming, versioning, error response formats, pagination patterns, and documentation standards.

**Refactoring Guide** (`refactoring-guide`)
Safe refactoring methodology: identify scope, break into phases, maintain tests throughout, avoid breaking changes. Includes strategies for large-scale refactoring.

**Performance Optimization** (`performance-optimization`)
Profiling strategy, identifying N+1 queries, memory leak detection, caching patterns, and lazy loading techniques.

### Security Skills

**Security Audit** (`security-audit`)
OWASP Top 10 vulnerability audit covering injection, broken authentication, XSS, CSRF, secrets exposure, and insecure dependencies. Includes red-flag patterns to watch for.

**Dependency Review** (`dependency-review`)
Evaluation framework for third-party dependencies: license compatibility, maintenance health indicators, security history, bundle size impact, and alternative analysis.

### Documentation Skills

**Brainstorming** (`brainstorming`)
A five-phase structured process: define the problem, identify constraints, explore approaches (2-4 options with pros/cons/effort/risk), evaluate and decide, and capture open questions.

**Writing Implementation Plans** (`writing-plans`)
Plan template with sections for overview, files to modify, numbered steps (with dependencies and verification), and a completion checklist.

**Architecture Decision Records** (`architecture-decision-records`)
ADR format for capturing architectural decisions: context, decision, alternatives considered, consequences, and status tracking.

**Technical Writing** (`technical-writing`)
Guidelines for writing READMEs, API guides, runbooks, and onboarding docs with consistent structure and tone.

**Project Scaffolding** (`project-scaffolding`)
New project setup guidance: directory structure, tooling selection, CI/CD configuration, linting setup, testing framework, and initial configuration.

### Version Control Skills

**Git Commit Helper** (`git-commit-helper`)
Conventional commit message format with type prefixes (feat, fix, refactor, docs, test, chore, style, perf), scope guidelines, body writing advice, and a pre-commit checklist.

**Pull Request Creation** (`pr-creation`)
PR best practices: title format (under 70 characters, imperative mood), description template (summary, changes, test plan, screenshots), sizing guidelines, and pre-review checklist.

**Branch Management** (`branch-management`)
Branch naming conventions (prefix/description), lifecycle management (create, keep updated, merge, delete), merging strategies (squash vs merge vs rebase), and conflict resolution.

**Code Migration** (`code-migration`)
Migration planning for language, framework, or library migrations: compatibility analysis, incremental strategy, testing at each step, and rollback procedures.

**Accessibility Audit** (`accessibility-audit`)
WCAG compliance checking: semantic HTML, ARIA attributes, keyboard navigation, color contrast, and screen reader support.

## Skill API

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/skills/` | List all available skills (with optional category/search filters) |
| `GET` | `/api/skills/installed` | List skills installed for the current context |
| `POST` | `/api/skills/{id}/install` | Install a skill |
| `DELETE` | `/api/skills/{id}/uninstall` | Uninstall a skill |
| `GET` | `/api/skills/{id}/content` | Get the full skill content |

### Filtering

Skills can be filtered by category and searched by name, description, or author:

```go
func FilterSkills(category string, search string) []models.Skill {
    // Filter by category if specified
    // Search across name, description, and author (case-insensitive)
}
```

## Skill Content Format

Each skill's content is a Markdown document with YAML frontmatter:

```markdown
---
name: skill-name
description: Brief description of the skill
category: development
version: 1.0.0
---

# Skill Title

Introductory paragraph explaining the skill's purpose.

## Section 1

Content with guidelines, checklists, tables, and examples.

## Section 2

More structured guidance...
```

The content uses Markdown features extensively:
- **Tables** for comparing options or listing guidelines
- **Checklists** for step-by-step verification
- **Code blocks** for examples
- **Blockquotes** for important notes

## Related Documentation

- [Product Overview](../product-overview.md)
- [Claude Agent SDK Integration](./claude-agent-sdk-integration.md)
