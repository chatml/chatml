import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { ReviewPanel } from '../ReviewPanel';
import { useAppStore } from '@/stores/appStore';
import type { ReviewComment } from '@/lib/types';

const API_BASE = 'http://localhost:9876';

// ── Test Data Factories ────────────────────────────────────────────────

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    sessionId: 'session-1',
    filePath: 'src/app.tsx',
    lineNumber: 42,
    title: 'Missing error handling',
    content: 'This function does not handle the error case when the API returns 500.',
    source: 'claude',
    author: 'Claude',
    severity: 'error',
    createdAt: new Date().toISOString(),
    resolved: false,
    ...overrides,
  };
}

const mockComments: ReviewComment[] = [
  makeComment({ id: 'c-1', severity: 'error', title: 'Potential null pointer', filePath: 'src/utils.ts', lineNumber: 10 }),
  makeComment({ id: 'c-2', severity: 'warning', title: 'Unused variable', filePath: 'src/app.tsx', lineNumber: 25 }),
  makeComment({ id: 'c-3', severity: 'suggestion', title: 'Consider memoization', filePath: 'src/hooks/useData.ts', lineNumber: 5 }),
  makeComment({ id: 'c-4', severity: 'info', title: 'API endpoint changed', filePath: 'src/lib/api.ts', lineNumber: 100 }),
  makeComment({ id: 'c-5', severity: 'error', title: 'Resolved bug', resolved: true }),
];

// ── Helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useAppStore.setState({
    reviewComments: {},
  });
}

function seedStore(sessionId: string, comments: ReviewComment[]) {
  useAppStore.getState().setReviewComments(sessionId, comments);
}

function setupMswListComments(comments: ReviewComment[]) {
  server.use(
    http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
      return HttpResponse.json(comments);
    })
  );
}

function setupMswListCommentsError(status = 500) {
  server.use(
    http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
      return HttpResponse.json({ error: 'Internal server error' }, { status });
    })
  );
}

