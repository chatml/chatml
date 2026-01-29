import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolUsageHistory } from '../ToolUsageHistory';
import type { ToolUsage } from '@/lib/types';

describe('ToolUsageHistory', () => {
  const tools: ToolUsage[] = [
    { id: 't1', tool: 'Read', success: true, durationMs: 100, params: { file_path: '/src/app.tsx' } },
    { id: 't2', tool: 'Write', success: true, durationMs: 200, params: { file_path: '/src/new.ts' } },
    { id: 't3', tool: 'Bash', success: false, durationMs: 3000, params: { command: 'npm test' }, stderr: 'fail' },
  ];

  it('renders nothing when tools array is empty', () => {
    const { container } = render(<ToolUsageHistory tools={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows tool count', () => {
    render(<ToolUsageHistory tools={tools} />);
    // Renders "{count} tool(s)" — not "tools used"
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/tool/)).toBeInTheDocument();
  });

  it('shows success and fail counts', () => {
    render(<ToolUsageHistory tools={tools} />);
    expect(screen.getByText('2 passed')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('starts collapsed', () => {
    render(<ToolUsageHistory tools={tools} />);
    // The collapsible content should not show individual tool entries
    expect(screen.queryByText('Read')).toBeNull();
  });

  it('expands to show individual tools on click', async () => {
    const user = userEvent.setup();
    render(<ToolUsageHistory tools={tools} />);

    // Click the trigger button to expand
    const trigger = screen.getByRole('button');
    await user.click(trigger);

    // Individual tool names should appear
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });
});
