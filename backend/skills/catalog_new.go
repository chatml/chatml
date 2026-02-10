package skills

// New skill content constants (batch 2 - expanded catalog)

const apiDesignContent = `---
name: api-design
description: Design REST and GraphQL APIs with consistent conventions
category: development
version: 1.0.0
---

# API Design

A structured approach to designing APIs that are consistent, predictable, and easy to consume. Good API design reduces integration friction and prevents breaking changes.

## 1. Resource Naming

Use nouns for resources. The HTTP method provides the verb.

| Method | Path | Purpose |
|---|---|---|
| GET | /users | List users |
| GET | /users/:id | Get one user |
| POST | /users | Create a user |
| PUT | /users/:id | Replace a user |
| PATCH | /users/:id | Partially update a user |
| DELETE | /users/:id | Delete a user |

**Rules:**

- Plural nouns: /users not /user
- Lowercase with hyphens: /user-profiles not /userProfiles
- Nest for relationships: /users/:id/posts -- but limit nesting to 2 levels
- No verbs in paths: /users/:id/activate is acceptable only for actions that do not map to CRUD

## 2. Request and Response Format

### Requests

- Use JSON request bodies for POST/PUT/PATCH
- Use query parameters for filtering, sorting, and pagination on GET requests
- Use path parameters for resource identifiers only

### Responses

Consistent response envelope:

    {
      "data": { "id": "abc", "name": "Alice" },
      "meta": { "requestId": "req-123" }
    }

For collections:

    {
      "data": [{ "id": "abc" }, { "id": "def" }],
      "meta": { "total": 42, "page": 1, "perPage": 20 }
    }

## 3. Error Responses

Use a consistent error format across all endpoints:

    {
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "Email address is required",
        "details": [
          { "field": "email", "message": "must not be empty" }
        ]
      }
    }

### HTTP Status Codes

| Code | When to use |
|---|---|
| 200 | Successful GET, PUT, PATCH |
| 201 | Successful POST (resource created) |
| 204 | Successful DELETE (no content) |
| 400 | Invalid request (validation error, malformed JSON) |
| 401 | Not authenticated |
| 403 | Authenticated but not authorized |
| 404 | Resource not found |
| 409 | Conflict (duplicate, version mismatch) |
| 422 | Semantically invalid (business rule violation) |
| 429 | Rate limited |
| 500 | Server error |

## 4. Pagination

Use cursor-based pagination for large or frequently changing datasets. Use offset-based for simple cases.

**Offset-based:**

    GET /users?page=2&perPage=20

**Cursor-based:**

    GET /users?after=abc123&limit=20

Always return pagination metadata in the response so clients know if more data exists.

## 5. Versioning

Choose one strategy and apply it consistently:

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| URL path | /v1/users | Simple, explicit | URL pollution |
| Header | Accept: application/vnd.api.v1+json | Clean URLs | Easy to forget |
| Query param | /users?version=1 | Easy to test | Caching complexity |

**Recommendation:** URL path versioning (/v1/) for most projects. It is the most visible and the hardest to get wrong.

## 6. Common Anti-Patterns

| Anti-Pattern | Better Approach |
|---|---|
| Verbs in URLs (/getUsers) | Use HTTP methods (GET /users) |
| Returning 200 with an error body | Use proper HTTP status codes |
| Inconsistent naming (userId vs user_id) | Pick one convention (camelCase or snake_case) and stick with it |
| No pagination on list endpoints | Always paginate collections |
| Breaking changes without versioning | Version from day one |
| Exposing internal IDs or structure | Use stable public identifiers |

## When to Skip

- Internal microservice-to-microservice communication may use gRPC or message queues instead of REST
- Prototyping and throwaway code -- but add a TODO to design the API properly before shipping
`

const refactoringGuideContent = `---
name: refactoring-guide
description: Plan and execute large refactors safely with phased approach
category: development
version: 1.0.0
---

# Refactoring Guide

A systematic process for restructuring code without changing its behavior. Good refactoring is invisible to users and makes future development faster.

## Phase 1: Assess and Scope

Before touching any code, understand what you are working with.

### Identify the Problem

- **What is wrong?** -- duplicated logic, unclear naming, tangled dependencies, poor performance
- **Why does it matter now?** -- is it blocking a feature, causing bugs, or slowing down development?
- **What is the risk of not refactoring?** -- sometimes the answer is "low" and you should not refactor

### Map the Blast Radius

- Which files and modules will be affected?
- Which tests cover this code?
- Are there external consumers (APIs, libraries, other teams)?

### Define Success

Write down what "done" looks like:

- [ ] All existing tests pass without modification (behavior unchanged)
- [ ] New structure is documented or self-evident
- [ ] No increase in test execution time
- [ ] Code review approved

## Phase 2: Prepare

### Ensure Test Coverage

Before changing code, you need tests that prove the current behavior.

- Run the existing tests. If coverage is low, **add tests first** in a separate commit
- Focus on behavior tests, not implementation tests -- you are about to change the implementation
- If there are no tests, write characterization tests that capture current behavior, then refactor

### Create a Safety Net

- Commit or stash all unrelated work
- Create a dedicated branch: refactor/describe-the-change
- Set up a quick feedback loop: npm test --watch or go test ./... -count=1

## Phase 3: Execute in Small Steps

Each step should be a single, reviewable commit.

### Common Refactoring Moves

| Move | When | Example |
|---|---|---|
| **Rename** | Name does not describe purpose | data -> userProfiles |
| **Extract function** | Block of code does one thing | Pull 20-line block into named function |
| **Inline function** | Wrapper adds no value | Remove single-use helper |
| **Move to module** | Code belongs elsewhere | Move parseDate from user.go to dates.go |
| **Replace conditional with polymorphism** | Long if/switch chains | Use interfaces or strategy pattern |
| **Introduce parameter object** | Function takes 5+ parameters | Group related params into a struct |

### Rules

1. **One refactoring move per commit** -- if something breaks, you can revert one commit instead of untangling a large diff
2. **Run tests after every change** -- if tests fail, undo immediately
3. **Do not change behavior and structure in the same commit** -- refactoring commits should have zero behavior change
4. **Do not refactor and add features simultaneously** -- refactor first, then build on the clean structure

## Phase 4: Verify and Clean Up

- Run the full test suite one final time
- Run linting and type checking
- Review the full diff yourself before requesting review
- Confirm that the refactoring achieves the success criteria from Phase 1

## Common Traps

| Trap | Better Approach |
|---|---|
| Refactoring without tests | Add tests first, then refactor |
| "While I'm here" scope creep | Stick to the original scope; file separate issues for other improvements |
| Big-bang rewrite | Incremental refactoring with working code at every step |
| Refactoring code nobody touches | Focus on code that is actively causing problems |
| Premature abstraction | Wait until you see three instances before extracting a pattern |

## When to Skip

- The code works, is tested, and nobody needs to change it
- You are about to delete the module anyway
- The refactoring would take longer than rewriting from scratch
`

