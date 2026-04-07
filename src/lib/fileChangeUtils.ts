import type { ToolUsage } from '@/lib/types';

export interface TurnFileChange {
  path: string;
  basename: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified';
}

/**
 * Calculate line stats for an Edit tool call from its old_string / new_string params.
 */
export function calculateEditStats(params?: Record<string, unknown>): { additions: number; deletions: number } | null {
  if (!params) return null;

  const oldString = params.old_string as string | undefined;
  const newString = params.new_string as string | undefined;

  // Only calculate if we have at least one of the strings
  if (oldString === undefined && newString === undefined) return null;

  // Count lines in a string — strip trailing newline to avoid phantom line
  const countLines = (s: string | undefined) => {
    if (!s) return 0;
    const trimmed = s.endsWith('\n') ? s.slice(0, -1) : s;
    return trimmed.split('\n').length;
  };

  const oldLines = countLines(oldString);
  const newLines = countLines(newString);

  return {
    additions: Math.max(0, newLines - oldLines),
    deletions: Math.max(0, oldLines - newLines),
  };
}

const WRITE_TOOLS = new Set(['Write', 'write_file']);
const EDIT_TOOLS = new Set(['Edit', 'edit_file']);

/**
 * Extract and aggregate per-file change stats from a turn's tool usage.
 * Multiple edits to the same file are merged into a single entry.
 */
export function extractTurnFileChanges(toolUsage: ToolUsage[]): TurnFileChange[] {
  const byPath = new Map<string, TurnFileChange>();

  for (const tu of toolUsage) {
    const filePath = tu.params?.file_path as string | undefined;
    if (!filePath) continue;

    // Skip internal agent files (plans, memory, settings, etc.)
    if (filePath.includes('/.chatml/') || filePath.includes('/.claude/')) continue;

    if (WRITE_TOOLS.has(tu.tool)) {
      const content = tu.params?.content as string | undefined;
      const trimmed = content?.endsWith('\n') ? content.slice(0, -1) : content;
      const lineCount = trimmed ? trimmed.split('\n').length : 0;

      const existing = byPath.get(filePath);
      if (existing) {
        existing.additions += lineCount;
      } else {
        byPath.set(filePath, {
          path: filePath,
          basename: filePath.split('/').pop() ?? filePath,
          additions: lineCount,
          deletions: 0,
          status: 'added',
        });
      }
    } else if (EDIT_TOOLS.has(tu.tool)) {
      const stats = calculateEditStats(tu.params);
      const additions = stats?.additions ?? 0;
      const deletions = stats?.deletions ?? 0;

      const existing = byPath.get(filePath);
      if (existing) {
        existing.additions += additions;
        existing.deletions += deletions;
      } else {
        byPath.set(filePath, {
          path: filePath,
          basename: filePath.split('/').pop() ?? filePath,
          additions,
          deletions,
          status: 'modified',
        });
      }
    }
  }

  return Array.from(byPath.values());
}
