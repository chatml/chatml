import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { createConversation } from '@/lib/api';
import { useSelectedIds } from '@/stores/selectors';

const REVIEW_PROMPTS: Record<string, string> = {
  quick:
    'Review the changes in this session. Use get_workspace_diff to see what changed, then use add_review_comment to leave inline comments. Focus on bugs, errors, and obvious issues. Be concise.',
  deep:
    'Do a thorough code review of all changes in this session. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each issue found. Check for bugs, performance problems, security issues, error handling gaps, and code quality. Be detailed and specific.',
  security:
    'Perform a security audit on the changes in this session. Use get_workspace_diff to see the full diff, then use add_review_comment to leave inline comments for each security concern. Look for injection vulnerabilities, authentication/authorization issues, data exposure, insecure defaults, and other OWASP top 10 risks.',
};

/**
 * Listens for `start-review` CustomEvents (dispatched by slash commands and command palette)
 * and creates a review conversation with the appropriate prompt.
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
      const message = REVIEW_PROMPTS[reviewType] || REVIEW_PROMPTS.quick;

      try {
        const conv = await createConversation(selectedWorkspaceId, selectedSessionId, {
          type: 'review',
          message,
        });

        if (stale) return;

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

        selectConversation(conv.id);
        setStreaming(conv.id, true);
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
