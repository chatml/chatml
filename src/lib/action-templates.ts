/**
 * Action Templates — built-in defaults, metadata, and merge logic for
 * the PrimaryActionButton system.
 *
 * Follows the same pattern as REVIEW_PROMPTS / REVIEW_TYPE_META in
 * src/hooks/useReviewTrigger.ts.
 */

export type ActionTemplateKey =
  | 'resolve-conflicts'
  | 'fix-issues'
  | 'continue-operation'
  | 'sync-branch'
  | 'create-pr'
  | 'merge-pr'
  | 'ship'
  | 'deploy'
  | 'investigate'
  | 'autoplan'
  | 'document-release';

export type OverrideMode = 'replace' | 'append';

export interface ActionTemplateOverride {
  text: string;
  mode: OverrideMode;
}

/**
 * Safety guardrails appended to every action template.
 * Prevents the agent from checking out protected branches, retrying endlessly,
 * or running destructive operations without explanation.
 */
const SAFETY_FOOTER = `

IMPORTANT:
- Never switch to or check out main, master, or any base/protected branch. Always stay on the current feature branch.
- If you encounter an error you cannot resolve after two attempts, stop and explain the situation to the user rather than retrying the same approach.
- Never run \`git reset --hard\`, \`git clean -f\`, or \`git push --force\` (without --lease). These are destructive and irreversible.
- Before running any destructive git operation, explain what you are about to do and why.`;

/**
 * Built-in default templates for each action.
 * These provide detailed instructions to the agent beyond the short label.
 */
