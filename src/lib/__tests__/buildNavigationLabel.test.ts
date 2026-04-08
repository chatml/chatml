import { describe, it, expect, vi } from 'vitest';
import type { ContentView } from '@/stores/settingsStore';

// Mock stores that navigation.ts imports at module level
vi.mock('@/stores/appStore', () => ({
  useAppStore: { getState: () => ({}) },
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ contentView: { type: 'conversation' } }) },
}));
vi.mock('@/stores/tabStore', () => ({
  useTabStore: { getState: () => ({ updateActiveTab: vi.fn() }) },
}));

const { buildNavigationLabel } = await import('../navigation');

const workspaces = [
  { id: 'ws-1', name: 'My Repo' },
  { id: 'ws-2', name: 'Other Repo' },
];

const sessions = [
  { id: 'sess-1', name: 'fix-auth', branch: 'fix/auth-bug', workspaceId: 'ws-1' },
  { id: 'sess-2', name: '', branch: 'feature/new-ui', workspaceId: 'ws-2' },
  { id: 'sess-3', name: 'refactor', branch: 'refactor/core', workspaceId: 'ws-1' },
];

const conversations = [
  { id: 'conv-1', name: 'Task Chat' },
  { id: 'conv-2', name: 'Code Review' },
];

function label(
  contentView: ContentView,
  opts: {
    selectedWorkspaceId?: string | null;
    selectedSessionId?: string | null;
    selectedConversationId?: string | null;
  } = {},
): string {
  return buildNavigationLabel(contentView, {
    ...opts,
    sessions,
    conversations,
    workspaces,
  });
}

describe('buildNavigationLabel', () => {
  // ---------- Conversation views ----------

  describe('conversation', () => {
    it('returns "workspace › conversation" when both are available', () => {
      expect(label(
        { type: 'conversation' },
        { selectedWorkspaceId: 'ws-1', selectedSessionId: 'sess-1', selectedConversationId: 'conv-1' },
      )).toBe('My Repo › Task Chat');
    });

    it('returns "workspace › session" when no conversation is selected', () => {
      expect(label(
        { type: 'conversation' },
        { selectedWorkspaceId: 'ws-1', selectedSessionId: 'sess-1' },
      )).toBe('My Repo › fix-auth');
    });

    it('uses session branch when session name is empty', () => {
      expect(label(
        { type: 'conversation' },
        { selectedWorkspaceId: 'ws-2', selectedSessionId: 'sess-2' },
      )).toBe('Other Repo › feature/new-ui');
    });

    it('resolves workspace from session.workspaceId when selectedWorkspaceId is null', () => {
      expect(label(
        { type: 'conversation' },
        { selectedWorkspaceId: null, selectedSessionId: 'sess-1' },
      )).toBe('My Repo › fix-auth');
    });

    it('returns just conversation name when workspace is not found', () => {
      expect(label(
        { type: 'conversation' },
        { selectedWorkspaceId: 'ws-unknown', selectedSessionId: null, selectedConversationId: 'conv-2' },
      )).toBe('Code Review');
    });

    it('returns just session name when workspace is not found and session has no workspaceId match', () => {
      // Pass opts with no workspaceId and sessions without matching workspace
      const result = buildNavigationLabel(
        { type: 'conversation' },
        {
          selectedSessionId: 'sess-x',
          sessions: [{ id: 'sess-x', name: 'orphan', branch: 'orphan-branch', workspaceId: 'ws-gone' }],
          workspaces: [],
          conversations: [],
        },
      );
      expect(result).toBe('orphan');
    });

    it('returns "Conversation" when nothing is selected', () => {
      expect(label({ type: 'conversation' })).toBe('Conversation');
    });

    it('returns "Conversation" when session and conversation are not found', () => {
      expect(label(
        { type: 'conversation' },
        { selectedSessionId: 'nonexistent', selectedConversationId: 'nonexistent' },
      )).toBe('Conversation');
    });
  });

  // ---------- PR dashboard ----------

  describe('pr-dashboard', () => {
    it('returns "workspace › Pull Requests" with workspace', () => {
      expect(label({ type: 'pr-dashboard', workspaceId: 'ws-1' })).toBe('My Repo › Pull Requests');
    });

    it('returns "Pull Requests" without workspace', () => {
      expect(label({ type: 'pr-dashboard' } as ContentView)).toBe('Pull Requests');
    });

    it('returns "Pull Requests" when workspace not found', () => {
      expect(label({ type: 'pr-dashboard', workspaceId: 'ws-unknown' })).toBe('Pull Requests');
    });
  });

  // ---------- Branches ----------

  describe('branches', () => {
    it('returns "workspace › Branches" with workspace', () => {
      expect(label({ type: 'branches', workspaceId: 'ws-2' })).toBe('Other Repo › Branches');
    });

    it('returns "Branches" when workspace not found', () => {
      expect(label({ type: 'branches', workspaceId: 'ws-unknown' })).toBe('Branches');
    });
  });

  // ---------- Repositories ----------

  describe('repositories', () => {
    it('returns "Repositories"', () => {
      expect(label({ type: 'repositories' })).toBe('Repositories');
    });
  });

  // ---------- History ----------

  describe('history', () => {
    it('returns "History"', () => {
      expect(label({ type: 'history' })).toBe('History');
    });
  });

  // ---------- Unknown type ----------

  describe('unknown type', () => {
    it('returns "Unknown" for unrecognized content view type', () => {
      expect(label({ type: 'something-new' } as ContentView)).toBe('Unknown');
    });
  });

  // ---------- Edge cases ----------

  describe('edge cases', () => {
    it('works with empty opts', () => {
      expect(buildNavigationLabel({ type: 'conversation' })).toBe('Conversation');
    });

    it('works with empty arrays', () => {
      expect(buildNavigationLabel(
        { type: 'conversation' },
        { sessions: [], conversations: [], workspaces: [], selectedSessionId: 'sess-1' },
      )).toBe('Conversation');
    });
  });
});