const performanceOptimizationContent = `---
name: performance-optimization
description: Find and fix performance bottlenecks systematically
category: development
version: 1.0.0
---

# Performance Optimization

A systematic approach to finding and fixing performance problems. Always measure before optimizing -- intuition about performance is frequently wrong.

## Step 1: Define the Problem

Before optimizing, establish what "slow" means.

- **What is slow?** -- page load, API response, build time, query execution
- **How slow is it?** -- measure the current baseline with numbers (e.g., "P95 response time is 2.3s")
- **What is the target?** -- define a specific goal (e.g., "P95 under 500ms")
- **Who is affected?** -- all users, specific pages, specific operations

If you cannot measure it, you cannot optimize it. Set up monitoring before changing code.

## Step 2: Profile

Use the right tool for the right layer.

### Frontend

| Tool | What it measures |
|---|---|
| Browser DevTools (Performance tab) | Rendering, scripting, layout, paint |
| Lighthouse | Core Web Vitals, accessibility, best practices |
| React.Profiler or React DevTools | Component render frequency and duration |
| Bundle analyzer (webpack-bundle-analyzer) | JavaScript bundle size |

### Backend

| Tool | What it measures |
|---|---|
| pprof (Go) | CPU, memory, goroutine profiles |
| EXPLAIN ANALYZE (SQL) | Query execution plan and timing |
| APM tools (Datadog, New Relic) | End-to-end request traces |
| time command | Wall-clock execution time |

### Rule: Profile First, Optimize Second

Do not guess. The bottleneck is almost never where you think it is.

## Step 3: Identify the Bottleneck

Common categories of performance problems:

### Database

| Problem | Symptom | Fix |
|---|---|---|
| N+1 queries | Many small queries in a loop | Use JOINs, eager loading, or batch queries |
| Missing index | Slow queries on large tables | Add index on filtered/sorted columns |
| Over-fetching | SELECT * when you need 2 columns | Select only needed columns |
| No connection pooling | Connection setup on every request | Configure connection pool |

### Frontend

| Problem | Symptom | Fix |
|---|---|---|
| Large bundle | Slow initial load | Code splitting, lazy imports |
| Unnecessary re-renders | Sluggish UI interactions | React.memo, useMemo, stable references |
| Unoptimized images | Slow page load, high bandwidth | Compress, use WebP, lazy load |
| Layout thrashing | Janky scrolling | Batch DOM reads and writes |

### Backend

| Problem | Symptom | Fix |
|---|---|---|
| Synchronous blocking | High latency under load | Use async I/O, goroutines, worker pools |
| Memory leaks | Growing memory over time | Profile allocations, close resources |
| No caching | Repeated expensive computation | Cache at the appropriate layer |
| Serialization overhead | Slow JSON encoding/decoding | Use streaming, binary formats for internal APIs |

## Step 4: Fix and Measure

1. **Change one thing at a time** -- multiple changes make it impossible to attribute improvement
2. **Measure after each change** -- compare against the baseline from Step 1
3. **Run under realistic load** -- a fast response with 1 user may be slow with 1000
4. **Check for regressions** -- optimizing one path sometimes slows another

## Step 5: Caching Strategy

Caching is the most powerful optimization -- and the most dangerous.

| Cache Layer | Use When | Invalidation |
|---|---|---|
| Browser cache (HTTP headers) | Static assets, rarely-changing API responses | TTL or versioned URLs |
| CDN | Static content served globally | Purge on deploy |
| Application cache (in-memory) | Expensive computations, frequent reads | TTL or event-based |
| Database query cache | Complex queries, read-heavy workloads | Clear on write |

**Rules for caching:**

- Cache at the outermost layer possible (browser > CDN > app > DB)
- Always set a TTL -- stale data is worse than slow data
- Monitor cache hit rates -- a cache with low hit rates adds complexity without benefit
- Invalidation is hard -- prefer TTL-based expiry over manual invalidation

## Anti-Patterns

| Anti-Pattern | Why it is Wrong |
|---|---|
| Optimizing without profiling | You are probably optimizing the wrong thing |
| Premature optimization | Adding complexity before there is a measured problem |
| Micro-optimizations in hot paths | Focus on algorithmic complexity (O(n) to O(log n)), not micro tricks |
| Caching everything | Adds staleness risk and memory pressure |
| Optimizing dev-only code paths | Build/test speed matters, but production perf matters more |

## When to Skip

- The code is fast enough for its current and foreseeable use case
- The optimization would make the code significantly harder to understand
- You are in a prototype or spike -- optimize after validating the approach
`

const securityAuditContent = `---
name: security-audit
description: Audit code for OWASP Top 10 vulnerabilities
category: security
version: 1.0.0
---

# Security Audit

A systematic checklist for auditing code against the most common security vulnerabilities. Based on the OWASP Top 10 and practical application security experience.

## Audit Process

1. **Identify the attack surface** -- list all inputs, endpoints, and external interfaces
2. **Walk through each category below** -- check for the vulnerability, note findings
3. **Classify severity** -- Critical (exploitable now), High (exploitable with effort), Medium (defense-in-depth), Low (informational)
4. **File issues** -- one issue per finding, with reproduction steps and remediation guidance

## 1. Injection

Code that constructs queries or commands from user input without proper escaping.

**Check for:**

- SQL queries built with string concatenation or interpolation
- Shell commands using exec(), os.exec, or backticks with user input
- LDAP, XPath, or NoSQL injection vectors
- Template injection in server-side rendering

**Fix:** Use parameterized queries, prepared statements, or ORM methods. Never concatenate user input into queries.

    // BAD
    db.Query("SELECT * FROM users WHERE id = " + userID)

    // GOOD
    db.Query("SELECT * FROM users WHERE id = $1", userID)

## 2. Broken Authentication

Weak or missing authentication mechanisms.

**Check for:**

- Passwords stored in plaintext or with weak hashing (MD5, SHA1)
- Missing rate limiting on login endpoints
- Session tokens that are predictable or do not expire
- Missing multi-factor authentication for sensitive operations
- Password reset flows that leak information

**Fix:** Use bcrypt/scrypt/argon2 for password hashing. Implement rate limiting. Use secure, random session tokens with expiration.

## 3. Sensitive Data Exposure

Data that should be protected is accessible or transmitted insecurely.

**Check for:**

- API keys, passwords, or tokens in source code or configuration files committed to version control
- Secrets in log output or error messages
- Sensitive data transmitted over HTTP instead of HTTPS
- Personally identifiable information (PII) in URLs or query parameters
- Missing encryption at rest for sensitive database columns

**Fix:** Use environment variables or secret managers. Audit log output. Enforce HTTPS. Encrypt sensitive data at rest.

## 4. Cross-Site Scripting (XSS)

User input rendered in HTML without proper escaping.

**Check for:**

- dangerouslySetInnerHTML in React without sanitization
- Template output without auto-escaping enabled
- User input reflected in HTML attributes, JavaScript, or CSS
- SVG or HTML uploaded by users and served directly

**Fix:** Use framework auto-escaping (React does this by default). Sanitize HTML with a whitelist-based library (DOMPurify). Set Content-Security-Policy headers.

## 5. Cross-Site Request Forgery (CSRF)

Requests that change state without verifying the request origin.

**Check for:**

- State-changing operations (POST, PUT, DELETE) without CSRF tokens
- Missing SameSite attribute on cookies
- Missing Origin or Referer header validation

**Fix:** Use CSRF tokens for all state-changing requests. Set SameSite=Strict or SameSite=Lax on cookies.

## 6. Broken Access Control

Users can access resources or perform actions beyond their permissions.

**Check for:**

- API endpoints that do not verify the authenticated user owns the requested resource (IDOR)
- Missing role checks for admin-only operations
- Direct object references in URLs (/users/123/settings) without ownership verification
- File upload paths that allow directory traversal

**Fix:** Check authorization on every request. Use indirect references. Deny by default -- explicitly grant access rather than checking for denial.

## 7. Security Misconfiguration

Default settings, verbose errors, or unnecessary features left enabled.

**Check for:**

- Debug mode enabled in production
- Default credentials not changed
- Directory listing enabled on web servers
- Stack traces or internal errors exposed to users
- Unnecessary HTTP methods enabled (TRACE, OPTIONS responding with too much info)
- Missing security headers (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security)

**Fix:** Harden configuration. Disable debug mode. Add security headers. Return generic error messages in production.

## 8. Insecure Dependencies

Third-party libraries with known vulnerabilities.

**Check for:**

- Dependencies with known CVEs (run npm audit, govulncheck ./..., or pip-audit)
- Outdated packages no longer receiving security patches
- Dependencies pulled from untrusted registries

**Fix:** Run vulnerability scanners in CI. Update dependencies regularly. Pin versions and review changelogs before upgrading.

## Audit Report Template

| # | Finding | Severity | Location | Remediation |
|---|---|---|---|---|
| 1 | SQL injection in user search | Critical | api/users.go:42 | Use parameterized query |
| 2 | Missing rate limit on login | High | api/auth.go:15 | Add rate limiter middleware |
| 3 | Debug mode enabled | Medium | config/prod.yaml | Set debug=false |

## When to Skip

- This skill is for code-level audits. Infrastructure and network security require different tools and expertise
- If you are reviewing a prototype that will not be deployed, focus on the security patterns rather than a full audit
`

