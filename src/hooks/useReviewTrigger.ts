import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  createConversation,
  getGlobalReviewPrompts,
  getWorkspaceReviewPrompts,
  type AttachmentDTO,
} from '@/lib/api';
import { useSelectedIds } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { trackEvent } from '@/lib/telemetry';
import { toBase64 } from '@/lib/utils';

const MARKDOWN_INSTRUCTION =
  '\nWhen writing comment content, use Markdown formatting for detailed comments that include code examples, lists, or structured explanations (use fenced code blocks for code, bullet lists for multiple points, **bold** for emphasis). Keep simple one-sentence comments as plain text.';

const ACTIONABLE_ONLY_INSTRUCTION =
  '\n\nIMPORTANT: Only report actionable findings. Every comment must identify something that needs to be changed, fixed, or improved. Do NOT include positive feedback, praise, or purely informational observations like "Good implementation", "Nice pattern", "Well structured", or "This looks correct". If a file has no actionable issues, skip it silently.';

const REVIEW_TOOL_INSTRUCTIONS =
  'Start by calling get_workspace_diff (without parameters) to get an overview of all changed files and commits. ' +
  'Then examine each changed file in detail using get_workspace_diff with the file parameter. ' +
  'Read full source files around changes using Read/Glob/Grep to understand context beyond the diff. ' +
  'For each issue found, use add_review_comment with: ' +
  'filePath and lineNumber pointing to the most relevant line; ' +
  'a short descriptive title (under 60 chars, e.g., "Potential null pointer dereference"); ' +
  'detailed content explaining the problem and suggested fix; ' +
  'severity: error for bugs/correctness/security issues that must be fixed, warning for likely problems or anti-patterns, suggestion for improvements, info for notes that need no action. ' +
  'Avoid duplicate comments on the same issue — if a pattern repeats across files, comment on the first occurrence and mention it applies elsewhere. ';

const REVIEW_SUMMARY =
  'Call get_review_comment_stats at the end to summarize your findings. ';

