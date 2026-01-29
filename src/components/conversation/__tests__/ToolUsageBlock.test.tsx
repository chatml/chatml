import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolUsageBlock } from '../ToolUsageBlock';

describe('ToolUsageBlock', () => {
  it('renders tool name and target for Read', () => {
    render(
      <ToolUsageBlock
        id="t1"
        tool="Read"
        params={{ file_path: '/src/components/App.tsx' }}
        success={true}
        duration={150}
      />
    );

    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('renders Run label for Bash tool', () => {
    render(
      <ToolUsageBlock
        id="t2"
        tool="Bash"
        params={{ command: 'npm run test' }}
        success={true}
        duration={3200}
      />
    );

    // Bash tool shows "Run" label
    expect(screen.getByText('Run')).toBeInTheDocument();
  });

  it('shows active spinner when isActive', () => {
    const { container } = render(
      <ToolUsageBlock
        id="t3"
        tool="Write"
        params={{ file_path: '/src/new.ts' }}
        isActive={true}
      />
    );

    const spinners = container.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('shows success indicator when complete', () => {
    const { container } = render(
      <ToolUsageBlock
        id="t4"
        tool="Read"
        params={{ file_path: '/src/file.ts' }}
        success={true}
        duration={100}
      />
    );

    // Success shows a green dot (text-text-success class)
    const successDots = container.querySelectorAll('[class*="text-success"]');
    expect(successDots.length).toBeGreaterThan(0);
  });

  it('shows failure indicator when failed', () => {
    const { container } = render(
      <ToolUsageBlock
        id="t5"
        tool="Bash"
        params={{ command: 'failing-command' }}
        success={false}
        duration={50}
        stderr="Command not found"
      />
    );

    const errorDots = container.querySelectorAll('[class*="text-error"], [class*="destructive"]');
    expect(errorDots.length).toBeGreaterThan(0);
  });

  it('shows duration in seconds', () => {
    render(
      <ToolUsageBlock
        id="t6"
        tool="Read"
        params={{ file_path: '/src/file.ts' }}
        success={true}
        duration={1500}
      />
    );

    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('expands to show details on click', async () => {
    const user = userEvent.setup();
    render(
      <ToolUsageBlock
        id="t7"
        tool="Bash"
        params={{ command: 'echo hello' }}
        success={true}
        duration={100}
        stdout="hello"
      />
    );

    // Click to expand — find the trigger button via "Run" label
    const trigger = screen.getByText('Run').closest('button');
    if (trigger) {
      await user.click(trigger);
    }

    // stdout should become visible
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shows edit stats for Edit tool', () => {
    render(
      <ToolUsageBlock
        id="t8"
        tool="Edit"
        params={{
          file_path: '/src/app.tsx',
          old_string: 'line1\nline2',
          new_string: 'line1\nline2\nline3\nline4',
        }}
        success={true}
        duration={50}
      />
    );

    // Should show +2 lines added
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