const dependencyReviewContent = `---
name: dependency-review
description: Evaluate third-party dependencies before adopting
category: security
version: 1.0.0
---

# Dependency Review

A structured evaluation process for third-party packages before adding them to your project. Every dependency is a trust decision -- you are running someone else's code in your application.

## Evaluation Checklist

Before adding any dependency, assess it across these dimensions:

### 1. Need

- **Can you solve this with standard library or existing dependencies?** -- fewer dependencies means fewer risks
- **How much of the library will you actually use?** -- if you need one function from a large library, consider copying the function instead
- **Is this a runtime dependency or a dev/build tool?** -- runtime dependencies carry higher risk

### 2. Maintenance Health

| Signal | Green Flag | Red Flag |
|---|---|---|
| Last commit | Within 3 months | Over 1 year ago |
| Open issues | Triaged, some closed regularly | Hundreds of stale issues |
| Release cadence | Regular releases | No releases in 1+ year |
| Maintainers | Multiple active contributors | Single maintainer, inactive |
| CI/CD | Tests pass, badges visible | No CI, broken builds |

### 3. Security History

- Has the project had security incidents? How were they handled?
- Does the project have a security policy (SECURITY.md)?
- Are vulnerabilities fixed promptly when reported?

### 4. License Compatibility

| License | Commercial Use | Copyleft | Risk Level |
|---|---|---|---|
| MIT | Yes | No | Low |
| Apache 2.0 | Yes | No | Low |
| BSD 2/3 | Yes | No | Low |
| ISC | Yes | No | Low |
| GPL v2/v3 | Yes (with conditions) | Yes | High -- viral, requires derivative works to be GPL |
| AGPL | Yes (with conditions) | Yes (network use) | Very High -- even SaaS use triggers copyleft |
| Unlicensed | Unclear | Unclear | Very High -- no legal permission to use |

**Rule:** If you are building commercial software, avoid GPL/AGPL dependencies unless legal has approved it. MIT, Apache 2.0, and BSD are generally safe.

### 5. Bundle Size (Frontend)

For frontend dependencies, size matters directly to users.

- Is the package tree-shakeable?
- Does it have a smaller alternative? (e.g., date-fns vs moment)
- Can you import only the parts you need?

### 6. API Stability

- Does the project follow semantic versioning?
- Are breaking changes documented in changelogs?
- Is the API surface small and focused, or large and complex?
- How often do major versions ship? (Frequent majors = upgrade burden)

## Decision Matrix

| Factor | Weight | Score (1-5) | Weighted |
|---|---|---|---|
| Solves a real need | 30% | | |
| Maintenance health | 25% | | |
| Security track record | 20% | | |
| License compatibility | 15% | | |
| Bundle size / performance | 10% | | |

Score >= 3.5: **Adopt**. Score 2.5-3.5: **Proceed with caution**. Score < 2.5: **Find an alternative**.

## After Adoption

- **Pin the version** -- use exact versions in package.json or go.mod, not ranges
- **Set up automated vulnerability scanning** -- Dependabot, Snyk, or npm audit in CI
- **Review changelogs before upgrading** -- do not blindly merge version bumps
- **Have a removal plan** -- if the dependency is abandoned, how hard would it be to replace?

## When to Skip

- Internal utility packages maintained by your own team
- Dev-only tools (linters, formatters) -- lower risk, less scrutiny needed
- Standard library packages in Go, Rust, or Python -- these are vetted by language teams
`

const architectureDecisionRecordsContent = `---
name: architecture-decision-records
description: Capture architectural decisions in a structured format
category: documentation
version: 1.0.0
---

# Architecture Decision Records

A lightweight format for documenting technical decisions so future developers understand not just what was built, but why. ADRs prevent "why did we do this?" conversations and stop the same debates from recurring.

## ADR Template

    # ADR-NNN: Title of Decision

    ## Status

    [Proposed | Accepted | Deprecated | Superseded by ADR-NNN]

    ## Context

    What is the problem or situation that requires a decision?
    Include technical constraints, business requirements, and any
    relevant background. A reader unfamiliar with the project should
    understand the situation from this section alone.

    ## Decision

    What is the change that we are proposing or have agreed to?
    State it as a clear, unambiguous sentence: "We will use X for Y."

    ## Consequences

    ### Positive
    - What becomes easier or better

    ### Negative
    - What becomes harder or worse
    - What trade-offs are we accepting

    ### Neutral
    - What changes but is neither good nor bad

## When to Write an ADR

Write an ADR when a decision:

- Is **hard to reverse** -- choosing a database, a framework, a hosting provider
- **Affects multiple people** -- API contracts, coding conventions, deployment strategy
- **Has been debated** -- if the team spent more than 15 minutes discussing options, record the outcome
- **Overrides a previous decision** -- supersede the old ADR, do not delete it

## When NOT to Write an ADR

- Obvious choices with no real alternatives
- Temporary decisions during prototyping
- Implementation details that can be changed trivially

## File Organization

Store ADRs in the repository so they are versioned alongside the code they describe:

    docs/
      adr/
        001-use-sqlite-for-local-storage.md
        002-adopt-conventional-commits.md
        003-move-to-cursor-based-pagination.md
        README.md  # index of all ADRs

**Naming convention:** NNN-kebab-case-title.md -- the number is sequential and never reused.

## Writing Guidelines

| Do | Don't |
|---|---|
| Write context from the reader's perspective | Assume the reader was in the meeting |
| State the decision as a single clear sentence | Bury the decision in a paragraph of context |
| List concrete consequences | Write vague "this will be good" |
| Link to related ADRs | Repeat context from other ADRs |
| Write the ADR when the decision is made | Try to backfill ADRs months later from memory |

## Lifecycle

1. **Proposed** -- draft written, under discussion
2. **Accepted** -- team has agreed, decision is active
3. **Deprecated** -- decision is no longer relevant (e.g., the system was retired)
4. **Superseded** -- a newer ADR replaces this one (link to the new ADR)

Never delete an ADR. The history of decisions is valuable even when the decisions themselves are no longer current.

## Example

    # ADR-003: Use cursor-based pagination for the sessions API

    ## Status
    Accepted

    ## Context
    The sessions list API currently uses offset-based pagination. As the
    number of sessions grows, offset queries become slower because the
    database must skip N rows. Users with 1000+ sessions are seeing
    response times over 2 seconds for later pages.

    ## Decision
    We will switch the sessions list API to cursor-based pagination using
    the session's created_at timestamp as the cursor.

    ## Consequences

    ### Positive
    - Consistent query performance regardless of page depth
    - No missed or duplicate results when new sessions are created during pagination

    ### Negative
    - Cannot jump to an arbitrary page number (page 5 of 20)
    - Clients must update to use cursor parameters instead of page numbers
    - Existing API consumers will need migration (tracked in CHA-89)
`

