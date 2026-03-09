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
import { toBase64 } from '@/lib/utils';

const MARKDOWN_INSTRUCTION =
  '\nWhen writing comment content, use Markdown formatting for detailed comments that include code examples, lists, or structured explanations (use fenced code blocks for code, bullet lists for multiple points, **bold** for emphasis). Keep simple one-sentence comments as plain text.';

const ACTIONABLE_ONLY_INSTRUCTION =
  '\n\nIMPORTANT: Only report actionable findings. Every comment must identify something that needs to be changed, fixed, or improved. Do NOT include positive feedback, praise, or purely informational observations like "Good implementation", "Nice pattern", "Well structured", or "This looks correct". If a file has no actionable issues, skip it silently.';

const REVIEW_TOOL_INSTRUCTIONS =
  'Use get_workspace_diff to examine all changes in this session. ' +
  'If the diff is large or truncated, use get_workspace_diff with the file parameter to examine specific files in detail. ' +
  'For each issue found, use add_review_comment with a short descriptive title and appropriate severity (error for bugs/critical issues, warning for potential problems, suggestion for improvements, info for notes). ';

const REVIEW_SUMMARY =
  'Call get_review_comment_stats at the end to summarize your findings. ';

const REVIEW_PROMPTS: Record<string, string> = {
  quick:
    'Do a quick scan of the changes. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Focus only on bugs, correctness errors, and obvious issues. Aim for at most 5-7 comments. Skip style, naming, and minor improvements. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  deep:
    'Do a thorough code review of all changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Check for bugs, performance problems, security issues, error handling gaps, and code quality. Be detailed and specific. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  security:
    'Perform a security-focused review of the changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Read full source files when needed to understand security context (e.g., whether inputs are validated upstream, whether auth is enforced at the route level). ' +
    'Look for injection vulnerabilities (SQL, command, XSS), authentication/authorization gaps, data exposure (secrets, PII in logs), insecure defaults, path traversal, and other OWASP top 10 risks. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  performance:
    'Review the changes in this session for performance issues. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Look for unnecessary re-renders, memory leaks, expensive computations in hot paths, missing memoization, N+1 queries, and blocking operations. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  architecture:
    'Review the changes in this session for architectural quality. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Read existing code in the same or similar modules to verify the changes follow established patterns. ' +
    'Evaluate separation of concerns, coupling between modules, adherence to existing codebase patterns, SOLID principles, and appropriate abstractions. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
  premerge:
    'Perform a final pre-merge check on the changes in this session. ' + REVIEW_TOOL_INSTRUCTIONS +
    'Check for leftover TODOs, console.logs, debug code, commented-out code, missing error handling, incomplete implementations, ' +
    'accidentally committed secrets or .env files, and anything that should not be merged. ' +
    REVIEW_SUMMARY + MARKDOWN_INSTRUCTION,
};

const REVIEW_TYPE_META: { key: string; label: string; placeholder: string }[] = [
  { key: 'quick', label: 'Quick Scan', placeholder: 'e.g., Also check for accessibility issues' },
  { key: 'deep', label: 'Deep Review', placeholder: 'e.g., Pay attention to test coverage gaps' },
  { key: 'security', label: 'Security Audit', placeholder: 'e.g., Check for OWASP top 10 specifically' },
  { key: 'performance', label: 'Performance', placeholder: 'e.g., Watch for unnecessary re-renders in React' },
  { key: 'architecture', label: 'Architecture', placeholder: 'e.g., We follow hexagonal architecture' },
  { key: 'premerge', label: 'Pre-merge Check', placeholder: 'e.g., Ensure all TODO comments reference a ticket' },
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
