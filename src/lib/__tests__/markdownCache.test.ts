import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedMarkdown, setCachedMarkdown, clearMarkdownCache } from '../markdownCache';

describe('markdownCache', () => {
  beforeEach(() => {
    clearMarkdownCache();
  });

  it('returns undefined for missing keys', () => {
    expect(getCachedMarkdown('missing')).toBeUndefined();
  });

  it('stores and retrieves cached nodes', () => {
    const node = 'rendered-node';
    setCachedMarkdown('key1', node, 'hello');
    expect(getCachedMarkdown('key1')).toBe(node);
  });

  it('returns cached node when content matches', () => {
    const node = 'rendered-node';
    setCachedMarkdown('key1', node, 'hello');
    expect(getCachedMarkdown('key1', 'hello')).toBe(node);
  });

  it('invalidates cache when content changes for same key', () => {
    const node = 'old-rendered-node';
    setCachedMarkdown('key1', node, 'old content');

    // Same key, different content → cache miss
    expect(getCachedMarkdown('key1', 'new content')).toBeUndefined();

    // Entry should be deleted after mismatch
    expect(getCachedMarkdown('key1')).toBeUndefined();
  });

  it('skips content validation when content param is omitted', () => {
    const node = 'rendered-node';
    setCachedMarkdown('key1', node, 'some content');

    // No content param → return cached regardless
    expect(getCachedMarkdown('key1')).toBe(node);
  });

  it('invalidates when stored without content but retrieved with content', () => {
    setCachedMarkdown('key1', 'node');

    // Stored without content tracking, so content validation cannot match
    expect(getCachedMarkdown('key1', 'anything')).toBeUndefined();
  });

  it('overwrites existing entry on set with new content', () => {
    setCachedMarkdown('key1', 'old-node', 'old');
    setCachedMarkdown('key1', 'new-node', 'new');

    expect(getCachedMarkdown('key1', 'new')).toBe('new-node');
    expect(getCachedMarkdown('key1', 'old')).toBeUndefined();
  });

  it('evicts oldest entry when over capacity', () => {
    // Fill cache to capacity (MAX_CACHE_SIZE = 500)
    for (let i = 0; i < 501; i++) {
      setCachedMarkdown(`key-${i}`, `node-${i}`, `content-${i}`);
    }

    // Oldest entry should be evicted
    expect(getCachedMarkdown('key-0')).toBeUndefined();
    // Newest should still exist
    expect(getCachedMarkdown('key-500', 'content-500')).toBe('node-500');
  });
});