const technicalWritingContent = `---
name: technical-writing
description: Write clear technical documentation with consistent structure and tone
category: documentation
version: 1.0.0
---

# Technical Writing

Guidelines for writing documentation that developers actually read. Good documentation reduces support questions, onboarding time, and bugs caused by misunderstanding.

## Core Principles

1. **Write for the reader, not yourself** -- assume they do not have your context
2. **Be specific** -- "fast" is not useful; "responds in under 200ms" is
3. **Keep it short** -- every sentence should earn its place; cut ruthlessly
4. **Use examples** -- a single code example is worth paragraphs of explanation
5. **Keep it current** -- outdated docs are worse than no docs

## Document Types

### README

The entry point for any project. A reader should go from zero to running the project.

**Required sections:**

1. **What this is** -- one paragraph, no jargon
2. **Quick start** -- clone, install, run in under 5 commands
3. **Prerequisites** -- runtime versions, system dependencies
4. **Configuration** -- environment variables, config files
5. **Development** -- how to run tests, lint, build

**Optional sections:** Architecture overview, deployment, contributing guide.

### API Documentation

For every endpoint:

| Field | Example |
|---|---|
| Method + Path | POST /api/sessions |
| Description | Create a new session in the given workspace |
| Auth | Bearer token required |
| Request body | JSON schema or example |
| Response | Success and error examples |
| Status codes | 201, 400, 401, 404 |

### Runbook

Step-by-step instructions for operational tasks (deploy, rollback, incident response).

**Structure:**

1. **When to use this** -- what situation triggers this runbook
2. **Prerequisites** -- access, tools, permissions needed
3. **Steps** -- numbered, specific, copy-pasteable commands
4. **Verification** -- how to confirm each step worked
5. **Rollback** -- how to undo if something goes wrong

### Onboarding Guide

For new team members. Should answer:

- What does this system do?
- How is the codebase organized?
- How do I set up my local environment?
- What is the development workflow?
- Who do I ask when I am stuck?

## Writing Style

### Do

- Use active voice: "The server returns a 404" not "A 404 is returned"
- Use second person: "You can configure..." not "One can configure..."
- Use present tense: "This function returns..." not "This function will return..."
- Use short sentences and paragraphs
- Use numbered lists for sequences, bullet lists for unordered items
- Use code blocks with syntax highlighting for all code

### Don't

- Use jargon without defining it first
- Write "simply" or "just" -- if the reader is reading docs, it is not simple to them
- Leave placeholder text ("TODO: fill in later")
- Write documentation that requires reading other documentation first

## Formatting

- **Headings:** Use ## for main sections, ### for subsections. Skip heading levels sparingly
- **Code:** Use inline code for identifiers (functionName), fenced blocks for multi-line code
- **Tables:** Use for structured comparisons, not for prose
- **Bold:** For key terms on first use. Do not overuse
- **Links:** Link to related docs, external references. Check links periodically

## Maintenance

- Review docs when the related code changes
- Add a "Last updated" date or link to the git log
- Delete docs for removed features -- stale docs cause more confusion than missing docs
- Run docs through a spell checker and linter (markdownlint, vale)

## When to Skip

- Internal throwaway scripts that will be deleted within a week
- Code that is self-documenting (well-named functions with typed parameters)
- Documentation that duplicates what the code already says clearly
`

const projectScaffoldingContent = `---
name: project-scaffolding
description: Set up new projects with proper structure, tooling, and CI/CD
category: documentation
version: 1.0.0
---

# Project Scaffolding

A checklist-driven approach to setting up new projects with the right structure, tooling, and automation from day one. Investing 30 minutes in scaffolding saves hours of retroactive configuration.

## Phase 1: Repository Setup

### Initialize

    mkdir project-name && cd project-name
    git init

### Essential Files

| File | Purpose |
|---|---|
| README.md | Project description, quick start, prerequisites |
| .gitignore | Exclude build artifacts, dependencies, secrets |
| LICENSE | Legal terms for the project |
| .editorconfig | Consistent formatting across editors |
| CLAUDE.md | AI assistant project instructions |

### .gitignore

Start with a language-specific template and customize. Always include:

    # Secrets
    .env
    .env.local
    *.pem
    *.key

    # Editor
    .idea/
    .vscode/
    *.swp

    # OS
    .DS_Store
    Thumbs.db

## Phase 2: Directory Structure

Organize by feature or layer -- pick one and be consistent.

### By Feature (Recommended for Most Projects)

    src/
      auth/
        auth.ts
        auth.test.ts
        auth.types.ts
      users/
        users.ts
        users.test.ts
      shared/
        database.ts
        logger.ts

### By Layer

    src/
      handlers/
      services/
      models/
      middleware/
      tests/

## Phase 3: Tooling

### Package Manager and Dependencies

| Language | Package Manager | Lock File |
|---|---|---|
| Node.js | npm / pnpm | package-lock.json / pnpm-lock.yaml |
| Go | go modules | go.sum |
| Python | pip / poetry | requirements.txt / poetry.lock |
| Rust | cargo | Cargo.lock |

**Always commit lock files** -- they ensure reproducible builds.

### Linting and Formatting

Set these up before writing any code. Retrofitting linting to an existing codebase is painful.

| Language | Linter | Formatter |
|---|---|---|
| TypeScript | ESLint | Prettier |
| Go | go vet, staticcheck | gofmt |
| Python | ruff | ruff format |
| Rust | clippy | rustfmt |

### Testing Framework

| Language | Framework | Command |
|---|---|---|
| TypeScript | Vitest or Jest | npx vitest |
| Go | Built-in | go test ./... |
| Python | pytest | pytest |
| Rust | Built-in | cargo test |

Write one test before anything else to verify the test setup works.

## Phase 4: CI/CD

### Minimum CI Pipeline

Every project should have a CI pipeline that runs on every push:

1. **Install dependencies** -- from lock file for reproducibility
2. **Lint** -- catch formatting and style issues
3. **Type check** -- catch type errors (TypeScript, mypy)
4. **Test** -- run the full test suite
5. **Build** -- confirm the project compiles/builds

### GitHub Actions Example

    name: CI
    on: [push, pull_request]
    jobs:
      ci:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with:
              node-version: 22
              cache: npm
          - run: npm ci
          - run: npm run lint
          - run: npm run build
          - run: npm test

## Phase 5: Configuration

### Environment Variables

- Use .env.example to document required variables (committed, no real values)
- Use .env.local for actual values (gitignored)
- Validate environment variables at startup -- fail fast with a clear error

### Makefile

A Makefile provides discoverable commands:

    .PHONY: dev build test lint

    dev:
        npm run dev

    build:
        npm run build

    test:
        npm test

    lint:
        npm run lint

## Scaffolding Checklist

- [ ] Repository initialized with .gitignore, README.md, LICENSE
- [ ] Directory structure created
- [ ] Package manager configured with lock file
- [ ] Linter and formatter set up and passing
- [ ] Test framework installed with one passing test
- [ ] CI pipeline running on push and PR
- [ ] Environment variable handling with .env.example
- [ ] Makefile or equivalent for common commands
- [ ] First commit made on main, development branch created

## When to Skip

- Throwaway scripts or one-off analysis -- a single file is fine
- Spikes or proof-of-concept work -- but scaffold properly if it graduates to production
`