export const ACTION_TEMPLATES: Record<ActionTemplateKey, string> = {
  'resolve-conflicts': `## Resolve Merge Conflicts

1. Run \`git status\` to identify the in-progress operation (rebase, merge, cherry-pick, revert) and all conflicted files
2. If this is a rebase (step N of M), expect that resolving this step may reveal conflicts in subsequent steps
3. For each conflicted file:
   - **Text files**: Read the file, understand both sides, resolve conflict markers (<<<<<<, =======, >>>>>>>)
   - **Lock files** (package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock): Accept either side entirely, then regenerate by running the appropriate install command — never manually edit lock file contents
   - **Binary files** (images, compiled assets): Use \`git checkout --theirs <file>\` or \`git checkout --ours <file>\` based on which version is correct, then \`git add\`
   - **Submodule conflicts**: Use \`git checkout --theirs <path>\` or \`git checkout --ours <path>\` for the submodule pointer
4. If there are more than 15 conflicted files, prioritize: source code first, then config files, then generated files
5. Stage all resolved files with \`git add\`
6. Continue the operation:
   - Rebase: \`git rebase --continue\` (if it says "No changes", use \`git rebase --skip\`)
   - Merge: \`git commit\` (git will use the merge commit message)
   - Cherry-pick: \`git cherry-pick --continue\`
   - Revert: \`git revert --continue\`
7. If the operation has multiple remaining steps (rebase), repeat from step 1 for each subsequent conflict
8. After all conflicts are resolved, verify the code compiles/types check` + SAFETY_FOOTER,

  'fix-issues': `## Fix CI Failures

1. Analyze the failing checks and their error output carefully. Categorize each failure:
   - **Code failures**: build errors, type errors, test failures, lint errors
   - **Infrastructure failures**: timeouts, OOM, Docker issues, dependency resolution — these are not code problems
   - **Flaky tests**: failures that appear intermittent or unrelated to your changes
2. For infrastructure or flaky failures, check if the same workflow fails on the base branch using \`gh run list --workflow=<name> --branch=<base>\`. If it does, report this to the user rather than trying to fix a pre-existing issue
3. Fix code failures in priority order: build errors > type errors > test failures > lint errors
4. Run the relevant checks locally to verify fixes before pushing. Check package.json scripts, Makefile, or CI config to find the right commands
5. If a test needs updating due to intentional behavior changes, update the test expectations — but verify the new behavior is correct first
6. If a failure is in a module you did not modify, investigate whether your changes have indirect effects before making changes
7. Commit the fixes with a clear message describing what was fixed
8. Verify you are on the correct feature branch, then push
9. After pushing, CI will re-run automatically — do not re-trigger manually unless asked` + SAFETY_FOOTER,

  'continue-operation': `## Continue Git Operation

1. Run \`git status\` to identify the in-progress operation and its state (e.g., "rebase in progress: step 5 of 12")
2. If the operation has many remaining steps (e.g., step 2 of 30+), mention this to the user and offer to abort and try a merge strategy instead
3. If there are conflicted files, resolve each one:
   - Read the file to understand both sides and resolve conflict markers
   - For lock files, accept either side and regenerate
   - For binary files, use \`git checkout --theirs/--ours\`
   - Stage resolved files with \`git add\`
4. If all conflicts are resolved but \`git diff --cached\` shows no changes, use \`--skip\` to skip this step
5. Continue with the appropriate command: \`git rebase --continue\`, \`git merge --continue\`, \`git cherry-pick --continue\`, or \`git revert --continue\`
6. If the continue command fails:
   - "No changes": use \`--skip\`
   - "Could not apply": new conflict — go back to step 3
   - Editor opens: provide a commit message
7. If the operation cannot be continued cleanly after two attempts, explain and offer to abort with \`git <operation> --abort\`` + SAFETY_FOOTER,

  'sync-branch': `## Sync Branch

1. If there are uncommitted changes, save them with a temporary WIP commit: \`git commit -am "WIP: save changes before sync"\`
2. Fetch the latest changes: \`git fetch\`
3. Check how far behind the branch is. If significantly behind (100+ commits), mention this to the user
4. Follow the user's instruction for sync strategy:
   - **Rebase** (default): \`git rebase <target-branch>\`
   - **Merge**: \`git merge <target-branch>\`
   - **Pull only**: \`git pull\` (from the remote tracking branch)
5. If conflicts arise, resolve them carefully:
   - Preserve the intent of our branch's changes
   - Incorporate upstream changes correctly
   - For lock files, accept either side and regenerate
6. If you created a WIP commit in step 1, soft-reset it to restore uncommitted changes: \`git reset HEAD~1\`
7. Push the updated branch:
   - For rebase: \`git push --force-with-lease\` (not \`--force\`). If it fails because the remote was updated, fetch and retry once
   - For merge/pull: \`git push\` (no force needed)
   - Never force-push to main, master, or shared/protected branches
8. Verify the build passes after sync` + SAFETY_FOOTER,

  'create-pr': `## Create Pull Request

1. If there are uncommitted changes, commit them with a clear, descriptive message matching the repo's commit style
2. Push the branch to the remote if not already pushed: \`git push -u origin HEAD\`
3. Check if a PR already exists for this branch: \`gh pr view 2>/dev/null\`. If one exists, return its URL instead of creating a duplicate
4. Check for a PR template at \`.github/PULL_REQUEST_TEMPLATE.md\` or \`.github/pull_request_template.md\` and use it as a starting point for the description
5. Create the pull request using \`gh pr create\`:
   - Title: concise, under 72 characters, describes the change
   - Description: explain what changed, why, and how to test. Use the PR template if found
   - Link related issues using "Closes #N" or "Fixes #N" syntax
   - If the user asked for a draft, add the \`--draft\` flag
6. Return the PR URL` + SAFETY_FOOTER,

  'merge-pr': `## Merge Pull Request

1. Check PR status: \`gh pr view --json mergeStateStatus,reviewDecision,statusCheckRollup,mergeable\`
2. If CI checks are still running, inform the user and suggest waiting or enabling auto-merge
3. If CI checks have failed, do NOT merge — suggest fixing the issues first
4. If reviews are required but not yet approved, enable auto-merge so the PR merges once approved
5. If the branch is behind the base branch, rebase and push first
6. Determine the merge strategy from the user's message:
   - "squash" → \`--squash\` (default if unspecified)
   - "merge commit" → \`--merge\`
   - "rebase" → \`--rebase\`
7. Merge using \`gh pr merge\` with the chosen strategy (do NOT use \`--delete-branch\` — it corrupts worktree sessions)
8. If the merge is blocked by branch protection, enable auto-merge: \`gh pr merge --auto\` with the same strategy
9. If the repo uses a merge queue, \`gh pr merge\` will enqueue — confirm this to the user
10. Confirm the merge was successful or that auto-merge has been enabled` + SAFETY_FOOTER,

  'ship': `## Ship — Full Ship Workflow

### Step 1: Pre-flight
- Verify you are on a feature branch (NOT main/master). If on a protected branch, abort immediately.
- Detect the base branch: try \`gh pr view --json baseRefName -q .baseRefName\`, fall back to \`gh repo view --json defaultBranchRef -q .defaultBranchRef.name\`, then fall back to \`main\`.
- Run \`git status\` to see all uncommitted changes.

### Step 2: Sync with base branch
- Fetch and merge the base branch BEFORE running tests: \`git fetch origin <base> && git merge origin/<base> --no-edit\`
- This catches integration conflicts early. If merge conflicts arise, resolve them before proceeding.

### Step 3: Run tests
- Detect the test command: check \`package.json\` scripts for "test", check for a \`Makefile\` with "test" target, check CLAUDE.md for test instructions.
- Run the full test suite against the merged state. If tests fail, stop and report the failures — do not ship with failing tests.
- If no test framework is detected, note this and proceed.

### Step 4: Lint and type-check
- Run available lint commands (\`npm run lint\`, \`make lint\`, etc.)
- Run type-check if available (\`npm run typecheck\`, \`tsc --noEmit\`, \`make typecheck\`)
- Fix auto-fixable issues. For non-auto-fixable issues, report them but continue.

### Step 5: Review readiness
- Call the \`get_review_comment_stats\` MCP tool to check for unresolved review comments.
- If there are unresolved comments with severity "error" or "warning", warn the user: "There are N unresolved review comments. Consider addressing them before shipping."
- This is a warning, not a blocker — proceed if the user has already invoked /ship.

### Step 6: Commit
- If there are uncommitted changes, stage and commit them.
- Match the repo's commit message conventions (read \`git log --oneline -5\` for style).
- Write a clear, descriptive commit message summarizing the changes.

### Step 7: Push
- Push to remote: \`git push -u origin HEAD\`

### Step 8: Create PR
- Check if a PR already exists: \`gh pr view 2>/dev/null\`. If one exists, return its URL.
- Check for a PR template at \`.github/PULL_REQUEST_TEMPLATE.md\` or \`.github/pull_request_template.md\`.
- Create the PR with \`gh pr create\`:
  - Title: concise, under 72 characters
  - Description: what changed, why, and how to test. Use the PR template if found. Link related issues with "Closes #N".
- Return the PR URL.` + SAFETY_FOOTER,

  'deploy': `## Deploy — Merge PR, Monitor CI, and Verify

### Step 1: Pre-flight
- Verify GitHub CLI is authenticated: \`gh auth status\`
- Get PR details: \`gh pr view --json number,state,title,url,mergeStateStatus,mergeable,baseRefName,headRefName\`
- If no PR exists for this branch, abort: "No PR found. Run /ship first."
- If PR is already merged, report: "PR is already merged."
- If PR is closed (not merged), abort: "PR is closed. Reopen it first."

### Step 2: Pre-merge CI checks
- Check CI status: \`gh pr checks --json name,state,status,conclusion\`
- If any required checks are FAILING, abort and show the failures. Do NOT merge with failing CI.
- If checks are PENDING, wait: \`gh pr checks --watch --fail-fast\` (max 15 minutes).
- Check for merge conflicts: if \`mergeable\` is "CONFLICTING", abort: "PR has merge conflicts. Resolve them first."

### Step 3: Review readiness gate
- Call the \`get_review_comment_stats\` MCP tool.
- If there are unresolved review comments with severity "error" or "warning", warn the user with the count and ask whether to proceed or address them first.

### Step 4: Merge
- Auto-detect merge method: try \`gh pr merge --auto --squash\` first (respects repo settings and merge queues).
- If \`--auto\` is not available, merge directly: \`gh pr merge --squash\`
- Do NOT use \`--delete-branch\` — it corrupts worktree sessions.
- If merge queue is active, \`gh pr merge\` will enqueue automatically. Confirm this to the user.
- If merge fails with a permission error, report: "You don't have merge permissions."

### Step 5: Verify merge
- Confirm merge completed: \`gh pr view --json state -q .state\`
- Capture the merge commit SHA for tracking.

### Step 6: Deploy monitoring
- Check for deployment workflows: \`gh run list --branch <base> --limit 5 --json name,status,conclusion,headSha,workflowName\`
- Look for workflow names containing "deploy", "release", "production", or "cd".
- If a deploy workflow is detected, poll its status: \`gh run view <run-id> --json status,conclusion\` every 30 seconds.
- Report progress: "Deploy in progress..." with elapsed time.
- If deploy succeeds, continue to verification. If it fails, warn and suggest investigating logs or creating a revert PR.

### Step 7: Canary verification (optional)
- If Tauri webview MCP tools are available and a production URL is known:
  - Use \`mcp__tauri__webview_screenshot\` to capture the deployed page
  - Use \`mcp__tauri__webview_dom_snapshot\` to check for error elements or blank pages
  - Report: page loads correctly / has errors / is blank
- If canary detects issues, suggest creating a revert PR: "Production may be degraded. Consider reverting."

### Step 8: Deploy report
Present a structured summary:
\`\`\`
DEPLOY REPORT
═══════════════════
PR:        #<number> — <title>
Merged:    <timestamp> (squash)
CI:        PASSED / FAILED
Deploy:    HEALTHY / DEGRADED / NO WORKFLOW
Canary:    VERIFIED / SKIPPED
═══════════════════
\`\`\`` + SAFETY_FOOTER,

  'investigate': `## Investigate — Structured Debugging with Root Cause Analysis

You are following a systematic 5-phase debugging methodology. The Iron Law: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. Fixing symptoms creates whack-a-mole debugging.

### Phase 1: Root Cause Investigation

Gather context before forming any hypothesis.

1. **Collect symptoms**: Read error messages, stack traces, logs, and reproduction steps. If the user hasn't provided enough context, ask ONE clarifying question.
2. **Read the code**: Trace the code path from the symptom back to potential causes. Use Grep to find all references, Read to understand the logic.
3. **Check recent changes**: \`git log --oneline -20 -- <affected-files>\`. Was this working before? If so, the root cause is likely in the diff.
4. **Reproduce**: Can you trigger the bug deterministically? If not, gather more evidence before proceeding.
5. **Output**: State your root cause hypothesis — a specific, testable claim about what is wrong and why.

### Phase 2: Pattern Analysis

Classify the bug against known patterns:

| Pattern | Signature | Where to look |
|---------|-----------|---------------|
| Race condition | Intermittent, timing-dependent | Concurrent access to shared state |
| Nil/undefined propagation | TypeError, Cannot read property | Missing guards on optional values |
| State corruption | Inconsistent data, partial updates | Transactions, callbacks, hooks |
| Integration failure | Timeout, unexpected response | External API calls, service boundaries |
| Configuration drift | Works locally, fails in CI/prod | Env vars, feature flags, DB state |
| Stale cache | Shows old data, fixes on reload | Redis, CDN, browser cache, memoization |
| Off-by-one | Wrong count, missing first/last item | Loop boundaries, array indexing, pagination |
| Type coercion | Unexpected string/number behavior | Implicit conversions, comparisons |

Also check \`git log\` for prior fixes in the same area — recurring bugs in the same files are an architectural smell, not a coincidence.

### Phase 3: Hypothesis Testing

Before writing ANY fix, verify your hypothesis.

1. **Confirm**: Add a temporary log statement, assertion, or debug output at the suspected root cause. Run the reproduction. Does the evidence match?
2. **If wrong**: Return to Phase 1 with more evidence. Do NOT guess.
3. **3-strike rule**: If 3 hypotheses fail, STOP. Report to the user:
   - What was tried and what was observed
   - This may be an architectural issue rather than a simple bug
   - Recommendation: continue investigating with a new approach, escalate for human review, or add instrumentation to catch it next time

### Phase 4: Implementation

Once root cause is confirmed:

1. **Scope lock**: Restrict edits to the affected module/directory. Do not refactor adjacent code, add features, or "improve" unrelated things.
2. **Minimal diff**: Fix only the root cause, not symptoms. Fewest files touched, fewest lines changed.
3. **Regression test**: Write a test that FAILS without the fix and PASSES with it. This proves both that the test is meaningful and the fix works.
4. **Run the full test suite**. No regressions allowed.
5. **Blast radius check**: If the fix touches more than 5 files, flag this to the user and explain why the scope is that large.

### Phase 5: Verification & Report

1. **Fresh verification**: Reproduce the original bug scenario and confirm it is fixed. This is not optional.
2. **Run the test suite** and show the output.
3. **Structured debug report**:

\`\`\`
DEBUG REPORT
════════════════════════════════════════
Symptom:         [what the user observed]
Root cause:      [what was actually wrong]
Fix:             [what was changed, with file:line references]
Evidence:        [test output, reproduction showing fix works]
Regression test: [file:line of the new test]
Status:          DONE | DONE_WITH_CONCERNS | BLOCKED
════════════════════════════════════════
\`\`\`

### Important Rules
- Never say "this should fix it." Verify and prove it. Run the tests.
- Never apply a fix you cannot verify. If you can't reproduce and confirm, don't ship it.
- 3+ failed fix attempts → STOP and question the architecture.
- If fix touches >5 files → explain the blast radius before proceeding.` + SAFETY_FOOTER,

  'autoplan': `## Auto Review Pipeline — Orchestrated Multi-Pass Review

Run a comprehensive automated review pipeline covering product, design, code quality, and architecture. File review comments for each finding using MCP tools.

### Step 1: Context Gathering
- Call \`get_workspace_diff\` to understand all changes on this branch.
- Read the plan file if one exists (check for plan mode context).
- Identify the scope: which files changed, what features were added/modified, any UI changes.

### Step 2: Product Review Pass
Evaluate from a product perspective. For each finding, call \`add_review_comment\` with \`reviewType: 'product'\`.

Check for:
- **Scope creep**: Does the implementation exceed what was planned? Are there unnecessary additions?
- **User value**: Does every change serve a clear user need?
- **Requirement alignment**: Does the implementation match the stated requirements?
- **Feature completeness**: Are there half-implemented features or missing edge cases from a user perspective?
- **Unnecessary complexity**: Could the same user value be delivered with less code?

### Step 3: Design Review Pass (skip if no UI changes)
Evaluate UI/UX quality. For each finding, call \`add_review_comment\` with \`reviewType: 'design'\`.

Check for:
- **UX consistency**: Do interactions match existing patterns in the app?
- **Accessibility**: WCAG compliance — keyboard navigation, screen reader support, color contrast, ARIA attributes
- **Visual hierarchy**: Is the most important content most prominent?
- **Interaction patterns**: Are hover states, loading states, error states, and empty states handled?
- **Dark mode**: Do new components work in both themes?
- **AI slop detection**: Generic, placeholder-like text ("Lorem ipsum", "Click here", "Welcome to our platform") that suggests generated content

### Step 4: Deep Code Review Pass
Examine every changed file. For each finding, call \`add_review_comment\` with \`reviewType: 'deep'\`.

Check for:
- **Correctness**: Logic errors, off-by-one, null checks, type safety
- **Error handling**: Are errors caught, logged, and surfaced appropriately?
- **Edge cases**: Empty arrays, null values, concurrent access, boundary conditions
- **Naming**: Are variables, functions, and types named clearly and consistently?
- **DRY violations**: Duplicated code that should be extracted
- **Dead code**: Unused imports, unreachable branches, commented-out code

### Step 5: Architecture Review Pass
Evaluate structural quality. For each finding, call \`add_review_comment\` with \`reviewType: 'architecture'\`.

Check for:
- **Pattern consistency**: Does the code follow established patterns in the codebase?
- **Separation of concerns**: Is business logic mixed with UI? Are layers properly separated?
- **Coupling**: Are components tightly coupled when they should be independent?
- **API design**: Are interfaces clean, minimal, and well-typed?
- **Scalability**: Will this approach work at 10x the current load/data?

### Step 6: Auto-Decision Principles
When evaluating borderline findings, apply these principles:
1. **Completeness over speed** — prefer the thorough approach
2. **Pragmatic over perfect** — if two options fix the same thing, pick the cleaner one
3. **DRY** — flag duplicated functionality
4. **Explicit over clever** — 10-line obvious fix > 200-line abstraction
5. **Bias toward action** — flag concerns but don't block unnecessarily
6. **Minimal scope** — don't expand scope beyond the current change

### Step 7: Summary Gate
- Call \`get_review_comment_stats\` to get the final tally.
- Present a structured summary:

\`\`\`
REVIEW PIPELINE SUMMARY
═══════════════════════════════
Passes completed: Product, Design, Deep Code, Architecture
Findings by severity:
  Error:      N (must fix before shipping)
  Warning:    N (should fix)
  Suggestion: N (nice to have)
  Info:       N (informational)

Verdict: CLEARED / NEEDS ATTENTION / BLOCKED
═══════════════════════════════
\`\`\`

- If CLEARED: "All clear — no blocking findings. Ready to ship."
- If NEEDS ATTENTION: list the warning-level findings and recommend addressing them.
- If BLOCKED: list the error-level findings that must be fixed.` + SAFETY_FOOTER,

  'document-release': `## Document Release — Post-Ship Documentation Audit

Audit and update all documentation files to ensure they accurately reflect the current state of the code after shipping changes.

### Step 1: Pre-flight
- Verify you are on a feature branch (not main/master).
- Gather the diff: \`git diff main...HEAD --stat\` and \`git log main..HEAD --oneline\`
- List all changed files: \`git diff main...HEAD --name-only\`
- Discover documentation files: find all \`.md\` files in the repo (exclude node_modules, .git, vendor)

### Step 2: Classify Changes
Categorize the code changes into documentation-relevant groups:
- **New features**: new files, new commands, new capabilities, new API endpoints
- **Changed behavior**: modified services, updated APIs, configuration changes, renamed functions
- **Removed functionality**: deleted files, removed commands, deprecated features
- **Infrastructure**: build system, test infrastructure, CI, dependencies

### Step 3: Per-File Documentation Audit
For each documentation file found, cross-reference it against the diff:

**README.md:**
- Are all new features/capabilities described?
- Are installation and setup instructions still accurate?
- Are usage examples and demos still valid?
- Are screenshots or diagrams still current?

**ARCHITECTURE.md / DESIGN.md:**
- Do component descriptions match the current code structure?
- Are data flow diagrams still accurate?
- Be conservative — only update things clearly contradicted by the diff.

**CONTRIBUTING.md:**
- Are development workflow instructions still accurate?
- Are build/test/lint commands correct?
- Are code style guidelines still applicable?

**CLAUDE.md:**
- Are listed patterns and conventions still correct?
- Are test commands and build commands accurate?
- Are file path references still valid?

**CHANGELOG.md (if maintained):**
- Is the current change logged?
- If not, add an entry under the appropriate version/section.
- Match the existing CHANGELOG format and voice.

### Step 4: Auto-Update Rules
- **Auto-update** (do not ask): factual corrections — wrong file paths, renamed functions, changed CLI flags, updated version numbers, corrected counts, fixed broken cross-references.
- **Ask the user** before changing: narrative descriptions, architectural rationale, philosophical statements, rewording of existing explanations, removing sections.
- **Never overwrite or regenerate**: existing CHANGELOG entries. Polish wording only.

### Step 5: Report
Present a summary of what was checked and changed:

\`\`\`
DOCUMENTATION AUDIT
═══════════════════
File                  Status
─────────────────────────────
README.md             Updated (3 sections)
ARCHITECTURE.md       Up to date
CONTRIBUTING.md       Not found
CLAUDE.md             Updated (test command)
CHANGELOG.md          Added entry
═══════════════════
\`\`\`` + SAFETY_FOOTER,
};

