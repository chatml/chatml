import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SummaryPicker } from '../SummaryPicker';
import type { SummaryDTO } from '@/lib/api';

// Mock the API module
vi.mock('@/lib/api', () => ({
  listSessionSummaries: vi.fn(),
}));

import { listSessionSummaries } from '@/lib/api';

const mockListSummaries = vi.mocked(listSessionSummaries);

function makeSummary(overrides: Partial<SummaryDTO> = {}): SummaryDTO {
  return {
    id: 'sum-1',
    conversationId: 'conv-1',
    sessionId: 'sess-1',
    conversationName: 'Auth Setup',
    content: 'This conversation implemented user authentication with JWT tokens and added login/logout endpoints.',
    status: 'completed',
    messageCount: 12,
    createdAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('SummaryPicker', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    selectedIds: [] as string[],
    onSelectionChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListSummaries.mockResolvedValue([]);
  });

  // ==========================================================================
  // Loading state
  // ==========================================================================

  it('shows loading state while fetching summaries', async () => {
    let resolvePromise: (value: SummaryDTO[]) => void;
    mockListSummaries.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    render(<SummaryPicker {...defaultProps} />);
    expect(screen.getByText('Loading summaries...')).toBeInTheDocument();

    // Resolve to avoid act warnings
    resolvePromise!([]);
    await waitFor(() =>
      expect(screen.queryByText('Loading summaries...')).not.toBeInTheDocument()
    );
  });

  // ==========================================================================
  // Empty state
  // ==========================================================================

  it('shows empty state when no summaries exist', async () => {
    mockListSummaries.mockResolvedValue([]);

    render(<SummaryPicker {...defaultProps} />);

    await waitFor(() =>
      expect(
        screen.getByText(/No summaries available/)
      ).toBeInTheDocument()
    );
  });

  // ==========================================================================
  // Rendering summaries
  // ==========================================================================

  it('renders summaries after loading', async () => {
    const summaries = [
      makeSummary({ id: 'sum-1', conversationId: 'conv-1', conversationName: 'Auth Setup', messageCount: 12 }),
      makeSummary({ id: 'sum-2', conversationId: 'conv-2', conversationName: 'Bug Fix', messageCount: 8 }),
    ];
    mockListSummaries.mockResolvedValue(summaries);

    render(<SummaryPicker {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Auth Setup')).toBeInTheDocument();
      expect(screen.getByText('Bug Fix')).toBeInTheDocument();
    });

    expect(screen.getByText('12 messages')).toBeInTheDocument();
    expect(screen.getByText('8 messages')).toBeInTheDocument();
  });

  it('shows content preview truncated to 150 chars', async () => {
    const longContent = 'A'.repeat(200);
    mockListSummaries.mockResolvedValue([
      makeSummary({ content: longContent }),
    ]);

    render(<SummaryPicker {...defaultProps} />);

    await waitFor(() => {
      // Preview is content.slice(0, 150) + "..."
      const preview = 'A'.repeat(150) + '...';
      expect(screen.getByText(preview)).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Selection
  // ==========================================================================

  it('calls onSelectionChange when clicking a summary to select', async () => {
    const user = userEvent.setup();
    mockListSummaries.mockResolvedValue([
      makeSummary({ id: 'sum-1', conversationName: 'Auth Setup' }),
    ]);

    render(<SummaryPicker {...defaultProps} selectedIds={[]} />);

    await waitFor(() => expect(screen.getByText('Auth Setup')).toBeInTheDocument());

    await user.click(screen.getByText('Auth Setup'));
    expect(defaultProps.onSelectionChange).toHaveBeenCalledWith(['sum-1']);
  });

  it('calls onSelectionChange when clicking a summary to deselect', async () => {
    const user = userEvent.setup();
    mockListSummaries.mockResolvedValue([
      makeSummary({ id: 'sum-1', conversationName: 'Auth Setup' }),
    ]);

    render(<SummaryPicker {...defaultProps} selectedIds={['sum-1']} />);

    await waitFor(() => expect(screen.getByText('Auth Setup')).toBeInTheDocument());

    await user.click(screen.getByText('Auth Setup'));
    expect(defaultProps.onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('supports selecting multiple summaries', async () => {
    const user = userEvent.setup();
    mockListSummaries.mockResolvedValue([
      makeSummary({ id: 'sum-1', conversationName: 'Auth Setup' }),
      makeSummary({ id: 'sum-2', conversationName: 'Bug Fix' }),
    ]);

    render(<SummaryPicker {...defaultProps} selectedIds={['sum-1']} />);

    await waitFor(() => expect(screen.getByText('Bug Fix')).toBeInTheDocument());

    await user.click(screen.getByText('Bug Fix'));
    expect(defaultProps.onSelectionChange).toHaveBeenCalledWith(['sum-1', 'sum-2']);
  });

  // ==========================================================================
  // Button text
  // ==========================================================================

  it('shows "Done" when no summaries selected', async () => {
    mockListSummaries.mockResolvedValue([]);

    render(<SummaryPicker {...defaultProps} selectedIds={[]} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    );
  });

  it('shows "Attach 1 summary" when one selected', async () => {
    mockListSummaries.mockResolvedValue([makeSummary()]);

    render(<SummaryPicker {...defaultProps} selectedIds={['sum-1']} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach 1 summary' })).toBeInTheDocument()
    );
  });

  it('shows "Attach 2 summaries" when two selected', async () => {
    mockListSummaries.mockResolvedValue([makeSummary()]);

    render(<SummaryPicker {...defaultProps} selectedIds={['sum-1', 'sum-2']} />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Attach 2 summaries' })
      ).toBeInTheDocument()
    );
  });

  // ==========================================================================
  // Dialog actions
  // ==========================================================================

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    mockListSummaries.mockResolvedValue([]);

    render(<SummaryPicker {...defaultProps} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) when Attach button is clicked', async () => {
    const user = userEvent.setup();
    mockListSummaries.mockResolvedValue([makeSummary()]);

    render(<SummaryPicker {...defaultProps} selectedIds={['sum-1']} />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Attach 1 summary' })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: 'Attach 1 summary' }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  // ==========================================================================
  // API call
  // ==========================================================================

  it('fetches summaries with correct workspace and session IDs', async () => {
    mockListSummaries.mockResolvedValue([]);

    render(<SummaryPicker {...defaultProps} workspaceId="ws-42" sessionId="sess-99" />);

    await waitFor(() =>
      expect(mockListSummaries).toHaveBeenCalledWith('ws-42', 'sess-99')
    );
  });

  it('does not fetch summaries when dialog is closed', () => {
    render(<SummaryPicker {...defaultProps} open={false} />);
    expect(mockListSummaries).not.toHaveBeenCalled();
  });

  it('renders dialog title', async () => {
    mockListSummaries.mockResolvedValue([]);
    render(<SummaryPicker {...defaultProps} />);

    await waitFor(() =>
      expect(
        screen.getByText('Attach Context from Previous Conversations')
      ).toBeInTheDocument()
    );
  });
});