const codeMigrationContent = `---
name: code-migration
description: Plan and execute language, framework, or library migrations
category: version-control
version: 1.0.0
---

# Code Migration Guide

A structured approach to migrating between languages, frameworks, libraries, or major versions. Migrations are high-risk, high-reward operations -- a methodical approach prevents the "halfway migrated" state where neither the old nor new system works properly.

## Phase 1: Assess

Before committing to a migration, answer these questions:

### Is the Migration Worth It?

| Factor | Question |
|---|---|
| Pain | What specific problems does the current system cause? |
| Benefit | What will the new system enable that the old one cannot? |
| Cost | How many files, modules, and tests need to change? |
| Risk | What could go wrong during the migration? |
| Timeline | How long will the migration take? Can the team absorb this alongside feature work? |

If the benefit is vague ("it is more modern") or the cost is high relative to the benefit, reconsider.

### Compatibility Analysis

- **API changes** -- what functions, types, or interfaces changed between versions?
- **Breaking changes** -- read the migration guide and changelog for every major version between current and target
- **Dependency compatibility** -- do all dependencies support the target version?
- **Runtime requirements** -- does the target version need a different Node.js, Go, or Python version?

## Phase 2: Plan

### Incremental vs. Big-Bang

| Strategy | When to Use | Risk |
|---|---|---|
| **Incremental** | Large codebase, can run old and new side by side | Lower -- working code at every step |
| **Big-bang** | Small codebase, cannot run both systems simultaneously | Higher -- all or nothing |

**Always prefer incremental migration** unless the codebase is small enough to migrate in a single PR.

### Migration Phases

Break the migration into phases, each producing a working system:

1. **Phase 0:** Set up the new version/framework alongside the old one
2. **Phase 1:** Migrate shared utilities and helpers
3. **Phase 2:** Migrate core business logic
4. **Phase 3:** Migrate entry points and handlers
5. **Phase 4:** Remove the old system

Each phase should be a separate PR or set of PRs.

### Rollback Plan

For every phase, document how to undo it:

- Can you revert the PR?
- Do you need to restore database state?
- Are there deployment steps to undo?

## Phase 3: Execute

### Rules

1. **One migration per branch** -- do not combine a migration with feature work
2. **Migrate tests first** -- if the tests pass with the new system, the migration is correct
3. **Run both old and new during transition** -- use feature flags or conditional imports to switch between old and new implementations
4. **Monitor after each phase** -- check error rates, performance, and functionality before proceeding

### Common Migration Patterns

**Adapter pattern:** Wrap the new library with the old interface so existing code does not change immediately.

**Strangler fig:** Route new traffic to the new system, keep old traffic on the old system, gradually shift.

## Phase 4: Clean Up

After the migration is complete and verified:

- [ ] Remove the old system entirely -- do not leave dead code
- [ ] Remove feature flags used for the migration
- [ ] Remove adapter layers that are no longer needed
- [ ] Update documentation to reflect the new system
- [ ] Update CI/CD to remove old system build steps

## Common Traps

| Trap | Better Approach |
|---|---|
| Migrating and adding features at the same time | Migrate first, then build on the new foundation |
| No rollback plan | Document rollback steps before starting |
| Skipping the assessment phase | Be honest about cost vs. benefit |
| "We will finish the migration later" | Set a deadline; halfway-migrated is the worst state |
| Not testing with production-like data | Edge cases hide in real data |

## When to Skip

- The current system works fine and the team has higher-priority work
- The migration is purely aesthetic ("newer is better" without concrete benefits)
- The old system is being retired soon anyway
`

const accessibilityAuditContent = `---
name: accessibility-audit
description: Audit UI components for WCAG compliance
category: version-control
version: 1.0.0
---

# Accessibility Audit

A systematic approach to auditing web interfaces for accessibility. The goal is WCAG 2.1 AA compliance -- the standard that covers most legal requirements and ensures usability for people with disabilities.

## Audit Process

1. **Automated scan** -- catch the low-hanging fruit
2. **Keyboard testing** -- navigate the entire UI without a mouse
3. **Screen reader testing** -- listen to how the UI is announced
4. **Visual inspection** -- check contrast, spacing, and visual indicators
5. **Document findings** -- file issues with severity and remediation

## 1. Automated Scanning

Run automated tools first to catch obvious issues. Use Lighthouse accessibility audit or axe-core in tests.

**Note:** Automated tools catch about 30-50% of accessibility issues. Manual testing is required for the rest.

## 2. Semantic HTML

Use the right HTML elements for their purpose -- this gives you keyboard navigation and screen reader support for free.

| Instead of | Use |
|---|---|
| div with onClick | button element |
| div for navigation | nav element |
| div for main content | main element |
| span as a link | a href element |
| div for lists | ul/ol elements |
| b/i for emphasis | strong/em elements |
| Generic heading sizes | h1 through h6 in order |

## 3. ARIA Attributes

ARIA supplements semantic HTML -- use it when native elements are insufficient.

### Essential ARIA

| Attribute | When | Example |
|---|---|---|
| aria-label | Element has no visible text | Icon-only buttons |
| aria-labelledby | Label is another element | Dialog title |
| aria-describedby | Additional context needed | Form field with help text |
| aria-expanded | Toggle state | Accordion, dropdown |
| aria-hidden="true" | Decorative content | Icons next to text labels |
| role | Custom widget behavior | role="dialog", role="alert" |

### Rules

- **Do not use ARIA to fix what semantic HTML can solve** -- button is better than div role="button"
- **Do not override native semantics** -- button role="link" is confusing; use a element instead
- **Test with a screen reader** -- ARIA attributes are only useful if they produce correct announcements

## 4. Keyboard Navigation

Every interactive element must be usable with keyboard alone.

### Checklist

- [ ] Tab order follows visual layout (left to right, top to bottom)
- [ ] All interactive elements are focusable (button, a, input, or tabindex="0")
- [ ] Focus is visible -- a clear ring or outline on the focused element
- [ ] Escape closes modals and dropdowns
- [ ] Enter and Space activate buttons
- [ ] Arrow keys navigate within composite widgets (tabs, menus, listboxes)
- [ ] Focus is trapped inside modals (cannot Tab out to content behind)
- [ ] Focus returns to the trigger element when a modal closes

### Focus Management

When a dialog opens, move focus to the dialog element. When a dialog closes, return focus to the trigger element that opened it.

## 5. Color and Contrast

### Contrast Ratios (WCAG AA)

| Element | Minimum Ratio |
|---|---|
| Normal text (< 18px) | 4.5:1 |
| Large text (>= 18px or >= 14px bold) | 3:1 |
| UI components and graphics | 3:1 |

**Tools:** Chrome DevTools color picker shows contrast ratios. Use WebAIM Contrast Checker for specific values.

### Color Independence

- Never use color alone to convey information -- add icons, patterns, or text labels
- Error states: red color + error icon + descriptive text
- Form validation: red border + error message below the field
- Charts: use patterns or labels in addition to colors

## 6. Images and Media

- Every img must have an alt attribute
  - Informative images: describe the content (alt="Bar chart showing monthly revenue")
  - Decorative images: use empty alt (alt="")
- Videos must have captions
- Audio must have transcripts
- Animations should respect prefers-reduced-motion

## Findings Template

| # | Issue | WCAG Criterion | Severity | Location | Remediation |
|---|---|---|---|---|---|
| 1 | Missing alt text on logo | 1.1.1 | High | Header.tsx:12 | Add descriptive alt text |
| 2 | Low contrast on placeholder text | 1.4.3 | Medium | Input.tsx:8 | Increase to 4.5:1 ratio |
| 3 | Modal does not trap focus | 2.4.3 | High | Dialog.tsx:25 | Add focus trap |

## When to Skip

- Internal admin tools used by a small team (but still aim for keyboard navigation)
- Components that will be replaced before shipping
- Third-party embeds you cannot control (document the limitation instead)
`