/**
 * Metadata for the settings UI — label and placeholder for each template key.
 */
export const ACTION_TEMPLATE_META: { key: ActionTemplateKey; label: string; placeholder: string }[] = [
  { key: 'resolve-conflicts', label: 'Resolve Conflicts', placeholder: 'e.g., Always prefer our branch changes for package-lock.json' },
  { key: 'fix-issues', label: 'Fix Issues', placeholder: 'e.g., Run `npm test` locally before pushing fixes' },
  { key: 'continue-operation', label: 'Continue Operation', placeholder: 'e.g., Always abort if more than 3 conflicts remain' },
  { key: 'sync-branch', label: 'Sync Branch', placeholder: 'e.g., Use merge instead of rebase for this repo' },
  { key: 'create-pr', label: 'Create PR', placeholder: 'e.g., Always create as draft first' },
  { key: 'merge-pr', label: 'Merge PR', placeholder: 'e.g., Default to squash and merge' },
  { key: 'ship', label: 'Ship', placeholder: 'e.g., Always run tests before creating PR' },
  { key: 'deploy', label: 'Deploy', placeholder: 'e.g., Use rebase and merge instead of squash' },
  { key: 'investigate', label: 'Investigate', placeholder: 'e.g., Focus on state management bugs only' },
  { key: 'autoplan', label: 'Auto Review Pipeline', placeholder: 'e.g., Skip design review for backend-only changes' },
  { key: 'document-release', label: 'Document Release', placeholder: 'e.g., Also update API docs in docs/ folder' },
];

