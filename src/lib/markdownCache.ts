import type { ReactNode } from 'react';

const MAX_CACHE_SIZE = 500;

const cache = new Map<string, ReactNode>();

/**
 * Get a cached ReactNode by key, promoting it to most-recent for LRU.
 */
export function getCachedMarkdown(key: string): ReactNode | undefined {
  const node = cache.get(key);
  if (node === undefined) return undefined;

  // Promote to most-recent (delete + re-insert keeps Map insertion order)
  cache.delete(key);
  cache.set(key, node);
  return node;
}

/**
 * Store a rendered ReactNode. Evicts the oldest entry when over capacity.
 */
export function setCachedMarkdown(key: string, node: ReactNode): void {
  // If key already exists, delete first so re-insert moves it to end
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, node);

  // Evict oldest (first entry) if over capacity
  if (cache.size > MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

/**
 * Clear all cached markdown nodes.
 */
export function clearMarkdownCache(): void {
  cache.clear();
}
