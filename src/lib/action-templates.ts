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
  | 'merge-pr';

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