function setupMswUpdateComment(response?: Partial<ReviewComment>) {
  server.use(
    http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, async ({ params }) => {
      return HttpResponse.json({
        ...makeComment({ id: params.commentId as string, resolved: true, resolvedBy: 'user' }),
        ...response,
      });
    })
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ReviewPanel', () => {
  beforeEach(() => {
    resetStore();
  });

  // ── Empty / loading states ───────────────────────────────────────────

  describe('empty and loading states', () => {
    it('shows placeholder when no sessionId is provided', () => {
      render(<ReviewPanel workspaceId="ws-1" sessionId={null} />);

      expect(screen.getByText('Select a session to view review comments')).toBeInTheDocument();
    });

    it('shows loading spinner while fetching', () => {
      // Use a handler that never resolves
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return new Promise(() => {}); // Never resolves
        })
      );

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      // The loading spinner should be visible (Loader2 from lucide)
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows empty state with hint when no comments exist', async () => {
      setupMswListComments([]);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('No review comments yet')).toBeInTheDocument();
      });
      expect(screen.getByText('Use /review to start a code review')).toBeInTheDocument();
    });

    it('shows "All comments resolved" when all comments are resolved', async () => {
      const allResolved = [
        makeComment({ id: 'r-1', resolved: true }),
        makeComment({ id: 'r-2', resolved: true }),
      ];
      setupMswListComments(allResolved);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('All comments resolved')).toBeInTheDocument();
      });
    });

    it('shows "No unresolved comments" when filter yields empty for a severity', async () => {
      // "No unresolved comments" shows when counts.all > 0 but filtered result is empty
      setupMswListComments([
        makeComment({ id: 'only-warning', severity: 'warning', title: 'A warning' }),
      ]);

      const user = userEvent.setup();

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('A warning')).toBeInTheDocument();
      });

      // Filter by error - there are no error comments, but counts.all > 0
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[1]); // error filter

      expect(screen.getByText('No unresolved comments')).toBeInTheDocument();
    });
  });

  // ── Data fetching ────────────────────────────────────────────────────

  describe('data fetching', () => {
    it('fetches comments from API on mount', async () => {
      const comments = [makeComment({ id: 'api-1', title: 'From API' })];
      setupMswListComments(comments);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('From API')).toBeInTheDocument();
      });
    });

    it('re-fetches when sessionId changes', async () => {
      const session1Comments = [makeComment({ id: 's1-1', title: 'Session 1 comment' })];
      const session2Comments = [makeComment({ id: 's2-1', title: 'Session 2 comment' })];

      let callCount = 0;
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, ({ params }) => {
          callCount++;
          if (params.sessionId === 'session-1') return HttpResponse.json(session1Comments);
          return HttpResponse.json(session2Comments);
        })
      );

      const { rerender } = render(
        <ReviewPanel workspaceId="ws-1" sessionId="session-1" />
      );

      await waitFor(() => {
        expect(screen.getByText('Session 1 comment')).toBeInTheDocument();
      });

      rerender(<ReviewPanel workspaceId="ws-1" sessionId="session-2" />);

      await waitFor(() => {
        expect(screen.getByText('Session 2 comment')).toBeInTheDocument();
      });

      expect(callCount).toBe(2);
    });

    it('handles API error gracefully (uses store data)', async () => {
      // Pre-seed store with data
      seedStore('session-1', [makeComment({ id: 'store-1', title: 'From store' })]);

      setupMswListCommentsError(500);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      // Should still show store data even after API failure
      await waitFor(() => {
        expect(screen.getByText('From store')).toBeInTheDocument();
      });
    });
  });

  // ── Comment rendering ────────────────────────────────────────────────

  describe('comment rendering', () => {
    beforeEach(() => {
      setupMswListComments(mockComments);
    });

    it('renders unresolved comments', async () => {
      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      });
      expect(screen.getByText('Unused variable')).toBeInTheDocument();
      expect(screen.getByText('Consider memoization')).toBeInTheDocument();
      expect(screen.getByText('API endpoint changed')).toBeInTheDocument();
    });

    it('does not render resolved comments', async () => {
      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      });
      expect(screen.queryByText('Resolved bug')).not.toBeInTheDocument();
    });

    it('shows file path and line number', async () => {
      setupMswListComments([makeComment({ filePath: 'src/deep/nested/file.ts', lineNumber: 77 })]);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('file.ts')).toBeInTheDocument();
      });
      expect(screen.getByText(':77')).toBeInTheDocument();
      expect(screen.getByText('src/deep/nested/')).toBeInTheDocument();
    });

    it('uses title for card heading, content for description', async () => {
      setupMswListComments([
        makeComment({
          title: 'Short title',
          content: 'This is a longer description explaining the issue in detail.',
        }),
      ]);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('Short title')).toBeInTheDocument();
      });
      expect(screen.getByText('This is a longer description explaining the issue in detail.')).toBeInTheDocument();
    });

    it('falls back to first line of content when no title', async () => {
      setupMswListComments([
        makeComment({
          title: undefined,
          content: 'First line used as title\nSecond line is the description.',
        }),
      ]);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('First line used as title')).toBeInTheDocument();
      });
      expect(screen.getByText('Second line is the description.')).toBeInTheDocument();
    });
  });

  // ── Filter bar ───────────────────────────────────────────────────────

  describe('severity filters', () => {
    beforeEach(() => {
      setupMswListComments(mockComments);
    });

    it('shows badge counts for each severity', async () => {
      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      // Wait for comments to load. "All" count = 4 unresolved (c-1..c-4, c-5 is resolved)
      await waitFor(() => {
        expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      });

      // The "All" button should show 4
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('filters by error severity', async () => {
      const user = userEvent.setup();

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      });

      // Click the error filter button (has AlertCircle icon)
      const errorButtons = screen.getAllByRole('button');
      // Error button is the second filter button (after "All")
      const errorButton = errorButtons[1];
      await user.click(errorButton);

      // Should only show error comments
      expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      expect(screen.queryByText('Unused variable')).not.toBeInTheDocument();
      expect(screen.queryByText('Consider memoization')).not.toBeInTheDocument();
      expect(screen.queryByText('API endpoint changed')).not.toBeInTheDocument();
    });

    it('clicking All resets filter to show all unresolved', async () => {
      const user = userEvent.setup();

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      });

      // Click error filter first
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[1]); // error filter

      // Then click All
      await user.click(screen.getByText('All'));

      // All unresolved should be visible again
      expect(screen.getByText('Potential null pointer')).toBeInTheDocument();
      expect(screen.getByText('Unused variable')).toBeInTheDocument();
      expect(screen.getByText('Consider memoization')).toBeInTheDocument();
      expect(screen.getByText('API endpoint changed')).toBeInTheDocument();
    });
  });

  // ── Resolve action ───────────────────────────────────────────────────

  describe('resolve action', () => {
    it('calls API when resolve button is clicked', async () => {
      const user = userEvent.setup();
      let patchCalled = false;

      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json([makeComment({ id: 'c-resolve-1', title: 'To resolve' })]);
        }),
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          patchCalled = true;
          return HttpResponse.json(makeComment({ id: 'c-resolve-1', resolved: true, resolvedBy: 'user' }));
        })
      );

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('To resolve')).toBeInTheDocument();
      });

      // Find and click the resolve button (checkmark icon)
      const resolveButton = screen.getByTitle('Resolve comment');
      await user.click(resolveButton);

      await waitFor(() => {
        expect(patchCalled).toBe(true);
      });
    });

    it('reverts optimistic update when API fails', async () => {
      const user = userEvent.setup();

      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json([makeComment({ id: 'c-fail-1', title: 'Will fail resolve' })]);
        }),
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        })
      );

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('Will fail resolve')).toBeInTheDocument();
      });

      const resolveButton = screen.getByTitle('Resolve comment');
      await user.click(resolveButton);

      // After API failure, the optimistic update should be reverted
      await waitFor(() => {
        const storeComments = useAppStore.getState().reviewComments['session-1'] || [];
        const comment = storeComments.find((c) => c.id === 'c-fail-1');
        expect(comment?.resolved).toBe(false);
      });
    });
  });

  // ── onFileSelect callback ────────────────────────────────────────────

  describe('onFileSelect callback', () => {
    it('calls onFileSelect with file path and line number when card is clicked', async () => {
      const user = userEvent.setup();
      const onFileSelect = vi.fn();

      setupMswListComments([
        makeComment({ filePath: 'src/index.ts', lineNumber: 33, title: 'Click me' }),
      ]);

      render(
        <ReviewPanel
          workspaceId="ws-1"
          sessionId="session-1"
          onFileSelect={onFileSelect}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Click me')).toBeInTheDocument();
      });

      // Click the comment card
      await user.click(screen.getByText('Click me'));

      expect(onFileSelect).toHaveBeenCalledWith('src/index.ts', 33);
    });
  });

  // ── Store integration ────────────────────────────────────────────────

  describe('store integration', () => {
    it('reads comments from Zustand store keyed by sessionId', async () => {
      const storeComments = [makeComment({ id: 'store-only', title: 'Store comment' })];
      seedStore('session-1', storeComments);

      // API returns same data as store
      setupMswListComments(storeComments);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      // After API fetch completes, store data is displayed
      await waitFor(() => {
        expect(screen.getByText('Store comment')).toBeInTheDocument();
      });
    });

    it('replaces store comments after API response', async () => {
      seedStore('session-1', [makeComment({ id: 'old', title: 'Old store comment' })]);

      setupMswListComments([makeComment({ id: 'new', title: 'New API comment' })]);

      render(<ReviewPanel workspaceId="ws-1" sessionId="session-1" />);

      await waitFor(() => {
        expect(screen.getByText('New API comment')).toBeInTheDocument();
      });
    });

    it('isolates comments between sessions', async () => {
      const commentsA = [makeComment({ id: 'a-1', title: 'Session A comment' })];
      const commentsB = [makeComment({ id: 'b-1', title: 'Session B comment' })];
      seedStore('session-A', commentsA);
      seedStore('session-B', commentsB);

      // API returns matching data per session
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, ({ params }) => {
          if (params.sessionId === 'session-A') return HttpResponse.json(commentsA);
          return HttpResponse.json(commentsB);
        })
      );

      const { rerender } = render(
        <ReviewPanel workspaceId="ws-1" sessionId="session-A" />
      );

      await waitFor(() => {
        expect(screen.getByText('Session A comment')).toBeInTheDocument();
      });
      expect(screen.queryByText('Session B comment')).not.toBeInTheDocument();

      rerender(<ReviewPanel workspaceId="ws-1" sessionId="session-B" />);

      await waitFor(() => {
        expect(screen.getByText('Session B comment')).toBeInTheDocument();
      });
      expect(screen.queryByText('Session A comment')).not.toBeInTheDocument();
    });
  });
});
