import type { FileChangeDTO } from '@/lib/api/git';

export type FileStatus = 'added' | 'modified' | 'deleted' | 'untracked';

/**
 * Build a map from file path to its git change status.
 * Merges both uncommitted and all-branch changes into a single map.
 */
export function buildStatusMap(
  changes: FileChangeDTO[],
  allChanges: FileChangeDTO[],
): Map<string, FileStatus> {
  const map = new Map<string, FileStatus>();
  // allChanges first so uncommitted changes (more recent) override
  for (const c of allChanges) {
    map.set(c.path, c.status);
  }
  for (const c of changes) {
    map.set(c.path, c.status);
  }
  return map;
}

/**
 * Build a map from folder path to the count of changed files inside.
 * Walks up parent directories for each changed file to accumulate counts.
 */
export function buildFolderIndicators(
  changes: FileChangeDTO[],
  allChanges: FileChangeDTO[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const seenPaths = new Set<string>();

  // Combine unique paths from both change sets
  for (const c of allChanges) seenPaths.add(c.path);
  for (const c of changes) seenPaths.add(c.path);

  for (const filePath of seenPaths) {
    const parts = filePath.split('/');
    // Walk up parent directories (excluding the file itself)
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join('/');
      counts.set(parentPath, (counts.get(parentPath) ?? 0) + 1);
    }
  }

  return counts;
}

/** CSS class name for a git file status color */
export function statusColorClass(status: FileStatus): string {
  switch (status) {
    case 'added': return 'text-emerald-500';
    case 'modified': return 'text-amber-500';
    case 'deleted': return 'text-red-500';
    case 'untracked': return 'text-muted-foreground';
  }
}

/** Dot indicator color class for folder change propagation */
export function statusDotClass(status: FileStatus): string {
  switch (status) {
    case 'added': return 'bg-emerald-500';
    case 'modified': return 'bg-amber-500';
    case 'deleted': return 'bg-red-500';
    case 'untracked': return 'bg-muted-foreground';
  }
}
