import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  formatRelativeTime,
  SectionHeader,
  InfoRow,
  StatusDot,
  PrStatusBadge,
} from '../SessionInfoParts';

vi.mock('@/lib/tauri', () => ({
  copyToClipboard: vi.fn(),
}));

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns "Xm ago" for timestamps minutes old', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns "Xh ago" for timestamps hours old', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns "Xd ago" for timestamps days old', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');
  });

  it('returns em dash for invalid date', () => {
    expect(formatRelativeTime('invalid')).toBe('\u2014');
  });
});

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

describe('SectionHeader', () => {
  it('renders label text', () => {
    render(<SectionHeader label="Session" />);
    expect(screen.getByText('Session')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InfoRow
// ---------------------------------------------------------------------------

describe('InfoRow', () => {
  it('renders label and value', () => {
    render(<InfoRow label="Name" value="Test Session" />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('renders copy button when copyValue is provided', () => {
    render(<InfoRow label="Branch" value="feature/auth" copyValue="feature/auth" />);
    expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument();
  });

  it('does not render copy button when copyValue is absent', () => {
    render(<InfoRow label="Name" value="Test" />);
    expect(screen.queryByTitle('Copy to clipboard')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

describe('StatusDot', () => {
  it('renders status text', () => {
    render(<StatusDot status="active" />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders dot with success color for active', () => {
    const { container } = render(<StatusDot status="active" />);
    const dot = container.querySelector('.bg-text-success');
    expect(dot).toBeInTheDocument();
  });

  it('renders dot with error color for error status', () => {
    const { container } = render(<StatusDot status="error" />);
    const dot = container.querySelector('.bg-text-error');
    expect(dot).toBeInTheDocument();
  });

  it('renders fallback color for unknown status', () => {
    const { container } = render(<StatusDot status="unknown" />);
    const dot = container.querySelector('.bg-muted-foreground');
    expect(dot).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PrStatusBadge
// ---------------------------------------------------------------------------

describe('PrStatusBadge', () => {
  it('renders "None" for status=none', () => {
    render(<PrStatusBadge status="none" />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders link when prUrl is provided', () => {
    render(<PrStatusBadge status="open" prNumber={42} prUrl="https://github.com/owner/repo/pull/42" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/42');
  });

  it('renders PR number when provided', () => {
    render(<PrStatusBadge status="open" prNumber={42} />);
    expect(screen.getByText(/^#42/)).toBeInTheDocument();
  });

  it('renders status text when no prNumber', () => {
    render(<PrStatusBadge status="merged" />);
    expect(screen.getByText(/merged/)).toBeInTheDocument();
  });
});