const REVIEW_PROMPTS: Record<string, string> = {
  quick:
    'Do a quick scan of the changes. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Focus on high-signal issues only — your goal is speed, not thoroughness.\n\n' +
    'Review strategy:\n' +
    '1. Scan the file list from get_workspace_diff summary for anything suspicious (unexpected file types, large binaries)\n' +
    '2. Skim each changed file\'s diff looking ONLY for: logic bugs, incorrect conditions, off-by-one errors, null/undefined access, uncaught exceptions, and type errors\n' +
    '3. Stop at 5-7 comments maximum. If you find more issues, report only the most severe ones.\n\n' +
    'Severity guidance:\n' +
    '- error: Anything that will break at runtime or corrupt data\n' +
    '- warning: Suspicious logic that might break under certain conditions\n' +
    '- Do NOT use suggestion or info severity in a quick scan\n\n' +
    'Skip entirely: Style, formatting, naming conventions, missing tests, performance (unless obvious O(n²) or infinite loop), minor improvements, refactoring opportunities, positive observations. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  deep:
    'Do a thorough code review of all changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Examine every changed file for correctness, robustness, and quality as a senior engineer would.\n\n' +
    'Review strategy:\n' +
    '1. Start with get_workspace_diff summary to understand the scope and intent of the changes\n' +
    '2. For each changed file, read the full diff AND the surrounding source file to understand context\n' +
    '3. Trace data flow: follow inputs through transformations to outputs, checking for mishandled edge cases\n' +
    '4. Check that changes are consistent with each other (e.g., if a type changed in one file, verify all consumers updated)\n' +
    '5. Read related test files to verify coverage of new/changed behavior\n\n' +
    'Check for:\n' +
    '- Correctness: Logic errors, wrong comparisons, off-by-one, missing null checks, incorrect type assumptions, race conditions\n' +
    '- Error handling: Missing try/catch, swallowed errors, generic catch blocks that hide bugs, missing error propagation, incomplete cleanup in error paths\n' +
    '- Edge cases: Empty arrays/strings, undefined/null inputs, concurrent access, boundary values, large inputs\n' +
    '- API contracts: Changed function signatures that break callers, missing backward compatibility, inconsistent return types\n' +
    '- State management: Stale closures, missing dependency arrays in hooks, state updates after unmount, inconsistent state transitions\n' +
    '- Code quality: Dead code, unreachable branches, copy-paste with incomplete modifications, TODO comments without context\n\n' +
    'Severity guidance:\n' +
    '- error: Confirmed bugs, broken contracts, data loss scenarios\n' +
    '- warning: Likely bugs depending on runtime conditions, missing error handling in important paths, potential race conditions\n' +
    '- suggestion: Readability improvements, better patterns, minor simplifications\n' +
    '- info: Use sparingly, only for noting design decisions that need team discussion\n\n' +
    'Do NOT flag: Style preferences with no functional impact, theoretical performance issues without evidence of a hot path, "could be refactored" without a concrete benefit. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  security:
    'Perform a security-focused review of the changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Think like an attacker: how could these changes be exploited?\n\n' +
    'Review strategy:\n' +
    '1. Start with the file list to identify security-sensitive areas: API routes, auth logic, data access, user input handling, configuration, dependency changes\n' +
    '2. For security-sensitive files, read the FULL source file (not just the diff) to understand the security context — check whether inputs are validated upstream, whether auth middleware is applied, whether outputs are sanitized\n' +
    '3. Trace untrusted data from entry points (HTTP params, user input, file uploads, IPC messages, environment variables) through the code to where it is used\n' +
    '4. Check package.json / lock file changes for new dependencies that need security review\n\n' +
    'Check for:\n' +
    '- Injection: SQL injection, command injection, XSS (stored and reflected), template injection, path traversal, prototype pollution\n' +
    '- Authentication & authorization: Missing auth checks on new routes, privilege escalation, IDOR (insecure direct object references), JWT misuse, session fixation\n' +
    '- Data exposure: Secrets/API keys/tokens in code, PII in logs or error messages, overly verbose error responses, sensitive data in URLs\n' +
    '- Cryptography: Weak algorithms, hardcoded keys/IVs, missing HTTPS enforcement, insecure random number generation\n' +
    '- Configuration: Insecure defaults, debug mode enabled, CORS misconfiguration, missing rate limiting on new endpoints\n' +
    '- Dependencies: Known vulnerable packages, typosquatting risk in new dependencies, excessive permissions in dependency scopes\n' +
    '- Desktop/IPC (if applicable): Unsafe IPC message handling, filesystem access without validation, shell command construction from user input\n\n' +
    'Severity guidance:\n' +
    '- error: Exploitable vulnerabilities (injection, auth bypass, secret exposure), hardcoded credentials\n' +
    '- warning: Potential vulnerabilities that depend on deployment context, missing security headers, weak validation\n' +
    '- suggestion: Defense-in-depth improvements, additional input sanitization, logging improvements for security monitoring\n\n' +
    'Do NOT flag: Theoretical vulnerabilities in code that only handles trusted internal data (but DO note if the trust boundary is unclear), missing CSRF protection on non-mutating endpoints, generic "add rate limiting" without evidence of an abuse vector. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  performance:
    'Review the changes in this session for performance issues. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Focus on measurable impact, not micro-optimizations.\n\n' +
    'Review strategy:\n' +
    '1. Identify performance-critical paths: rendering hot paths, data fetching, event handlers, startup sequences, large list processing\n' +
    '2. For each changed file, determine if it is in a hot path or affects startup/rendering performance\n' +
    '3. Read surrounding code to understand call frequency — a slow function called once is fine; the same function called per-item in a list is not\n' +
    '4. Check for changes to data structures or algorithms that change time/space complexity\n\n' +
    'Check for:\n' +
    '- Rendering: Unnecessary re-renders (new object/array/function literals in JSX props, missing React.memo on expensive components, missing useMemo/useCallback where re-render cost is high), layout thrashing, synchronous DOM reads in render\n' +
    '- Memory: Event listeners not cleaned up in useEffect, growing collections without bounds, large objects retained in closures, subscriptions without unsubscription\n' +
    '- Data fetching: Waterfalling requests that could be parallelized, missing caching, refetching data already available, N+1 query patterns\n' +
    '- Computation: O(n²) or worse algorithms on unbounded inputs, expensive operations in loops, synchronous heavy work on the main thread, regex with catastrophic backtracking\n' +
    '- Bundle size: Large new imports that could be lazy-loaded or replaced with lighter alternatives, importing entire libraries for a single utility\n' +
    '- Desktop/IPC (if applicable): Excessive IPC calls that could be batched, large payloads serialized across process boundaries, blocking the main process with synchronous operations\n\n' +
    'Severity guidance:\n' +
    '- error: Confirmed performance regression (e.g., O(n²) on user data, memory leak in a long-lived component, main thread blocking >100ms)\n' +
    '- warning: Likely performance issue depending on data size or usage patterns (e.g., missing memoization in a component rendered in a list)\n' +
    '- suggestion: Optimization opportunity with minor impact (e.g., could lazy-load a rarely used module)\n\n' +
    'Do NOT flag: Missing memoization on components that render infrequently or have trivial render cost, "premature optimization" suggestions without evidence of actual impact, style preferences disguised as performance concerns (e.g., forEach vs for-of on small arrays), one-time startup costs unless they measurably delay initial render. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  architecture:
    'Review the changes in this session for architectural quality. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Evaluate structural quality and consistency with the existing codebase.\n\n' +
    'Review strategy:\n' +
    '1. Read the diff summary to understand the scope: Is this a new module, modification of existing code, or cross-cutting change?\n' +
    '2. For new files: Read 2-3 similar existing files in the same directory/module to identify established patterns (naming, file structure, exports, error handling approach)\n' +
    '3. For modified files: Check whether the changes maintain consistency with the rest of the file and its neighbors\n' +
    '4. Map the dependency graph of changed files — who imports what, and does the direction of dependencies make sense?\n\n' +
    'Check for:\n' +
    '- Pattern consistency: Does new code follow the same patterns as existing code in the module? (e.g., if other hooks use a specific store pattern, does this one too?) Flag divergence that lacks justification.\n' +
    '- Separation of concerns: Is business logic mixed into UI components? Are data access, transformation, and presentation in appropriate layers? Are side effects isolated?\n' +
    '- Coupling: Do changes create tight coupling between modules that should be independent? Are implementation details leaking across module boundaries? Are there circular dependencies?\n' +
    '- Abstraction level: Are new abstractions justified by actual reuse or complexity, or are they premature? Are existing abstractions being bypassed rather than extended?\n' +
    '- File organization: Are new files in the right directory? Do they follow the project\'s naming conventions? Is functionality split across files at natural boundaries?\n' +
    '- API design: Are new interfaces/types/function signatures consistent, well-named, and hard to misuse? Do they expose the right level of detail?\n' +
    '- Extensibility: Will this code be easy to modify when requirements change? Are there hardcoded assumptions that should be configurable?\n\n' +
    'Severity guidance:\n' +
    '- error: Architectural violations that will cause maintenance problems at scale (circular dependencies, bypassing established patterns in ways that confuse contributors, tight coupling that prevents independent testing)\n' +
    '- warning: Inconsistencies with established patterns, questionable separation of concerns, premature abstractions\n' +
    '- suggestion: Alternative patterns that would better fit the codebase, opportunities to consolidate duplicated structure\n\n' +
    'Do NOT flag: Philosophical preferences ("I would have done it differently") without concrete maintainability impact, SOLID violations in leaf code unlikely to change, "this could be more generic" when there is only one use case, naming preferences unless the name is actively misleading. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  premerge:
    'Perform a final pre-merge check on the changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Your job is to catch things that should never be merged, not to review code quality.\n\n' +
    'Review strategy:\n' +
    '1. Scan every changed file for mechanical issues (debug artifacts, secrets, incomplete code)\n' +
    '2. Check for files that should not be committed (use the full file list from get_workspace_diff)\n' +
    '3. Verify completeness: are there TODO comments that indicate unfinished work? Are there placeholder implementations?\n' +
    '4. Check test coverage for new functionality\n\n' +
    'Check for:\n' +
    '- Debug artifacts: console.log/console.debug used for debugging (not intentional logging), debugger statements, alert() calls, commented-out code blocks, temporary hardcoded values\n' +
    '- Secrets and sensitive files: .env files, API keys, tokens, passwords, private keys, certificates in the diff. Check for files matching patterns: *.pem, *.key, .env*, credentials.*, secrets.*\n' +
    '- Incomplete work: TODO/FIXME/HACK/XXX comments that reference the current work (not pre-existing ones — use git blame context), placeholder return values, unimplemented function bodies, partially applied refactors\n' +
    '- Accidentally committed files: Build artifacts (dist/, build/, .next/), IDE configs (.idea/, .vscode/settings.json with local paths), OS files (.DS_Store, Thumbs.db), large binaries, node_modules/\n' +
    '- Test coverage: New exported functions or components without corresponding test additions. Modified behavior without updated tests. Deleted tests without explanation.\n' +
    '- Error handling completeness: Empty catch blocks, promises without .catch(), async functions without try/catch in entry points (event handlers, API routes)\n' +
    '- Type safety: Any use of `as any`, `@ts-ignore`, `@ts-expect-error` without explanatory comments\n\n' +
    'Severity guidance:\n' +
    '- error: Committed secrets, .env files, debug artifacts that will affect users, completely missing error handling in user-facing code paths\n' +
    '- warning: TODOs referencing current work, missing test coverage for new features, empty catch blocks, unexplained ts-ignore\n' +
    '- suggestion: Minor cleanup items that are nice-to-have before merge\n\n' +
    'Do NOT flag: Pre-existing TODOs unrelated to the current changes, console.error or console.warn used for intentional error reporting, test files that use console.log for test debugging, type assertions (as SomeType) that are narrowing not widening. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  product:
    'Perform a product-focused review of the changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Think like a product owner: does this change deliver user value without scope creep?\n\n' +
    'Review strategy:\n' +
    '1. Start with get_workspace_diff summary to understand the scope and intent of the changes\n' +
    '2. For each changed file, evaluate whether the change aligns with stated requirements\n' +
    '3. Look at the full change set holistically — does it add unnecessary complexity?\n' +
    '4. Check that edge cases users would encounter are handled gracefully\n\n' +
    'Check for:\n' +
    '- Scope creep: Features, behaviors, or UI elements not in the original requirement. Extra configurability or options that add complexity without clear user value. "While I\'m here" refactors unrelated to the task.\n' +
    '- User value: Does every change contribute to a clear user-facing benefit? Are there changes that only benefit developers without improving the product?\n' +
    '- Requirement alignment: Do the changes actually solve the stated problem? Are there requirements that appear to be missed or partially implemented?\n' +
    '- Unnecessary complexity: Over-engineered solutions for simple problems. Premature abstractions. Feature flags or configuration options that add cognitive load without clear need.\n' +
    '- Feature completeness: Missing empty states, loading states, or error states that users will encounter. Missing keyboard shortcuts or accessibility paths for new interactions.\n' +
    '- Edge cases from user perspective: What happens with zero items, one item, many items? What if the user is offline, has slow network, or uses a screen reader?\n' +
    '- Copy and messaging: Are user-facing strings clear, consistent, and helpful? Are error messages actionable?\n\n' +
    'Severity guidance:\n' +
    '- error: Scope creep (significant work outside requirements), missing core requirements, broken user flows\n' +
    '- warning: Partial implementations that will confuse users, unclear copy, missing edge case handling\n' +
    '- suggestion: Opportunities to simplify, better copy, additional empty states\n\n' +
    'Do NOT flag: Code quality issues (that\'s for deep review), performance concerns (that\'s for performance review), security issues (that\'s for security review). Stay in the product lane. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  design:
    'Perform a design-focused review of the changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Think like a designer: evaluate visual quality, UX consistency, and accessibility.\n\n' +
    'Review strategy:\n' +
    '1. Start with get_workspace_diff summary to identify UI-related changes\n' +
    '2. For each UI file (components, styles, layouts), read the full file to understand the visual context\n' +
    '3. Check for consistency with existing patterns in sibling components\n' +
    '4. Look for accessibility and interaction quality issues\n\n' +
    'Check for:\n' +
    '- UX consistency: Do new UI elements match existing patterns? Same spacing, sizing, colors, fonts, border radii, and hover/active states as similar elements?\n' +
    '- Visual hierarchy: Is the information hierarchy clear? Primary actions visually prominent, secondary actions subdued? Proper use of typography weights and sizes?\n' +
    '- Accessibility (WCAG): Color contrast ratios (4.5:1 minimum for text), focus indicators on interactive elements, aria-labels on icon-only buttons, keyboard navigability, screen reader support\n' +
    '- Interaction patterns: Hover states, loading states, disabled states, transition animations. Do interactions feel responsive? Are click targets at least 44x44px on touch?\n' +
    '- Responsive behavior: Will the layout break or look odd at different panel widths? Are text elements properly truncated with ellipsis?\n' +
    '- AI slop detection: Generic placeholder text that reads like AI output (e.g., "Unlock the power of...", "Seamlessly integrate..."). Overly verbose tooltip text. Inconsistent capitalization or tone.\n' +
    '- Component reuse: Are new components reinventing existing primitives? Should an existing Button, Badge, Tooltip, or Dialog variant be used instead?\n' +
    '- Dark mode: If the app supports dark mode, are new color values using theme tokens (e.g., `text-foreground`, `bg-surface-1`) rather than hardcoded colors?\n\n' +
    'Severity guidance:\n' +
    '- error: Accessibility violations (missing aria-labels, no keyboard support, insufficient contrast), broken layouts, unusable interactions\n' +
    '- warning: Inconsistent styling vs existing patterns, missing states (hover, loading, error), hardcoded colors instead of theme tokens\n' +
    '- suggestion: Improved spacing, better copy, animation polish, component reuse opportunities\n\n' +
    'Do NOT flag: Business logic bugs (that\'s for deep review), performance concerns, backend changes with no UI impact. Stay in the design lane. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
};

