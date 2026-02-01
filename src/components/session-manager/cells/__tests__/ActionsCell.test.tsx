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
  it('shows archive button for active session', () => {
    renderWithTooltip(
      <ActionsCell
        session={activeSession}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    // Archive button should be present (Archive icon)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
  });

  it('shows preview and unarchive buttons for archived session', () => {
    renderWithTooltip(
      <ActionsCell
        session={archivedSession}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    // Should have 2 buttons (preview + unarchive)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('calls onArchive when archive button is clicked', async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();

    renderWithTooltip(
      <ActionsCell
        session={activeSession}
        onArchive={onArchive}
        onUnarchive={vi.fn()}
      />
    );

    const button = screen.getByRole('button');
    await user.click(button);
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it('calls onPreview when preview button is clicked', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();

    renderWithTooltip(
      <ActionsCell
        session={archivedSession}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onPreview={onPreview}
      />
    );

    // Preview is the first button for archived sessions
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('calls onUnarchive when unarchive button is clicked', async () => {
    const user = userEvent.setup();
    const onUnarchive = vi.fn();

    renderWithTooltip(
      <ActionsCell
        session={archivedSession}
        onArchive={vi.fn()}
        onUnarchive={onUnarchive}
        onPreview={vi.fn()}
      />
    );

    // Unarchive is the second button for archived sessions
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[1]);
    expect(onUnarchive).toHaveBeenCalledOnce();
  });

  it('does not render preview button when onPreview is undefined', () => {
    renderWithTooltip(
      <ActionsCell
        session={archivedSession}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
      />
    );

    // Only unarchive button should be present
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
  });
});
