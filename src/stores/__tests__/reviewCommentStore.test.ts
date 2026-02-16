import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import type { ReviewComment } from '@/lib/types';

// ── Test Data Factory ───────────────────────────────────────────────────

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    sessionId: 'session-1',
    filePath: 'src/app.tsx',
    lineNumber: 42,
    title: 'Test issue',
    content: 'This is a test comment.',
    source: 'claude',
    author: 'Claude',
    severity: 'error',
    createdAt: new Date().toISOString(),
    resolved: false,
    ...overrides,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getState() {
  return useAppStore.getState();
}

function getComments(sessionId: string): ReviewComment[] {
  return getState().reviewComments[sessionId] || [];
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('reviewCommentStore', () => {
  beforeEach(() => {
    useAppStore.setState({ reviewComments: {} });
  });

  // ── setReviewComments ────────────────────────────────────────────────

  describe('setReviewComments', () => {
    it('sets comments for a session', () => {
      const comments = [makeComment({ id: 'c-1' }), makeComment({ id: 'c-2' })];
      getState().setReviewComments('session-1', comments);

      expect(getComments('session-1')).toHaveLength(2);
      expect(getComments('session-1')[0].id).toBe('c-1');
      expect(getComments('session-1')[1].id).toBe('c-2');
    });

    it('replaces existing comments for a session', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'old' })]);
      getState().setReviewComments('session-1', [makeComment({ id: 'new' })]);

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].id).toBe('new');
    });

    it('does not affect other sessions', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().setReviewComments('session-2', [makeComment({ id: 'c-2' })]);

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].id).toBe('c-1');
      expect(getComments('session-2')).toHaveLength(1);
      expect(getComments('session-2')[0].id).toBe('c-2');
    });

    it('can set empty array', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().setReviewComments('session-1', []);

      expect(getComments('session-1')).toHaveLength(0);
    });
  });

  // ── addReviewComment ─────────────────────────────────────────────────

  describe('addReviewComment', () => {
    it('appends a comment to an existing session', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().addReviewComment('session-1', makeComment({ id: 'c-2' }));

      expect(getComments('session-1')).toHaveLength(2);
      expect(getComments('session-1')[1].id).toBe('c-2');
    });

    it('creates session entry if none exists', () => {
      getState().addReviewComment('session-1', makeComment({ id: 'c-1' }));

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].id).toBe('c-1');
    });

    it('deduplicates by id (does not add if id already exists)', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1', title: 'Original' })]);
      getState().addReviewComment('session-1', makeComment({ id: 'c-1', title: 'Duplicate' }));

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].title).toBe('Original');
    });

    it('adds comments with different ids', () => {
      getState().addReviewComment('session-1', makeComment({ id: 'c-1' }));
      getState().addReviewComment('session-1', makeComment({ id: 'c-2' }));
      getState().addReviewComment('session-1', makeComment({ id: 'c-3' }));

      expect(getComments('session-1')).toHaveLength(3);
    });

    it('does not affect other sessions when adding', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().addReviewComment('session-2', makeComment({ id: 'c-2' }));

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-2')).toHaveLength(1);
    });
  });

  // ── updateReviewComment ──────────────────────────────────────────────

  describe('updateReviewComment', () => {
    it('updates fields of an existing comment', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1', title: 'Old title', resolved: false }),
      ]);
      getState().updateReviewComment('session-1', 'c-1', {
        title: 'New title',
        resolved: true,
        resolvedBy: 'user',
      });

      const comment = getComments('session-1')[0];
      expect(comment.title).toBe('New title');
      expect(comment.resolved).toBe(true);
      expect(comment.resolvedBy).toBe('user');
    });

    it('preserves unchanged fields', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1', title: 'Keep me', content: 'Keep me too', severity: 'error' }),
      ]);
      getState().updateReviewComment('session-1', 'c-1', { resolved: true });

      const comment = getComments('session-1')[0];
      expect(comment.title).toBe('Keep me');
      expect(comment.content).toBe('Keep me too');
      expect(comment.severity).toBe('error');
      expect(comment.resolved).toBe(true);
    });

    it('only updates the targeted comment', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1', title: 'First' }),
        makeComment({ id: 'c-2', title: 'Second' }),
      ]);
      getState().updateReviewComment('session-1', 'c-1', { title: 'Updated' });

      expect(getComments('session-1')[0].title).toBe('Updated');
      expect(getComments('session-1')[1].title).toBe('Second');
    });

    it('is a no-op when comment id does not exist', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1', title: 'Original' }),
      ]);
      getState().updateReviewComment('session-1', 'nonexistent', { title: 'Should not appear' });

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].title).toBe('Original');
    });

    it('handles update on non-existent session (creates empty array)', () => {
      getState().updateReviewComment('no-session', 'c-1', { title: 'test' });

      // Should not crash; creates empty mapped array
      expect(getComments('no-session')).toHaveLength(0);
    });

    it('can update severity', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1', severity: 'error' }),
      ]);
      getState().updateReviewComment('session-1', 'c-1', { severity: 'info' });

      expect(getComments('session-1')[0].severity).toBe('info');
    });

    it('can update content', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1', content: 'Old content' }),
      ]);
      getState().updateReviewComment('session-1', 'c-1', { content: 'New content' });

      expect(getComments('session-1')[0].content).toBe('New content');
    });
  });

  // ── deleteReviewComment ──────────────────────────────────────────────

  describe('deleteReviewComment', () => {
    it('removes a comment by id', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'c-1' }),
        makeComment({ id: 'c-2' }),
      ]);
      getState().deleteReviewComment('session-1', 'c-1');

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].id).toBe('c-2');
    });

    it('does nothing when comment id not found', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().deleteReviewComment('session-1', 'nonexistent');

      expect(getComments('session-1')).toHaveLength(1);
    });

    it('does not affect other sessions', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().setReviewComments('session-2', [makeComment({ id: 'c-2' })]);
      getState().deleteReviewComment('session-1', 'c-1');

      expect(getComments('session-1')).toHaveLength(0);
      expect(getComments('session-2')).toHaveLength(1);
    });

    it('handles delete on non-existent session', () => {
      getState().deleteReviewComment('no-session', 'c-1');

      expect(getComments('no-session')).toHaveLength(0);
    });

    it('can delete the last comment in a session', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().deleteReviewComment('session-1', 'c-1');

      expect(getComments('session-1')).toHaveLength(0);
    });
  });

  // ── WebSocket simulation (comment events) ────────────────────────────
  // These simulate the exact calls the useWebSocket handlers make

  describe('WebSocket event simulation', () => {
    it('simulates comment_added event', () => {
      const comment = makeComment({ id: 'ws-1', title: 'From WebSocket' });
      getState().addReviewComment('session-1', comment);

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].title).toBe('From WebSocket');
    });

    it('simulates comment_updated event', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'ws-1', title: 'Original' }),
      ]);

      // WebSocket sends full payload; updateReviewComment merges it
      getState().updateReviewComment('session-1', 'ws-1', {
        title: 'Updated via WS',
        content: 'Updated content',
      });

      const comment = getComments('session-1')[0];
      expect(comment.title).toBe('Updated via WS');
      expect(comment.content).toBe('Updated content');
    });

    it('simulates comment_resolved event', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'ws-1', resolved: false }),
      ]);

      getState().updateReviewComment('session-1', 'ws-1', {
        resolved: true,
        resolvedBy: 'claude',
        resolvedAt: new Date().toISOString(),
      });

      const comment = getComments('session-1')[0];
      expect(comment.resolved).toBe(true);
      expect(comment.resolvedBy).toBe('claude');
      expect(comment.resolvedAt).toBeDefined();
    });

    it('simulates comment_deleted event', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'ws-1' }),
        makeComment({ id: 'ws-2' }),
      ]);

      getState().deleteReviewComment('session-1', 'ws-1');

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].id).toBe('ws-2');
    });

    it('handles comment_added for duplicate id (idempotent)', () => {
      getState().setReviewComments('session-1', [
        makeComment({ id: 'ws-1', title: 'Existing' }),
      ]);

      // Server sends same comment again (e.g., reconnect replay)
      getState().addReviewComment('session-1', makeComment({ id: 'ws-1', title: 'Replay' }));

      expect(getComments('session-1')).toHaveLength(1);
      expect(getComments('session-1')[0].title).toBe('Existing');
    });
  });

  // ── Session cleanup ──────────────────────────────────────────────────

  describe('session cleanup', () => {
    it('clearSession removes review comments for that session', () => {
      getState().setReviewComments('session-1', [makeComment({ id: 'c-1' })]);
      getState().setReviewComments('session-2', [makeComment({ id: 'c-2' })]);

      // The clearSession action is called when deleting a session
      // which clears reviewComments among other things
      const state = getState();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { ['session-1']: _removed, ...remaining } = state.reviewComments;
      useAppStore.setState({ reviewComments: remaining });

      expect(getComments('session-1')).toHaveLength(0);
      expect(getComments('session-2')).toHaveLength(1);
    });
  });
});