/**
 * Maps a PrimaryActionType to its template key.
 * Multiple action types can map to the same template key
 * (e.g., all continue-* variants map to 'continue-operation').
 * Returns null for actions that don't use templates (view-pr, archive-session).
 */
const ACTION_TYPE_TO_TEMPLATE: Record<string, ActionTemplateKey> = {
  'resolve-conflicts': 'resolve-conflicts',
  'fix-issues': 'fix-issues',
  'continue-rebase': 'continue-operation',
  'continue-merge': 'continue-operation',
  'continue-cherry-pick': 'continue-operation',
  'continue-revert': 'continue-operation',
  'sync-branch': 'sync-branch',
  'create-pr': 'create-pr',
  'merge-pr': 'merge-pr',
  'sprint-ship': 'ship',
  'sprint-deploy': 'deploy',
};

export function getTemplateKey(actionType: string): ActionTemplateKey | null {
  return ACTION_TYPE_TO_TEMPLATE[actionType] ?? null;
}

/**
 * Human-readable display names for template attachments.
 */
export const ACTION_TEMPLATE_NAMES: Record<ActionTemplateKey, string> = {
  'resolve-conflicts': 'Resolve Conflicts Instructions',
  'fix-issues': 'Fix Issues Instructions',
  'continue-operation': 'Continue Operation Instructions',
  'sync-branch': 'Sync Branch Instructions',
  'create-pr': 'Create PR Instructions',
  'merge-pr': 'Merge PR Instructions',
  'ship': 'Ship Instructions',
  'deploy': 'Deploy Instructions',
  'investigate': 'Investigate Instructions',
  'autoplan': 'Auto Review Pipeline Instructions',
  'document-release': 'Document Release Instructions',
};