const REVIEW_TYPE_META: { key: string; label: string; placeholder: string }[] = [
  { key: 'quick', label: 'Quick Scan', placeholder: 'e.g., Also flag any accessibility regressions' },
  { key: 'deep', label: 'Deep Review', placeholder: 'e.g., Trace data flow through the auth middleware' },
  { key: 'security', label: 'Security Audit', placeholder: 'e.g., Focus on IPC message validation and file access' },
  { key: 'performance', label: 'Performance', placeholder: 'e.g., Check IPC overhead and main thread blocking' },
  { key: 'architecture', label: 'Architecture', placeholder: 'e.g., Verify new hooks follow the existing store pattern' },
  { key: 'premerge', label: 'Pre-merge Check', placeholder: 'e.g., Ensure all TODO comments reference a ticket number' },
  { key: 'product', label: 'Product Review', placeholder: 'e.g., Check for scope creep and missing user edge cases' },
  { key: 'design', label: 'Design Review', placeholder: 'e.g., Verify dark mode tokens and accessibility compliance' },
];

const REVIEW_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  REVIEW_TYPE_META.map(({ key, label }) => [key, label])
);

/**
 * Fetches global and per-workspace overrides and merges them.
 * Per-workspace overrides take precedence over global.
 */
async function fetchMergedOverrides(workspaceId: string): Promise<Record<string, string>> {
  const [global, workspace] = await Promise.all([
    getGlobalReviewPrompts().catch(() => ({} as Record<string, string>)),
    getWorkspaceReviewPrompts(workspaceId).catch(() => ({} as Record<string, string>)),
  ]);
  const merged: Record<string, string> = {};
  for (const key of Object.keys(REVIEW_PROMPTS)) {
    const ws = workspace[key];
    const gl = global[key];
    if (ws) {
      merged[key] = ws;
    } else if (gl) {
      merged[key] = gl;
    }
  }
  return merged;
}

