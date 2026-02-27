/**
 * Lightweight per-session data cache for stale-while-revalidate pattern.
 *
 * When switching between sessions, cached data is shown instantly while
 * fresh data is fetched in the background. This eliminates the loading
 * flash when switching back to a previously-visited session.
 *
 * No TTL — callers always revalidate in the background; cached data is
 * simply a placeholder to avoid showing a loading spinner.
 *
 * Follows the same LRU Map pattern as diffCache.ts.
 */

import type { FileChangeDTO, BranchStatsDTO } from '@/lib/api';
import type { FileNode } from '@/components/files/FileTree';

export interface SessionCacheEntry {
  files: FileNode[];
  changes: FileChangeDTO[];
  allChanges: FileChangeDTO[];
  branchStats: BranchStatsDTO | null;
}

const cache = new Map<string, SessionCacheEntry>();
const MAX_SESSIONS = 10;

function makeKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

export function getSessionData(
  workspaceId: string,
  sessionId: string,
): SessionCacheEntry | null {
  const key = makeKey(workspaceId, sessionId);
  const entry = cache.get(key);
  if (!entry) return null;
  // Move to end for LRU ordering
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setSessionData(
  workspaceId: string,
  sessionId: string,
  data: SessionCacheEntry,
): void {
  const key = makeKey(workspaceId, sessionId);
  cache.delete(key); // Remove if exists (for LRU reorder)
  cache.set(key, data);
  // Evict oldest if over limit
  if (cache.size > MAX_SESSIONS) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export function invalidateSessionData(
  workspaceId: string,
  sessionId: string,
): void {
  cache.delete(makeKey(workspaceId, sessionId));
}

export function clearSessionDataCache(): void {
  cache.clear();
}