const unitTestingContent = `---
name: unit-testing
description: Write effective unit tests — structure, patterns, doubles, and polyglot guidance
category: development
version: 1.0.0
---

# Unit Testing Guide

A comprehensive guide to writing unit tests that catch bugs, survive refactors, and serve as living documentation. This covers the mechanics of writing tests — for the Red-Green-Refactor workflow, see the TDD skill.

All patterns apply across languages unless marked otherwise. Examples use TypeScript (Vitest), Go, Python (pytest), and Rust.

## What to Test

Focus testing effort where it delivers the most value.

| Test This | Why |
|---|---|
| Public API behavior and return values | This is the contract other code depends on |
| Edge cases (empty input, nil, zero, boundary values) | Most bugs hide at the edges |
| Error paths and failure modes | Callers need to know what happens when things go wrong |
| State transitions | Verify that operations move state from A to B correctly |
| Business rules and validation logic | These encode domain requirements that must not silently break |
| Conditional branches | Every branch is a decision that can go wrong |

## What NOT to Test

| Skip This | Why |
|---|---|
| Framework and library internals | The framework maintainers test these already |
| Trivial getters and setters with no logic | No branching means no bugs; the test just duplicates the code |
| Private methods directly | Test them through the public interface that calls them |
| Implementation details (internal variable names, call order) | These tests break on every refactor without catching real bugs |
| Third-party library behavior | Test at the boundary where your code meets the library, not the library itself |
| Generated code | The generator is responsible for correctness; test your inputs to the generator |

## Test Structure

### Arrange-Act-Assert

The fundamental pattern for every unit test. Separate setup, execution, and verification into three distinct blocks.

**TypeScript (Vitest):**

    describe('calculateTotal', () => {
      it('should apply discount when total exceeds threshold', () => {
        // Arrange
        const items = [{ price: 100 }, { price: 200 }]
        const discount = 0.1

        // Act
        const total = calculateTotal(items, discount)

        // Assert
        expect(total).toBe(270)
      })
    })

**Go:**

    func TestCalculateTotal_WithDiscount(t *testing.T) {
        // Arrange
        items := []Item{{Price: 100}, {Price: 200}}
        discount := 0.1

        // Act
        total := CalculateTotal(items, discount)

        // Assert
        if total != 270 {
            t.Errorf("got %f, want 270", total)
        }
    }

**Python (pytest):**

    def test_calculate_total_with_discount():
        # Arrange
        items = [{"price": 100}, {"price": 200}]
        discount = 0.1

        # Act
        total = calculate_total(items, discount)

        # Assert
        assert total == 270

### Given-When-Then

An alternative naming frame that maps directly to AAA. Use it when test names benefit from a behavioral description:

- **Given** (Arrange) — the initial state or preconditions
- **When** (Act) — the action being tested
- **Then** (Assert) — the expected outcome

This is a naming convention, not a different structure. Use whichever reads more naturally for the test.

## Test Naming

A failing test name should explain what is broken without reading the test body.

| Language | Convention | Example |
|---|---|---|
| TypeScript | ` + "`" + `describe("Module")` + "`" + ` + ` + "`" + `it("should behavior when condition")` + "`" + ` | ` + "`" + `it("should return error when email is empty")` + "`" + ` |
| Go | ` + "`" + `TestFunction_Condition_Expected` + "`" + ` or table-driven ` + "`" + `name` + "`" + ` field | ` + "`" + `TestCreateUser_EmptyEmail_ReturnsError` + "`" + ` |
| Python | ` + "`" + `test_function_condition_expected` + "`" + ` | ` + "`" + `test_create_user_empty_email_returns_error` + "`" + ` |
| Rust | ` + "`" + `fn function_condition_expected` + "`" + ` inside ` + "`" + `#[cfg(test)] mod tests` + "`" + ` | ` + "`" + `fn create_user_empty_email_returns_error` + "`" + ` |

**Rules:**

- The test name should read like a specification
- Group related tests: ` + "`" + `describe` + "`" + ` blocks in TypeScript, subtests in Go, test classes in Python
- Avoid vague names like ` + "`" + `test_it_works` + "`" + ` or ` + "`" + `TestMain` + "`" + `

## Test Organization

| Language | Convention | Example |
|---|---|---|
| TypeScript | Co-located: ` + "`" + `foo.test.ts` + "`" + ` next to ` + "`" + `foo.ts` + "`" + ` | ` + "`" + `src/auth/login.test.ts` + "`" + ` |
| Go | Same package: ` + "`" + `foo_test.go` + "`" + ` next to ` + "`" + `foo.go` + "`" + ` | ` + "`" + `auth/login_test.go` + "`" + ` |
| Python | Co-located or separate ` + "`" + `tests/` + "`" + ` directory | ` + "`" + `tests/test_login.py` + "`" + ` or ` + "`" + `auth/test_login.py` + "`" + ` |
| Rust | Inline ` + "`" + `#[cfg(test)] mod tests` + "`" + ` for unit; ` + "`" + `tests/` + "`" + ` dir for integration | inline in ` + "`" + `src/auth.rs` + "`" + ` |

**Guidelines:**

- One test file per source file, mirroring the source file name
- Put shared test helpers and fixtures in a dedicated test utilities module
- Keep integration tests in a separate directory from unit tests
- In Go, use ` + "`" + `package foo_test` + "`" + ` (external test package) to test only the public API, or ` + "`" + `package foo` + "`" + ` for white-box tests when necessary

## Test Doubles

Confusion about mocks, stubs, and spies is one of the most common testing pitfalls. Use the right double for the job.

### Taxonomy

| Double | Purpose | Behavior | Example |
|---|---|---|---|
| **Stub** | Return canned data | Provides predetermined responses, no verification | Stub a DB query to return a fixed user |
| **Mock** | Verify interactions | Records calls and asserts they happened correctly | Mock an email service, verify ` + "`" + `sendEmail` + "`" + ` was called with the right args |
| **Spy** | Wrap real implementation | Calls the real code but records calls for verification | Spy on a logger to verify it was called without replacing it |
| **Fake** | Simplified implementation | Works end-to-end but takes shortcuts | In-memory database instead of real PostgreSQL |
| **Dummy** | Fill a parameter slot | Not actually used by the code under test | Placeholder object passed to satisfy a required parameter |

### When to Use Each

- **Prefer stubs over mocks** — stubs test output (what the code returns), mocks test implementation (what the code calls). Stubs survive refactors better
- **Use fakes for expensive dependencies** — databases, filesystems, HTTP clients. Fakes provide realistic behavior without real infrastructure
- **Use spies sparingly** — they couple tests to call sequences
- **Use mocks only at system boundaries** — external APIs, message queues, email services
- **Never mock the code under test** — only mock its dependencies

### Framework Examples

**TypeScript (Vitest):**

    // Stub — returns canned data
    const getUser = vi.fn().mockReturnValue({ id: '1', name: 'Alice' })

    // Spy — wraps the real implementation
    const spy = vi.spyOn(logger, 'warn')
    doSomething()
    expect(spy).toHaveBeenCalledWith('expected warning')

    // Mock module — replace an entire module
    vi.mock('./database', () => ({
      getUser: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
    }))

**Go (interface-based — the idiomatic approach):**

    type UserStore interface {
        GetUser(ctx context.Context, id string) (*User, error)
    }

    // Stub implementation for tests
    type stubUserStore struct {
        user *User
        err  error
    }

    func (s *stubUserStore) GetUser(ctx context.Context, id string) (*User, error) {
        return s.user, s.err
    }

    func TestHandler_ReturnsUser(t *testing.T) {
        store := &stubUserStore{user: &User{ID: "1", Name: "Alice"}}
        handler := NewHandler(store)
        // test handler...
    }

**Python (unittest.mock):**

    from unittest.mock import Mock, patch

    # Stub
    user_store = Mock()
    user_store.get_user.return_value = User(id="1", name="Alice")

    # Patch a module-level function
    @patch('myapp.db.get_user')
    def test_handler(mock_get_user):
        mock_get_user.return_value = User(id="1", name="Alice")
        result = handle_request("1")
        assert result.name == "Alice"

## Designing for Testability

Code that is hard to test is usually tightly coupled. Fix the design, not the test.

| Untestable | Testable | Why |
|---|---|---|
| Function creates its own DB connection | Function accepts a DB interface as a parameter | Caller controls the dependency |
| Handler calls ` + "`" + `http.Get()` + "`" + ` directly inside business logic | Handler accepts an HTTP client interface | Tests can substitute a fake client |
| Constructor reads ` + "`" + `os.Getenv()` + "`" + ` at init time | Config struct passed as a parameter | Tests pass different configs without environment mutation |
| Global singleton holds mutable state | Instance passed through dependency injection | Each test gets its own instance |

**Principles:**

- Accept dependencies as parameters — constructor injection, function parameters, or method injection
- Depend on interfaces (Go, TypeScript) or protocols (Python), not concrete types
- Push side effects (I/O, network, filesystem) to the edges — keep business logic pure
- If a function is hard to test, the function is doing too much. Extract and inject.

## Testing Async Code

### TypeScript / JavaScript

- Always ` + "`" + `await` + "`" + ` async functions in tests — a missing ` + "`" + `await` + "`" + ` causes the test to pass before the assertion runs
- Use ` + "`" + `vi.useFakeTimers()` + "`" + ` for ` + "`" + `setTimeout` + "`" + `/` + "`" + `setInterval` + "`" + ` — advance time explicitly with ` + "`" + `vi.advanceTimersByTime()` + "`" + `
- Test rejection paths with ` + "`" + `.rejects` + "`" + `

Example:

    it('should reject when user not found', async () => {
      await expect(getUser('missing')).rejects.toThrow('not found')
    })

    it('should retry after delay', async () => {
      vi.useFakeTimers()
      const promise = retryOperation()
      vi.advanceTimersByTime(1000)
      await expect(promise).resolves.toBe('success')
      vi.useRealTimers()
    })

### Go

- Use ` + "`" + `context.WithTimeout` + "`" + ` to prevent hanging tests
- Never use ` + "`" + `time.Sleep` + "`" + ` in tests — use channels, sync primitives, or ` + "`" + `t.Deadline()` + "`" + `
- For goroutine-based code, use ` + "`" + `sync.WaitGroup` + "`" + ` or channel synchronization

Example:

    func TestAsyncOperation(t *testing.T) {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        result, err := DoAsync(ctx)
        if err != nil {
            t.Fatalf("unexpected error: %v", err)
        }
        if result != expected {
            t.Errorf("got %v, want %v", result, expected)
        }
    }

### Python

- Use ` + "`" + `pytest-asyncio` + "`" + ` for async test functions
- Mark tests with ` + "`" + `@pytest.mark.asyncio` + "`" + `

Example:

    @pytest.mark.asyncio
    async def test_fetch_user():
        result = await fetch_user("123")
        assert result.name == "Alice"

## Error Paths and Edge Cases

Most tests only cover the happy path. Bugs live in the edges.

**For every function, test these scenarios:**

- [ ] Nil / null / undefined input
- [ ] Empty string, empty array, empty map
- [ ] Zero, negative numbers, integer overflow
- [ ] Missing required fields or parameters
- [ ] Invalid format (wrong type, malformed string, bad encoding)
- [ ] Network and I/O failures (timeout, connection refused, permission denied)
- [ ] Concurrent access (if the code is shared across goroutines or threads)
- [ ] Boundary values (first element, last element, exactly at the limit)

**Test strategies by error type:**

| Error Type | Strategy |
|---|---|
| Invalid input | Pass bad data directly, assert error type and message |
| External service failure | Stub the dependency to return an error |
| Timeout | Use fake timers or short real timeouts |
| Resource exhaustion | Stub to simulate resource-limit errors (disk full, memory) |
| Permission denied | Stub auth layer to reject the request |

## Table-Driven Tests

Write one test function, run it with many inputs. Reduces duplication and makes it trivial to add new cases.

**Go (native idiom):**

    func TestParseSize(t *testing.T) {
        tests := []struct {
            name    string
            input   string
            want    int64
            wantErr bool
        }{
            {"empty string", "", 0, true},
            {"bytes", "100B", 100, false},
            {"kilobytes", "2KB", 2048, false},
            {"invalid unit", "5XB", 0, true},
        }
        for _, tt := range tests {
            t.Run(tt.name, func(t *testing.T) {
                got, err := ParseSize(tt.input)
                if (err != nil) != tt.wantErr {
                    t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
                }
                if got != tt.want {
                    t.Errorf("got %d, want %d", got, tt.want)
                }
            })
        }
    }

**TypeScript (Vitest):**

    it.each([
      ['', 0, true],
      ['100B', 100, false],
      ['2KB', 2048, false],
      ['5XB', 0, true],
    ])('parseSize(%s) returns %d (error: %s)', (input, expected, shouldError) => {
      if (shouldError) {
        expect(() => parseSize(input)).toThrow()
      } else {
        expect(parseSize(input)).toBe(expected)
      }
    })

**Python (pytest):**

    @pytest.mark.parametrize("input_str,expected,should_error", [
        ("", 0, True),
        ("100B", 100, False),
        ("2KB", 2048, False),
        ("5XB", 0, True),
    ])
    def test_parse_size(input_str, expected, should_error):
        if should_error:
            with pytest.raises(ValueError):
                parse_size(input_str)
        else:
            assert parse_size(input_str) == expected

**Rust:**

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_parse_size_valid() {
            let cases = vec![
                ("100B", 100i64),
                ("2KB", 2048),
            ];
            for (input, expected) in cases {
                assert_eq!(parse_size(input).unwrap(), expected, "input: {}", input);
            }
        }

        #[test]
        fn test_parse_size_invalid() {
            assert!(parse_size("").is_err());
            assert!(parse_size("5XB").is_err());
        }
    }

## Test Behavior, Not Implementation

| Do | Don't |
|---|---|
| Call the public function and assert its output | Export a private function just to test it |
| Assert the observable result (return value, state change, side effect) | Assert internal variable values |
| Test that an email was sent (via a spy on the email service) | Test that ` + "`" + `formatEmailBody()` + "`" + ` was called with specific arguments |
| Assert the response status code and body | Assert which middleware functions ran |

If you cannot test a private function through its public caller, the function belongs in its own module with its own public interface. Restructure the code rather than exposing internals for testing.

## Snapshot Testing

**When to use:**

- Complex serializable output where field-by-field assertions are verbose (large JSON, HTML, CLI output)
- UI component rendering (React component trees)
- API response shapes during development

**When NOT to use:**

- Output containing volatile values (timestamps, random IDs, UUIDs)
- Small, simple outputs where explicit assertions are clearer and more readable
- Rapidly changing outputs during active development

**Rules:**

- Review snapshot diffs as carefully as code diffs — do not blindly update
- Exclude volatile fields (timestamps, IDs) before snapshotting
- Keep snapshots small — snapshot specific sections, not entire pages
- Delete and regenerate stale snapshots; do not let them accumulate

## Test Coverage

**What coverage tells you:** Which lines and branches of code were executed during tests.

**What coverage does NOT tell you:** Whether the tests actually assert correct behavior. A test with 100% coverage and zero assertions proves nothing.

| Level | Meaning |
|---|---|
| < 50% | Major untested paths exist. Bugs are likely hiding in uncovered code. |
| 50-80% | Reasonable for most projects. Focus effort on critical and complex paths. |
| 80-90% | Good coverage. Diminishing returns above this for most codebases. |
| 90-100% | Pursue only for critical libraries, safety-critical code, or shared infrastructure. |

**Rules:**

- Cover all error paths and edge cases before chasing line coverage numbers
- Do not write tests solely to increase a coverage metric
- Use coverage to **find untested code**, not as a quality scorecard
- Enforce coverage in CI as a **floor** (block PRs that lower it), not a ceiling (do not require 100%)

## Unit vs. Integration Tests

| Dimension | Unit Test | Integration Test |
|---|---|---|
| Scope | Single function, method, or class | Multiple components working together |
| Dependencies | All stubbed or faked | Real (database, filesystem, HTTP) |
| Speed | Milliseconds | Seconds to minutes |
| Flakiness risk | Near zero | Higher — external systems can fail |
| When to write | All business logic, transformations, validations | API handlers with real DB, external service calls, end-to-end workflows |

**Rules:**

- If your "unit test" requires a running database, it is an integration test — label and run it accordingly
- Unit tests run on every file save; integration tests run in CI or pre-push
- When a function mixes logic and I/O, split it: test the logic as a unit, test the I/O as an integration
- Both are valuable — unit tests for speed and precision, integration tests for confidence in the full stack

## Preventing Flaky Tests

Flaky tests erode trust in the test suite. Fix them immediately or quarantine them.

| Cause | Symptom | Fix |
|---|---|---|
| Shared mutable state | Tests pass alone, fail together | Isolate state per test; reset in setup/teardown |
| Test ordering dependency | Different results in different run order | Each test creates its own state from scratch |
| Time dependency | Fails at midnight or near date boundaries | Use fake clocks; test with fixed timestamps |
| Real network calls | Fails when offline or service is slow | Stub all network calls in unit tests |
| Floating point comparison | Intermittent assertion failures | Use approximate comparison (` + "`" + `toBeCloseTo` + "`" + `, epsilon) |
| Race conditions | Intermittent failures in concurrent code | Use synchronization primitives; never ` + "`" + `time.Sleep` + "`" + ` |
| Random test data | Non-reproducible failures | Seed random generators; log the seed for reproduction |

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **The Giant Test** | One test with 10 setup steps and 10 assertions | Split into focused tests — one behavior per test |
| **The Mockery** | Every dependency is mocked; test proves nothing about real behavior | Mock only external boundaries; use real implementations for internal code |
| **Test-per-Method** | Mechanically writing one test per method without thought | Test behaviors and scenarios, not method names |
| **Copy-Paste Tests** | Duplicated setup across many tests | Use test helpers, fixtures, and table-driven tests |
| **The Sleeper** | ` + "`" + `time.Sleep(2 * time.Second)` + "`" + ` waiting for async work | Use channels, fake timers, or polling with timeout |
| **Assertion-Free Test** | Code runs but nothing is asserted | Every test must have at least one explicit assertion |
| **Testing the Mock** | Asserting that stubs return the values you just configured | Assert on the behavior of the code under test, not on your test setup |
| **Brittle Snapshot** | Snapshot includes timestamps, random IDs, or environment-specific paths | Exclude volatile fields before snapshotting |

## Test Quality Checklist

Before considering your tests complete, verify:

- [ ] Each test has a descriptive name that reads as a specification
- [ ] Each test follows Arrange-Act-Assert with clear separation
- [ ] Each test is independent — can run alone, in any order, with the same result
- [ ] Each unit test runs in under 100ms
- [ ] No unit test depends on external services, filesystem, or network
- [ ] Error paths are tested, not just the happy path
- [ ] Assertions verify behavior and output, not implementation details
- [ ] Test helpers reduce duplication without hiding important setup logic
- [ ] Flaky tests are quarantined and fixed immediately, never skipped permanently
- [ ] Coverage is used to find untested code, not treated as a success metric

## When to Skip

Not everything needs unit tests:

- Throwaway scripts, spikes, and one-off exploratory code
- Trivial data classes with no logic (structs, DTOs, config objects)
- Generated code that is validated by its generator
- Pure UI layout where visual regression testing is more appropriate
- One-line wrapper functions with no branching logic

In these cases, consider integration tests, end-to-end tests, or manual verification instead — but always make a conscious decision, not a lazy one.
`
