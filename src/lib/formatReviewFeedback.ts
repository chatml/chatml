import type { ReviewComment } from '@/lib/types';

/**
 * Format unresolved review comments into a structured markdown message
 * suitable for sending as AI feedback.
 *
 * Groups comments by file path, sorts by line number within each file,
 * and includes severity when present.
 */
export function formatReviewFeedback(comments: readonly ReviewComment[]): string | null {
  const unresolvedComments = comments.filter((c) => !c.resolved);
  if (unresolvedComments.length === 0) return null;

  // Group comments by file
  const byFile = new Map<string, ReviewComment[]>();
  for (const comment of unresolvedComments) {
    const existing = byFile.get(comment.filePath) || [];
    existing.push(comment);
    byFile.set(comment.filePath, existing);
  }

  // Format sections
  const sections: string[] = [];
  for (const [filePath, fileComments] of byFile) {
    const sorted = [...fileComments].sort((a, b) => a.lineNumber - b.lineNumber);
    const lines = sorted.map((c) => {
      const severity = c.severity ? ` (${c.severity})` : '';
      return `- **Line ${c.lineNumber}**${severity}: ${c.content}`;
    });
    sections.push(`## ${filePath}\n${lines.join('\n')}`);
  }

  return `I have the following code review feedback on your changes:\n\n${sections.join('\n\n')}\n\nPlease address these comments.`;
}