const VALID_MODES: Set<string> = new Set<string>(['append', 'replace']);

/**
 * Parse the flat key-value map from the backend into structured overrides.
 * Keys like "resolve-conflicts" hold the text; "resolve-conflicts:mode" hold the mode.
 * Absence of a :mode key defaults to 'append' (the safer default — preserves built-in).
 */
export function parseOverrides(raw: Record<string, string>): Partial<Record<ActionTemplateKey, ActionTemplateOverride>> {
  const result: Partial<Record<ActionTemplateKey, ActionTemplateOverride>> = {};
  for (const key of Object.keys(ACTION_TEMPLATES) as ActionTemplateKey[]) {
    const text = raw[key];
    if (text) {
      const rawMode = raw[`${key}:mode`];
      const mode: OverrideMode = (rawMode && VALID_MODES.has(rawMode)) ? rawMode as OverrideMode : 'append';
      result[key] = { text, mode };
    }
  }
  return result;
}

/**
 * Serialize structured overrides back to the flat map for storage.
 * Only stores :mode keys when mode is 'replace' (append is the default).
 */
export function serializeOverrides(overrides: Partial<Record<ActionTemplateKey, ActionTemplateOverride>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, override] of Object.entries(overrides)) {
    if (override && override.text.trim()) {
      result[key] = override.text.trim();
      if (override.mode === 'replace') {
        result[`${key}:mode`] = 'replace';
      }
    }
  }
  return result;
}

