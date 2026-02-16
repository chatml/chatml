import type { ReactNode } from 'react';

const MAX_CACHE_SIZE = 500;

interface CacheEntry {
  node: ReactNode;
  content: string | undefined;
}

const cache = new Map<string, CacheEntry>();

/**
 * Get a cached ReactNode by key, promoting it to most-recent for LRU.
 * When `content` is provided, validates that the cached entry matches —
 * returns undefined (cache miss) if the content has changed, preventing
 * stale renders when the same cache key is reused across conversations.
 */
export function getCachedMarkdown(key: string, content?: string): ReactNode | undefined {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;

  // If content provided and doesn't match, treat as cache miss
  if (content !== undefined && entry.content !== content) {
    cache.delete(key);
    return undefined;
  }

  // Promote to most-recent (delete + re-insert keeps Map insertion order)
  cache.delete(key);
  cache.set(key, entry);
  return entry.node;
}

/**
 * Store a rendered ReactNode. Evicts the oldest entry when over capacity.
 */
export function setCachedMarkdown(key: string, node: ReactNode, content?: string): void {
  // If key already exists, delete first so re-insert moves it to end
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, { node, content });

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
