import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunSummaryBlock } from '../RunSummaryBlock';
import type { RunSummary } from '@/lib/types';

describe('RunSummaryBlock', () => {
  it('renders success status icon', () => {
    const { container } = render(
      <RunSummaryBlock summary={{ success: true, durationMs: 5000, turns: 3 }} />
    );
    // Success renders a CheckCircle2 icon with text-text-success class
    const successIcons = container.querySelectorAll('[class*="text-success"]');
    expect(successIcons.length).toBeGreaterThan(0);
  });

  it('renders failure status icon', () => {
    const { container } = render(
      <RunSummaryBlock summary={{ success: false, durationMs: 2000 }} />
    );
    // Failure renders an XCircle with text-destructive class
    const failIcons = container.querySelectorAll('[class*="text-destructive"]');
    expect(failIcons.length).toBeGreaterThan(0);
  });

  it('shows formatted duration', () => {
    render(
      <RunSummaryBlock summary={{ success: true, durationMs: 65000 }} />
    );
    expect(screen.getByText('1m 5s')).toBeInTheDocument();
  });

  it('shows cost when provided', () => {
    render(
      <RunSummaryBlock summary={{ success: true, cost: 0.05 }} />
    );
    expect(screen.getByText('$0.05')).toBeInTheDocument();
  });

  it('shows turn count when provided', () => {
    render(
      <RunSummaryBlock summary={{ success: true, turns: 7 }} />
    );
    expect(screen.getByText('7 turns')).toBeInTheDocument();
  });

  it('expands to show detailed stats', async () => {
    const user = userEvent.setup();
    const summary: RunSummary = {
      success: true,
      durationMs: 5000,
      turns: 3,
      stats: {
        toolCalls: 10,
        toolsByType: { Read: 5, Write: 3, Bash: 2 },
        subAgents: 0,
        filesRead: 5,
        filesWritten: 3,
        bashCommands: 2,
        webSearches: 0,
      },
    };

    render(<RunSummaryBlock summary={summary} />);

    // Click the trigger to expand
    const trigger = screen.getByRole('button');
    await user.click(trigger);

    // Detailed stats should appear — "Tool Breakdown" heading
    expect(screen.getByText('Tool Breakdown')).toBeInTheDocument();
  });
});
