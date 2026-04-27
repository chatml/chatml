/**
 * Per-session cache for Checks panel data (PR details + CI runs).
 *
 * Mirrors sessionDataCache.ts: stale-while-revalidate placeholder so switching
 * sessions doesn't flash empty UI while the background fetch is in flight.
 *
 * No TTL — callers always revalidate; cached data is just a render hint.
 */

import type { PRDetails, WorkflowRunDTO } from '@/lib/api';

export interface ChecksCacheEntry {
  prDetails?: PRDetails | null;
  runs?: WorkflowRunDTO[];
}

const cache = new Map<string, ChecksCacheEntry>();
const MAX_SESSIONS = 10;

function makeKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

export function getChecksData(
  workspaceId: string,
  sessionId: string,
): ChecksCacheEntry | null {
  const key = makeKey(workspaceId, sessionId);
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setChecksData(
  workspaceId: string,
  sessionId: string,
  patch: Partial<ChecksCacheEntry>,
): void {
  const key = makeKey(workspaceId, sessionId);
  const existing = cache.get(key) ?? {};
  cache.delete(key);
  cache.set(key, { ...existing, ...patch });
  if (cache.size > MAX_SESSIONS) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export function invalidateChecksData(
  workspaceId: string,
  sessionId: string,
): void {
  cache.delete(makeKey(workspaceId, sessionId));
}

export function clearChecksDataCache(): void {
  cache.clear();
}