/**
 * Listens for `start-review` CustomEvents (dispatched by slash commands, command palette,
 * and toolbar review buttons) and creates a review conversation with the appropriate prompt.
 *
 * Fetches global and per-workspace custom prompt overrides inline when the review
 * is triggered, then appends them to the built-in default prompt.
 */
export function useReviewTrigger() {
  const { selectedWorkspaceId, selectedSessionId } = useSelectedIds();
  const addConversation = useAppStore((s) => s.addConversation);
  const addMessage = useAppStore((s) => s.addMessage);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const setStreaming = useAppStore((s) => s.setStreaming);

  useEffect(() => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    let stale = false;

    const handler = async (e: Event) => {
      const customEvent = e as CustomEvent<{ type?: string }>;
      const reviewType = customEvent.detail?.type || 'quick';
      const basePrompt = REVIEW_PROMPTS[reviewType] || REVIEW_PROMPTS.quick;

      // Fetch overrides inline to avoid stale-cache race condition
      let extra: string | undefined;
      try {
        const overrides = await fetchMergedOverrides(selectedWorkspaceId);
        extra = overrides[reviewType];
      } catch {
        // Use base prompt without overrides
      }

      try {
        const { reviewModel, reviewActionableOnly } = useSettingsStore.getState();

        let prompt = basePrompt;
        if (reviewActionableOnly) {
          prompt += ACTIONABLE_ONLY_INSTRUCTION;
        }

        const message = extra
          ? `${prompt}\n\nAdditional instructions:\n${extra}`
          : prompt;

        // Build short display text + instruction attachment (matching PrimaryActionButton pattern)
        const label = REVIEW_TYPE_LABELS[reviewType] || REVIEW_TYPE_LABELS['quick'] || 'Review';
        const shortContent = `Review: ${label}`;
        const attachmentName = `${label} Instructions`;

        const templateAttachment: AttachmentDTO = {
          id: crypto.randomUUID(),
          type: 'file',
          name: attachmentName,
          mimeType: 'text/markdown',
          size: new Blob([message]).size,
          lineCount: message.split('\n').length,
          base64Data: toBase64(message),
          preview: message.slice(0, 200),
          isInstruction: true,
        };

        const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
          type: 'review',
          message: shortContent,
          model: reviewModel,
          attachments: [templateAttachment],
        });
        trackEvent('review_started', { type: reviewType });

        // Always add the conversation and message to the store, even if the
        // user switched sessions. The conversation exists on the backend;
        // keeping the store in sync ensures the tab appears when the user
        // returns to the original session.
        addConversation({
          id: conv.id,
          sessionId: conv.sessionId,
          type: conv.type,
          name: conv.name,
          status: conv.status,
          messages: [],
          toolSummary: [],
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });

        addMessage({
          id: crypto.randomUUID(),
          conversationId: conv.id,
          role: 'user',
          content: shortContent,
          timestamp: new Date().toISOString(),
          attachments: [templateAttachment],
        });

        // Always mark streaming so WebSocket reconnection reconciliation
        // can discover this conversation if the connection drops mid-review.
        setStreaming(conv.id, true);

        // Only navigate to the review tab if the user is still on the
        // same session. Otherwise they'll see it when they switch back.
        if (!stale) {
          selectConversation(conv.id);
        }
      } catch (err) {
        if (!stale) console.error('Failed to start review:', err);
      }
    };

    window.addEventListener('start-review', handler);
    return () => {
      stale = true;
      window.removeEventListener('start-review', handler);
    };
  }, [selectedWorkspaceId, selectedSessionId, addConversation, addMessage, selectConversation, setStreaming]);
}

/** Exported for use in settings UI */
export { REVIEW_PROMPTS, REVIEW_TYPE_META };
