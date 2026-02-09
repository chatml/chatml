import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArchivedSessionPreviewDialog } from '../ArchivedSessionPreviewDialog';
import type { WorktreeSession, Workspace } from '@/lib/types';

vi.mock('@/lib/tauri', () => ({
  copyToClipboard: vi.fn(),
}));

const baseSession: WorktreeSession = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  name: 'Test Session',
  branch: 'feature/auth',
  worktreePath: '/home/user/workspaces/project/.worktrees/feature-auth',
  status: 'idle',
  priority: 0,
  taskStatus: 'in_progress',
  archived: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseWorkspace: Workspace = {
  id: 'ws-1',
  name: 'My Project',
  path: '/home/user/workspaces/project',
  defaultBranch: 'main',
  createdAt: new Date().toISOString(),
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  session: baseSession,
  workspace: baseWorkspace,
  onRestore: vi.fn(),
};

describe('ArchivedSessionPreviewDialog', () => {
  it('renders session name, branch, and workspace', () => {
    render(<ArchivedSessionPreviewDialog {...defaultProps} />);

    expect(screen.getByText('Test Session')).toBeInTheDocument();
    expect(screen.getAllByText('feature/auth').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('shows generating spinner when archiveSummaryStatus is generating', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, archiveSummaryStatus: 'generating' }}
      />
    );

    expect(screen.getByText('Generating summary...')).toBeInTheDocument();
  });

  it('shows summary text when status is completed', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{
          ...baseSession,
          archiveSummaryStatus: 'completed',
          archiveSummary: 'This session implemented OAuth2 authentication.',
        }}
      />
    );

    expect(screen.getByText('This session implemented OAuth2 authentication.')).toBeInTheDocument();
  });

  it('shows "No summary available" when status is empty', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, archiveSummaryStatus: '' }}
      />
    );

    expect(screen.getByText('No summary available')).toBeInTheDocument();
  });

  it('shows failure message when status is failed', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, archiveSummaryStatus: 'failed' }}
      />
    );

    expect(screen.getByText('Summary generation failed')).toBeInTheDocument();
  });

  it('shows task description when set', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, task: 'Implement OAuth2 login flow' }}
      />
    );

    expect(screen.getByText('Implement OAuth2 login flow')).toBeInTheDocument();
  });

  it('shows git stats when present', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, stats: { additions: 150, deletions: 30 } }}
      />
    );

    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('shows PR status badge when prStatus is not none', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{
          ...baseSession,
          prStatus: 'open',
          prNumber: 42,
          prUrl: 'https://github.com/owner/repo/pull/42',
        }}
      />
    );

    expect(screen.getByText(/#42/)).toBeInTheDocument();
  });

  it('shows merge conflict warning', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, hasMergeConflict: true }}
      />
    );

    expect(screen.getByText('Merge conflict')).toBeInTheDocument();
  });

  it('shows check failure warning', () => {
    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        session={{ ...baseSession, hasCheckFailures: true }}
      />
    );

    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('calls onRestore and closes dialog when Restore clicked', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ArchivedSessionPreviewDialog
        {...defaultProps}
        onRestore={onRestore}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it('shows worktree path as last 3 segments', () => {
    render(<ArchivedSessionPreviewDialog {...defaultProps} />);

    // /home/user/workspaces/project/.worktrees/feature-auth -> project/.worktrees/feature-auth
    expect(screen.getByText('project/.worktrees/feature-auth')).toBeInTheDocument();
  });
});
