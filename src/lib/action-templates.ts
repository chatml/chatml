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
 * Prevents the agent from checking out protected branches or retrying endlessly.
 */
const SAFETY_FOOTER = `

IMPORTANT:
- Never switch to or check out main, master, or any base/protected branch. Always stay on the current feature branch.
- If you encounter an error you cannot resolve after two attempts, stop and explain the situation to the user rather than retrying the same approach.`;

/**
 * Built-in default templates for each action.
 * These provide detailed instructions to the agent beyond the short label.
 */
export const ACTION_TEMPLATES: Record<ActionTemplateKey, string> = {
  'resolve-conflicts': `## Resolve Merge Conflicts

1. Run \`git status\` to identify all files with conflicts
2. For each conflicted file:
   - Read the file to understand both sides of the conflict
   - Determine the correct resolution based on the intent of both changes
   - Resolve the conflict markers (<<<<<<, =======, >>>>>>>)
   - For lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock): accept either side, then regenerate by running the appropriate install command — never manually edit lock file contents
3. Stage all resolved files with \`git add\`
4. If this is a rebase, run \`git rebase --continue\`; if a merge, commit the resolution
5. Verify the code compiles and types check after resolution` + SAFETY_FOOTER,

  'fix-issues': `## Fix CI Failures

1. Analyze the failing checks and their error output carefully
2. Identify the root cause for each failure (test failure, lint error, type error, build error)
3. Fix each issue in priority order: build errors > type errors > test failures > lint
4. Run the relevant checks locally to verify fixes before pushing
5. If a test needs updating due to intentional behavior changes, update the test expectations
6. Commit the fixes with a clear message describing what was fixed
7. Verify you are on the correct feature branch, then push` + SAFETY_FOOTER,

  'continue-operation': `## Continue Git Operation

1. Run \`git status\` to identify the in-progress operation and its current state
2. If there are conflicted files, resolve each one:
   - Read the file to understand both sides
   - Resolve conflict markers
   - Stage resolved files with \`git add\`
3. If all conflicts are resolved but nothing changed (the resolution matches existing code), use \`--skip\` to skip this step
4. Continue with the appropriate command: \`git rebase --continue\`, \`git merge --continue\`, \`git cherry-pick --continue\`, or \`git revert --continue\`
5. If the operation cannot be continued cleanly, explain the situation and offer to abort` + SAFETY_FOOTER,

  'sync-branch': `## Sync Branch

1. Fetch the latest changes from the remote
2. Rebase the current branch onto the target branch
3. If conflicts arise during rebase, resolve them carefully:
   - Preserve the intent of our branch's changes
   - Incorporate the upstream changes correctly
4. Push the updated branch:
   - Use \`git push --force-with-lease\` (not \`--force\`) to avoid overwriting others' work
   - Never force-push to main, master, or shared/protected branches
5. Verify the build passes after sync` + SAFETY_FOOTER,

  'create-pr': `## Create Pull Request

1. Ensure all changes are committed
2. Push the branch to the remote if not already pushed
3. Create the pull request using \`gh pr create\`:
   - Title: concise, under 72 characters, describes the change
   - Description: explain what changed, why, and how to test
   - Link related issues using "Closes #N" or "Fixes #N" syntax
4. Return the PR URL` + SAFETY_FOOTER,

  'merge-pr': `## Merge Pull Request

1. Verify all CI checks have passed using \`gh pr checks\`
2. Verify the branch is up to date with the base branch
3. If the branch is behind, rebase onto the base branch and push first
4. Merge using \`gh pr merge\` with the appropriate flag (--squash, --merge, or --rebase)
5. Confirm the merge was successful and report the result` + SAFETY_FOOTER,
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
