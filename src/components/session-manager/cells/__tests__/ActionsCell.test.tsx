import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActionsCell } from '../ActionsCell';
import type { WorktreeSession } from '@/lib/types';

const activeSession: WorktreeSession = {
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

const archivedSession: WorktreeSession = {
  ...activeSession,
  archived: true,
};

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('ActionsCell', () => {
  it('renders nothing for active session', () => {
    const { container } = renderWithTooltip(
      <ActionsCell session={activeSession} onPreview={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for archived session without onPreview', () => {
    const { container } = renderWithTooltip(
      <ActionsCell session={archivedSession} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows preview button for archived session with onPreview', () => {
    renderWithTooltip(
      <ActionsCell session={archivedSession} onPreview={vi.fn()} />
    );
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('calls onPreview when preview button is clicked', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();

    renderWithTooltip(
      <ActionsCell session={archivedSession} onPreview={onPreview} />
    );

    await user.click(screen.getByRole('button'));
    expect(onPreview).toHaveBeenCalledOnce();
  });
});