/**
 * Fetches global and per-workspace overrides and merges them with built-in defaults.
 *
 * Merge strategy per key:
 *  - 'replace' at any level replaces everything below it.
 *  - 'append' stacks: builtIn + global append + workspace append.
 *  - Workspace replace wins over global (even if global is append).
 *  - Global replace replaces built-in; workspace append then appends to that.
 */
export async function fetchMergedActionTemplates(
  workspaceId: string,
  getGlobal: () => Promise<Record<string, string>>,
  getWorkspace: (id: string) => Promise<Record<string, string>>,
): Promise<Record<ActionTemplateKey, string>> {
  const [globalRaw, workspaceRaw] = await Promise.all([
    getGlobal().catch(() => ({} as Record<string, string>)),
    getWorkspace(workspaceId).catch(() => ({} as Record<string, string>)),
  ]);

  const globalOverrides = parseOverrides(globalRaw);
  const workspaceOverrides = parseOverrides(workspaceRaw);

  const merged = { ...ACTION_TEMPLATES };
  for (const key of Object.keys(ACTION_TEMPLATES) as ActionTemplateKey[]) {
    // Start from the built-in template without the safety footer — we'll
    // re-append it unconditionally at the end so it survives 'replace' overrides.
    let base = ACTION_TEMPLATES[key].replace(SAFETY_FOOTER, '');
    const global = globalOverrides[key];
    const workspace = workspaceOverrides[key];

    // Apply global override first
    if (global) {
      if (global.mode === 'replace') {
        base = global.text;
      } else {
        base = `${base}\n\n## Additional Instructions\n\n${global.text}`;
      }
    }

    // Apply workspace override on top
    if (workspace) {
      if (workspace.mode === 'replace') {
        base = workspace.text;
      } else {
        base = `${base}\n\n## Additional Instructions (Workspace)\n\n${workspace.text}`;
      }
    }

    // Always append safety guardrails after all overrides so they can't be
    // accidentally removed by a 'replace' override.
    merged[key] = base + SAFETY_FOOTER;
  }
  return merged;
}
