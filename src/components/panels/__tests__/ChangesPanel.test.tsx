import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection, ChangesFileList } from '../ChangesPanel';
import type { FileChangeDTO, BranchStatsDTO } from '@/lib/api';

// ============================================================================
// CollapsibleSection Tests
// ============================================================================

describe('CollapsibleSection', () => {
  it('renders title and count', () => {
    render(
      <CollapsibleSection title="Working Changes" count={5} open={true} onToggle={() => {}}>
        <div>child content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Working Changes')).toBeInTheDocument();
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
// ChangesFileList Tests
// ============================================================================

const makeFile = (path: string, status: FileChangeDTO['status'], additions = 10, deletions = 5): FileChangeDTO => ({
  path,
  additions,
  deletions,
  status,
});

const defaultProps = {
  changes: [] as FileChangeDTO[],
  allChanges: [] as FileChangeDTO[],
  branchStats: null as BranchStatsDTO | null,
  changesView: 'all' as const,
  onChangesViewChange: vi.fn(),
  onFileSelect: vi.fn(),
  onChangedFileSelect: vi.fn(),
  containerWidth: 400,
  commentStats: new Map<string, { total: number; unresolved: number }>(),
};

describe('ChangesFileList', () => {
  it('renders files grouped by status in "all" view', () => {
    const allChanges = [
      makeFile('src/new.ts', 'added'),
      makeFile('src/app.ts', 'modified'),
      makeFile('old.ts', 'deleted'),
    ];

    render(
      <ChangesFileList
        {...defaultProps}
        allChanges={allChanges}
        branchStats={{ totalFiles: 3, totalAdditions: 30, totalDeletions: 15 }}
      />
    );

    expect(screen.getByText('ADDED')).toBeInTheDocument();
    expect(screen.getByText('MODIFIED')).toBeInTheDocument();
    expect(screen.getByText('DELETED')).toBeInTheDocument();
  });

  it('shows branch stats in "all" view', () => {
    render(
      <ChangesFileList
        {...defaultProps}
        allChanges={[makeFile('a.ts', 'added', 10, 5)]}
        branchStats={{ totalFiles: 5, totalAdditions: 200, totalDeletions: 80 }}
      />
    );

    // Stats header shows branchStats, not per-file stats
    expect(screen.getByText('+200')).toBeInTheDocument();
    expect(screen.getByText('-80')).toBeInTheDocument();
    expect(screen.getByText('across 5 files')).toBeInTheDocument();
  });

  it('computes stats from uncommitted changes in "uncommitted" view', () => {
    const changes = [
      makeFile('a.ts', 'modified', 10, 3),
      makeFile('b.ts', 'modified', 5, 2),
    ];

    render(
      <ChangesFileList
        {...defaultProps}
        changes={changes}
        changesView="uncommitted"
        branchStats={{ totalFiles: 10, totalAdditions: 500, totalDeletions: 200 }}
      />
    );

    // Should show computed stats from uncommitted, not branch stats
    expect(screen.getByText('+15')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
    expect(screen.getByText('across 2 files')).toBeInTheDocument();
  });

  it('shows zeros when "all" view has no branchStats', () => {
    render(
      <ChangesFileList
        {...defaultProps}
        changesView="all"
        branchStats={null}
        changes={[makeFile('a.ts', 'modified', 10, 3)]}
      />
    );

    // Should NOT fall back to uncommitted stats — should show nothing (0 files)
    expect(screen.queryByText('+10')).not.toBeInTheDocument();
    expect(screen.queryByText('across')).not.toBeInTheDocument();
  });

  it('calls onFileSelect for untracked files (not diff view)', async () => {
    const onFileSelect = vi.fn();
    const onChangedFileSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <ChangesFileList
        {...defaultProps}
        allChanges={[makeFile('new-file.txt', 'untracked')]}
        branchStats={{ totalFiles: 1, totalAdditions: 10, totalDeletions: 5 }}
        onFileSelect={onFileSelect}
        onChangedFileSelect={onChangedFileSelect}
      />
    );

    await user.click(screen.getByText('new-file.txt'));
    expect(onFileSelect).toHaveBeenCalledWith('new-file.txt');
    expect(onChangedFileSelect).not.toHaveBeenCalled();
  });

  it('calls onChangedFileSelect for non-untracked files', async () => {
    const onFileSelect = vi.fn();
    const onChangedFileSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <ChangesFileList
        {...defaultProps}
        allChanges={[makeFile('src/app.ts', 'modified')]}
        branchStats={{ totalFiles: 1, totalAdditions: 10, totalDeletions: 5 }}
        onFileSelect={onFileSelect}
        onChangedFileSelect={onChangedFileSelect}
      />
    );

    await user.click(screen.getByText('app.ts'));
    expect(onChangedFileSelect).toHaveBeenCalledWith('src/app.ts');
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('calls onChangesViewChange when toggling views', async () => {
    const onChangesViewChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ChangesFileList
        {...defaultProps}
        onChangesViewChange={onChangesViewChange}
      />
    );

    await user.click(screen.getByText('Uncommitted'));
    expect(onChangesViewChange).toHaveBeenCalledWith('uncommitted');
  });

  it('maps unknown file statuses to the modified group', () => {
    // Force an unknown status via type assertion to simulate unexpected backend data
    const files = [makeFile('renamed.ts', 'renamed' as FileChangeDTO['status'])];

    render(
      <ChangesFileList
        {...defaultProps}
        allChanges={files}
        branchStats={{ totalFiles: 1, totalAdditions: 10, totalDeletions: 5 }}
      />
    );

    // Should appear under MODIFIED group
    expect(screen.getByText('MODIFIED')).toBeInTheDocument();
    expect(screen.getByText('renamed.ts')).toBeInTheDocument();
  });

  it('sorts files alphabetically within each group', () => {
    const allChanges = [
      makeFile('src/z-file.ts', 'modified'),
      makeFile('src/a-file.ts', 'modified'),
      makeFile('src/m-file.ts', 'modified'),
    ];

    const { container } = render(
      <ChangesFileList
        {...defaultProps}
        allChanges={allChanges}
        branchStats={{ totalFiles: 3, totalAdditions: 30, totalDeletions: 15 }}
      />
    );

    const fileNames = Array.from(container.querySelectorAll('[class*="truncate"]'))
      .map(el => el.textContent)
      .filter(t => t && ['a-file.ts', 'm-file.ts', 'z-file.ts'].includes(t));

    expect(fileNames).toEqual(['a-file.ts', 'm-file.ts', 'z-file.ts']);
  });
});
