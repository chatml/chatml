import type { FileDiffDTO } from '@/lib/api';

interface CacheEntry {
  data: FileDiffDTO;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 5 * 60 * 1000; // 5 min — staleness handled by explicit invalidation

function makeKey(workspaceId: string, sessionId: string, path: string): string {
  return `${workspaceId}:${sessionId}:${path}`;
}

export function getDiffFromCache(
  workspaceId: string,
  sessionId: string,
  path: string
): FileDiffDTO | null {
  const key = makeKey(workspaceId, sessionId, path);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > MAX_AGE_MS) {
    cache.delete(key);
    return null;
  }
  // Move to end for LRU ordering
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

export function setDiffInCache(
  workspaceId: string,
  sessionId: string,
  path: string,
  data: FileDiffDTO
): void {
  const key = makeKey(workspaceId, sessionId, path);
  cache.delete(key); // Remove if exists (for LRU reorder)
  cache.set(key, { data, cachedAt: Date.now() });
  // Evict oldest if over limit
  if (cache.size > MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export function invalidateDiffCache(
  workspaceId: string,
  sessionId: string,
  path?: string
): void {
  if (path) {
    cache.delete(makeKey(workspaceId, sessionId, path));
  } else {
    // Invalidate all entries for this session
    const prefix = `${workspaceId}:${sessionId}:`;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  }
}

export function clearDiffCache(): void {
  cache.clear();
}
