import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionRow } from '../SessionRow';
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

function renderSessionRow(session: Partial<WorktreeSession>) {
  return render(
    <SessionRow
      session={{ ...baseSession, ...session }}
      workspace={workspace}
      onSelect={vi.fn()}
    />
  );
}

describe('SessionRow PR status text', () => {
  it('shows "Merged" for merged PR even when hasMergeConflict is true', () => {
    renderSessionRow({
      prStatus: 'merged',
      prNumber: 42,
      hasMergeConflict: true,
    });

    expect(screen.getByText('Merged')).toBeInTheDocument();
    expect(screen.queryByText('Merge conflict')).not.toBeInTheDocument();
  });

  it('shows "Merge conflict" for open PR with merge conflict', () => {
    renderSessionRow({
      prStatus: 'open',
      prNumber: 42,
      hasMergeConflict: true,
    });

    expect(screen.getByText('Merge conflict')).toBeInTheDocument();
    expect(screen.queryByText('Merged')).not.toBeInTheDocument();
  });

  it('shows "Merged" for merged PR without merge conflict', () => {
    renderSessionRow({
      prStatus: 'merged',
      prNumber: 42,
      hasMergeConflict: false,
    });

    expect(screen.getByText('Merged')).toBeInTheDocument();
  });

  it('shows "Ready to merge" for open PR without issues', () => {
    renderSessionRow({
      prStatus: 'open',
      prNumber: 42,
      hasMergeConflict: false,
      hasCheckFailures: false,
    });

    expect(screen.getByText('Ready to merge')).toBeInTheDocument();
  });

  it('shows "Checks failing" for open PR with check failures', () => {
    renderSessionRow({
      prStatus: 'open',
      prNumber: 42,
      hasCheckFailures: true,
    });

    expect(screen.getByText('Checks failing')).toBeInTheDocument();
  });

  it('shows "Working..." for active session with PR', () => {
    renderSessionRow({
      status: 'active',
      prStatus: 'open',
      prNumber: 42,
    });

    expect(screen.getByText('Working...')).toBeInTheDocument();
  });
});
