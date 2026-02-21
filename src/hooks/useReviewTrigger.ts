import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  createConversation,
  getGlobalReviewPrompts,
  getWorkspaceReviewPrompts,
} from '@/lib/api';
import { useSelectedIds } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';

const MARKDOWN_INSTRUCTION =
  '\nWhen writing comment content, use Markdown formatting for detailed comments that include code examples, lists, or structured explanations (use fenced code blocks for code, bullet lists for multiple points, **bold** for emphasis). Keep simple one-sentence comments as plain text.';

const REVIEW_PROMPTS: Record<string, string> = {
  quick:
    'Review the changes in this session. Use get_workspace_diff to see what changed, then use add_review_comment to leave inline comments. Focus on bugs, errors, and obvious issues. Be concise.' + MARKDOWN_INSTRUCTION,
  deep:
    'Do a thorough code review of all changes in this session. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each issue found. Check for bugs, performance problems, security issues, error handling gaps, and code quality. Be detailed and specific.' + MARKDOWN_INSTRUCTION,
  security:
    'Perform a security audit on the changes in this session. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each security concern. Look for injection vulnerabilities, authentication/authorization issues, data exposure, insecure defaults, and other OWASP top 10 risks.' + MARKDOWN_INSTRUCTION,
  performance:
    'Review the changes in this session for performance issues. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each concern. Look for unnecessary re-renders, memory leaks, expensive computations in hot paths, missing memoization, N+1 queries, and blocking operations. Call get_review_comment_stats at the end to summarize.' + MARKDOWN_INSTRUCTION,
  architecture:
    'Review the changes in this session for architectural quality. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each concern. Evaluate separation of concerns, coupling between modules, adherence to existing patterns in the codebase, SOLID principles, and appropriate abstractions. Call get_review_comment_stats at the end to summarize.' + MARKDOWN_INSTRUCTION,
  premerge:
    'Perform a final pre-merge check on the changes in this session. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each issue. Check for leftover TODOs, console.logs, debug code, commented-out code, missing error handling, incomplete implementations, and anything that should not be merged. Call get_review_comment_stats at the end to summarize.' + MARKDOWN_INSTRUCTION,
};

const REVIEW_TYPE_META: { key: string; label: string; placeholder: string }[] = [
  { key: 'quick', label: 'Quick Scan', placeholder: 'e.g., Also check for accessibility issues' },
  { key: 'deep', label: 'Deep Review', placeholder: 'e.g., Pay attention to test coverage gaps' },
  { key: 'security', label: 'Security Audit', placeholder: 'e.g., Check for OWASP top 10 specifically' },
  { key: 'performance', label: 'Performance', placeholder: 'e.g., Watch for unnecessary re-renders in React' },
  { key: 'architecture', label: 'Architecture', placeholder: 'e.g., We follow hexagonal architecture' },
  { key: 'premerge', label: 'Pre-merge Check', placeholder: 'e.g., Ensure all TODO comments reference a ticket' },
];

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

      const message = extra
        ? `${basePrompt}\n\nAdditional instructions:\n${extra}`
        : basePrompt;

      try {
        const { reviewModel } = useSettingsStore.getState();
        const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
          type: 'review',
          message,
          model: reviewModel,
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
          content: message,
          timestamp: new Date().toISOString(),
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
