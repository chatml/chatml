import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoryRow } from '../HistoryRow';
import type { WorktreeSession, Workspace } from '@/lib/types';

const baseSession: WorktreeSession = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  name: 'Test Session',
  branch: 'feature/test',
  worktreePath: '/path/to/worktree',
  status: 'idle',
  priority: 0,
  taskStatus: 'in_progress',
  archived: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const workspace: Workspace = {
  id: 'ws-1',
  name: 'chatml',
  path: '/repo',
  defaultBranch: 'main',
  remote: 'origin',
  branchPrefix: 'none',
  customPrefix: '',
  createdAt: new Date().toISOString(),
};

function renderHistoryRow(session: Partial<WorktreeSession>) {
  return render(
    <HistoryRow
      session={{ ...baseSession, ...session }}
      workspace={workspace}
      onSelect={vi.fn()}
    />
  );
}

describe('HistoryRow', () => {
  it('renders workspace name and branch', () => {
    renderHistoryRow({});

    expect(screen.getByText('chatml')).toBeInTheDocument();
    expect(screen.getByText('feature/test')).toBeInTheDocument();
  });

  it('renders PR title as description for open PR', () => {
    renderHistoryRow({
      prStatus: 'open',
      prTitle: 'Add user authentication',
    });

    expect(screen.getByText('Add user authentication')).toBeInTheDocument();
  });

  it('renders PR title as description for merged PR', () => {
    renderHistoryRow({
      prStatus: 'merged',
      prTitle: 'Fix login bug',
    });

    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
  });

  it('does not render PR title for closed PR', () => {
    renderHistoryRow({
      prStatus: 'closed',
      prTitle: 'Abandoned PR',
    });

    expect(screen.queryByText('Abandoned PR')).not.toBeInTheDocument();
  });

  it('renders diff stats when present', () => {
    renderHistoryRow({
      stats: { additions: 42, deletions: 7 },
    });

    expect(screen.getByText('+42')).toBeInTheDocument();
    expect(screen.getByText('-7')).toBeInTheDocument();
  });

  it('does not render diff stats when zero', () => {
    renderHistoryRow({
      stats: { additions: 0, deletions: 0 },
    });

    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('applies archived styling', () => {
    const { container } = renderHistoryRow({ archived: true });

    const row = container.firstElementChild;
    expect(row?.className).toContain('opacity-50');
  });

  it('renders task description when no PR', () => {
    renderHistoryRow({
      task: 'Fix the broken tests',
      prStatus: 'none',
    });

    expect(screen.getByText('Fix the broken tests')).toBeInTheDocument();
  });
});
