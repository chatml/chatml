import { describe, it, expect } from 'vitest';
import { formatReviewFeedback } from '../formatReviewFeedback';
import type { ReviewComment } from '@/lib/types';

// ── Test Data Factory ──────────────────────────────────────────────

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    sessionId: 'session-1',
    filePath: 'src/app.tsx',
    lineNumber: 42,
    content: 'Fix this issue',
    source: 'user',
    author: 'You',
    createdAt: new Date().toISOString(),
    resolved: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('formatReviewFeedback', () => {
  it('returns null for empty array', () => {
    expect(formatReviewFeedback([])).toBeNull();
  });

  it('returns null when all comments are resolved', () => {
    const comments = [
      makeComment({ id: '1', resolved: true }),
      makeComment({ id: '2', resolved: true }),
    ];
    expect(formatReviewFeedback(comments)).toBeNull();
  });

  it('formats a single comment', () => {
    const comments = [
      makeComment({
        filePath: 'src/utils.ts',
        lineNumber: 10,
        content: 'Missing null check',
        severity: 'error',
      }),
    ];

    const result = formatReviewFeedback(comments);

    expect(result).toContain('I have the following code review feedback');
    expect(result).toContain('## src/utils.ts');
    expect(result).toContain('- **Line 10** (error): Missing null check');
    expect(result).toContain('Please address these comments.');
  });

  it('groups comments by file path', () => {
    const comments = [
      makeComment({ id: '1', filePath: 'src/a.ts', lineNumber: 5, content: 'Comment A' }),
      makeComment({ id: '2', filePath: 'src/b.ts', lineNumber: 10, content: 'Comment B' }),
    ];

    const result = formatReviewFeedback(comments)!;

    expect(result).toContain('## src/a.ts');
    expect(result).toContain('## src/b.ts');
    expect(result).toContain('Comment A');
    expect(result).toContain('Comment B');
  });

  it('sorts comments by line number within each file', () => {
    const comments = [
      makeComment({ id: '1', filePath: 'src/app.ts', lineNumber: 100, content: 'Later line' }),
      makeComment({ id: '2', filePath: 'src/app.ts', lineNumber: 5, content: 'Earlier line' }),
      makeComment({ id: '3', filePath: 'src/app.ts', lineNumber: 50, content: 'Middle line' }),
    ];

    const result = formatReviewFeedback(comments)!;

    const line5Pos = result.indexOf('Line 5');
    const line50Pos = result.indexOf('Line 50');
    const line100Pos = result.indexOf('Line 100');

    expect(line5Pos).toBeLessThan(line50Pos);
    expect(line50Pos).toBeLessThan(line100Pos);
  });

  it('includes severity when present', () => {
    const comments = [
      makeComment({ id: '1', severity: 'warning', content: 'A warning' }),
    ];

    const result = formatReviewFeedback(comments)!;
    expect(result).toContain('(warning)');
  });

  it('omits severity parenthetical when not present', () => {
    const comments = [
      makeComment({ id: '1', severity: undefined, lineNumber: 7, content: 'No severity' }),
    ];

    const result = formatReviewFeedback(comments)!;
    expect(result).toContain('- **Line 7**: No severity');
    // Should NOT have empty parens
    expect(result).not.toContain('()');
  });

  it('filters out resolved comments', () => {
    const comments = [
      makeComment({ id: '1', resolved: false, content: 'Keep this' }),
      makeComment({ id: '2', resolved: true, content: 'Skip this' }),
    ];

    const result = formatReviewFeedback(comments)!;
    expect(result).toContain('Keep this');
    expect(result).not.toContain('Skip this');
  });

  it('handles multiple comments in multiple files', () => {
    const comments = [
      makeComment({ id: '1', filePath: 'src/a.ts', lineNumber: 10, severity: 'error', content: 'Error in A' }),
      makeComment({ id: '2', filePath: 'src/a.ts', lineNumber: 20, severity: 'warning', content: 'Warning in A' }),
      makeComment({ id: '3', filePath: 'src/b.ts', lineNumber: 5, content: 'Comment in B' }),
    ];

    const result = formatReviewFeedback(comments)!;

    // Check structure
    expect(result).toContain('## src/a.ts');
    expect(result).toContain('- **Line 10** (error): Error in A');
    expect(result).toContain('- **Line 20** (warning): Warning in A');
    expect(result).toContain('## src/b.ts');
    expect(result).toContain('- **Line 5**: Comment in B');
  });
});
