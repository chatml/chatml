import { describe, it, expect } from 'vitest';
import { isSelectableSession, findSelectableSession } from '../sessionFilters';
import type { WorktreeSession } from '@/lib/types';

function makeSession(overrides: Partial<WorktreeSession>): WorktreeSession {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    name: 'session',
    branch: 'feature/branch',
    worktreePath: '/tmp/path',
    status: 'idle',
    priority: 0,
    taskStatus: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('isSelectableSession', () => {
  it('rejects archived sessions regardless of flag', () => {
    const archived = makeSession({ archived: true, sessionType: 'worktree' });
    expect(isSelectableSession(archived, true)).toBe(false);
    expect(isSelectableSession(archived, false)).toBe(false);
  });

  it('rejects base sessions when showBaseBranchSessions is false', () => {
    const base = makeSession({ sessionType: 'base' });
    expect(isSelectableSession(base, false)).toBe(false);
  });

  it('accepts base sessions when showBaseBranchSessions is true', () => {
    const base = makeSession({ sessionType: 'base' });
    expect(isSelectableSession(base, true)).toBe(true);
  });

  it('accepts non-archived worktree sessions in either mode', () => {
    const worktree = makeSession({ sessionType: 'worktree' });
    expect(isSelectableSession(worktree, true)).toBe(true);
    expect(isSelectableSession(worktree, false)).toBe(true);
  });

  it('treats undefined sessionType (legacy rows) as worktree', () => {
    const legacy = makeSession({ sessionType: undefined });
    expect(isSelectableSession(legacy, false)).toBe(true);
  });
});

describe('findSelectableSession', () => {
  const baseChat = makeSession({
    id: 'base-chat',
    workspaceId: 'ws-chat',
    sessionType: 'base',
  });
  const worktreeChat = makeSession({
    id: 'wt-chat',
    workspaceId: 'ws-chat',
    sessionType: 'worktree',
  });
  const worktreeChatArchived = makeSession({
    id: 'wt-chat-old',
    workspaceId: 'ws-chat',
    sessionType: 'worktree',
    archived: true,
  });
  const baseOther = makeSession({
    id: 'base-other',
    workspaceId: 'ws-other',
    sessionType: 'base',
  });

  it('skips base sessions in the same workspace when flag is off', () => {
    const sessions = [baseChat, worktreeChatArchived, worktreeChat];
    expect(
      findSelectableSession(sessions, 'ws-chat', false)?.id,
    ).toBe('wt-chat');
  });

  it('returns undefined when only a base session remains and flag is off', () => {
    const sessions = [baseChat, worktreeChatArchived];
    expect(
      findSelectableSession(sessions, 'ws-chat', false),
    ).toBeUndefined();
  });

  it('returns the base session when flag is on and no worktrees remain', () => {
    const sessions = [baseChat, worktreeChatArchived];
    expect(
      findSelectableSession(sessions, 'ws-chat', true)?.id,
    ).toBe('base-chat');
  });

  it('scopes search to the requested workspace', () => {
    const sessions = [baseOther, worktreeChat];
    expect(
      findSelectableSession(sessions, 'ws-chat', false)?.id,
    ).toBe('wt-chat');
  });

  it('searches across all workspaces when workspaceId is null', () => {
    const sessions = [baseOther, worktreeChatArchived, worktreeChat];
    expect(
      findSelectableSession(sessions, null, false)?.id,
    ).toBe('wt-chat');
  });
});
