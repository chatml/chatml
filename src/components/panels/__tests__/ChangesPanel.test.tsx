import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection, CommitRow, formatCommitTime } from '../ChangesPanel';
import type { BranchCommitDTO } from '@/lib/api';

// ============================================================================
// formatCommitTime Tests
// ============================================================================

describe('formatCommitTime', () => {
  it('returns "just now" for timestamps less than 1 minute ago', () => {
    const now = new Date().toISOString();
    expect(formatCommitTime(now)).toBe('just now');
  });

  it('returns minutes ago for timestamps less than 1 hour ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatCommitTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago for timestamps less than 1 day ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatCommitTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days ago for timestamps less than 30 days ago', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatCommitTime(fiveDaysAgo)).toBe('5d ago');
  });

  it('returns localized date string for timestamps older than 30 days', () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatCommitTime(oldDate);
    // Should be a date string, not "Xd ago"
    expect(result).not.toContain('ago');
    expect(result).toMatch(/\d/); // Should contain at least a digit
  });

  it('handles edge case at exactly 1 minute', () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatCommitTime(oneMinAgo)).toBe('1m ago');
  });

  it('handles edge case at exactly 1 hour', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatCommitTime(oneHourAgo)).toBe('1h ago');
  });

  it('handles edge case at exactly 1 day', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatCommitTime(oneDayAgo)).toBe('1d ago');
  });
});

// ============================================================================
// CollapsibleSection Tests
// ============================================================================

describe('CollapsibleSection', () => {
  it('renders title and count', () => {
    render(
      <CollapsibleSection title="Uncommitted Changes" count={5} open={true} onToggle={() => {}}>
        <div>child content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Uncommitted Changes')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows children when open', () => {
    render(
      <CollapsibleSection title="Section" count={1} open={true} onToggle={() => {}}>
        <div>visible content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('visible content')).toBeInTheDocument();
  });

  it('hides children when closed', () => {
    render(
      <CollapsibleSection title="Section" count={1} open={false} onToggle={() => {}}>
        <div>hidden content</div>
      </CollapsibleSection>
    );

    expect(screen.queryByText('hidden content')).not.toBeInTheDocument();
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <CollapsibleSection title="Clickable Section" count={3} open={true} onToggle={onToggle}>
        <div>content</div>
      </CollapsibleSection>
    );

    await user.click(screen.getByText('Clickable Section'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows zero count', () => {
    render(
      <CollapsibleSection title="Empty" count={0} open={true} onToggle={() => {}}>
        <div>no items</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders with large count', () => {
    render(
      <CollapsibleSection title="Many" count={999} open={true} onToggle={() => {}}>
        <div>lots of items</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('999')).toBeInTheDocument();
  });
});

// ============================================================================
// CommitRow Tests
// ============================================================================

describe('CommitRow', () => {
  const mockCommit: BranchCommitDTO = {
    sha: 'abc123def456789012345678901234567890abcd',
    shortSha: 'abc123d',
    message: 'Add new feature for user authentication',
    author: 'Jane Doe',
    email: 'jane@example.com',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    files: [
      { path: 'src/auth.ts', additions: 50, deletions: 10, status: 'modified' as const },
      { path: 'src/login.tsx', additions: 120, deletions: 0, status: 'added' as const },
      { path: 'src/old-auth.ts', additions: 0, deletions: 80, status: 'deleted' as const },
    ],
  };

  const emptyCommentStats = new Map<string, { total: number; unresolved: number }>();

  it('renders commit short SHA', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={false}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    expect(screen.getByText('abc123d')).toBeInTheDocument();
  });

  it('renders commit message', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={false}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    expect(screen.getByText('Add new feature for user authentication')).toBeInTheDocument();
  });

  it('renders relative time', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={false}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('does not show files when collapsed', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={false}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    expect(screen.queryByText('auth.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('login.tsx')).not.toBeInTheDocument();
  });

  it('shows files when expanded', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={true}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    expect(screen.getByText('auth.ts')).toBeInTheDocument();
    expect(screen.getByText('login.tsx')).toBeInTheDocument();
    expect(screen.getByText('old-auth.ts')).toBeInTheDocument();
  });

  it('calls onToggle when commit row is clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <CommitRow
        commit={mockCommit}
        expanded={false}
        onToggle={onToggle}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    await user.click(screen.getByText('abc123d'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onFileSelect when a file is clicked', async () => {
    const onFileSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <CommitRow
        commit={mockCommit}
        expanded={true}
        onToggle={() => {}}
        onFileSelect={onFileSelect}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    await user.click(screen.getByText('auth.ts'));
    expect(onFileSelect).toHaveBeenCalledWith('src/auth.ts');
  });

  it('shows file stats when expanded', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={true}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    // Check for additions (from the first file: +50)
    expect(screen.getByText('+50')).toBeInTheDocument();
    expect(screen.getByText('-10')).toBeInTheDocument();
  });

  it('handles commit with no files', () => {
    const emptyCommit: BranchCommitDTO = {
      ...mockCommit,
      files: [],
    };

    render(
      <CommitRow
        commit={emptyCommit}
        expanded={true}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    // Should render the commit row without crashing
    expect(screen.getByText('abc123d')).toBeInTheDocument();
  });

  it('handles commit with long message by truncating', () => {
    const longMessageCommit: BranchCommitDTO = {
      ...mockCommit,
      message: 'This is a very long commit message that should be truncated by CSS in the actual UI rendering',
    };

    render(
      <CommitRow
        commit={longMessageCommit}
        expanded={false}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    expect(screen.getByText(longMessageCommit.message)).toBeInTheDocument();
  });

  it('renders multiple files with correct stats when expanded', () => {
    render(
      <CommitRow
        commit={mockCommit}
        expanded={true}
        onToggle={() => {}}
        onFileSelect={() => {}}
        containerWidth={400}
        commentStats={emptyCommentStats}
      />
    );

    // File 2: +120 additions only
    expect(screen.getByText('+120')).toBeInTheDocument();
    // File 3: -80 deletions only
    expect(screen.getByText('-80')).toBeInTheDocument();
  });
});
