import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileChangesBlock } from '../FileChangesBlock';
import type { FileChange } from '@/lib/types';

describe('FileChangesBlock', () => {
  const changes: FileChange[] = [
    { path: 'src/app.tsx', additions: 10, deletions: 3, status: 'modified' },
    { path: 'src/utils.ts', additions: 25, deletions: 0, status: 'added' },
    { path: 'src/old.ts', additions: 0, deletions: 15, status: 'deleted' },
  ];

  it('shows file count', () => {
    render(<FileChangesBlock changes={changes} />);
    expect(screen.getByText('3 files changed')).toBeInTheDocument();
  });

  it('shows total additions and deletions', () => {
    render(<FileChangesBlock changes={changes} />);
    expect(screen.getByText('+35')).toBeInTheDocument();
    expect(screen.getByText('-18')).toBeInTheDocument();
  });

  it('handles singular file', () => {
    render(<FileChangesBlock changes={[changes[0]]} />);
    expect(screen.getByText('1 file changed')).toBeInTheDocument();
  });

  it('starts collapsed by default', () => {
    render(<FileChangesBlock changes={changes} />);
    // Radix Collapsible removes hidden content from DOM
    expect(screen.queryByText('src/app.tsx')).toBeNull();
  });

  it('expands on click to show individual files', async () => {
    const user = userEvent.setup();
    render(<FileChangesBlock changes={changes} />);

    await user.click(screen.getByText('3 files changed'));

    expect(screen.getByText('src/app.tsx')).toBeVisible();
    expect(screen.getByText('src/utils.ts')).toBeVisible();
    expect(screen.getByText('src/old.ts')).toBeVisible();
  });
});
