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
3. Stage all resolved files with \`git add\`
4. If this is a rebase, run \`git rebase --continue\`; if a merge, commit the resolution
5. Verify the build still passes after resolution`,

  'fix-issues': `## Fix CI Failures

1. Analyze the failing checks and their error output carefully
2. Identify the root cause for each failure (test failure, lint error, type error, build error)
3. Fix each issue in priority order: build errors > type errors > test failures > lint
4. Run the relevant checks locally to verify fixes before pushing
5. If a test needs updating due to intentional behavior changes, update the test expectations
6. Push the fixes`,

  'continue-operation': `## Continue Git Operation

1. Check \`git status\` to see the current state of the operation
2. If there are remaining conflicts, resolve them
3. Stage resolved files
4. Continue the operation with the appropriate command (rebase --continue, merge --continue, etc.)
5. If the operation cannot be continued cleanly, explain the situation and suggest options`,

  'sync-branch': `## Sync Branch

1. Fetch the latest changes from the remote
2. Rebase the current branch onto the target branch
3. If conflicts arise during rebase, resolve them carefully:
   - Preserve the intent of our branch's changes
   - Incorporate the upstream changes correctly
4. Force-push the rebased branch (since history was rewritten)
5. Verify the build passes after sync`,

  'create-pr': `## Create Pull Request

1. Ensure all changes are committed and pushed
2. Create the pull request with a clear title and description
3. The PR title should be concise and describe the change
4. The PR description should explain what changed and why
5. Link any related issues`,

  'merge-pr': `## Merge Pull Request

1. Verify all CI checks have passed
2. Verify the branch is up to date with the base branch
3. If the branch is behind, rebase or merge the base branch first
4. Perform the merge using the requested strategy (squash, merge commit, or rebase)
5. Confirm the merge was successful`,
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
    let base = ACTION_TEMPLATES[key];
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

    merged[key] = base;
  }
  return merged;
}
