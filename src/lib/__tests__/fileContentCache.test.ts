import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getFileContentFromCache,
  setFileContentInCache,
  invalidateFileContentCache,
  clearFileContentCache,
  MAX_ENTRIES,
} from '../fileContentCache';
import type { FileContentDTO } from '@/lib/api';

function makeFileContent(content: string): FileContentDTO {
  return { content, language: 'typescript', path: 'test.ts' } as FileContentDTO;
}

beforeEach(() => {
  clearFileContentCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Basic get/set
// ============================================================================

describe('basic get/set', () => {
  it('returns null for missing entry', () => {
    expect(getFileContentFromCache('w1', 's1', 'file.ts')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    const data = makeFileContent('hello');
    setFileContentInCache('w1', 's1', 'file.ts', data);
    expect(getFileContentFromCache('w1', 's1', 'file.ts')).toEqual(data);
  });

  it('isolates entries by workspace, session, and path', () => {
    const data1 = makeFileContent('one');
    const data2 = makeFileContent('two');
    setFileContentInCache('w1', 's1', 'a.ts', data1);
    setFileContentInCache('w1', 's2', 'a.ts', data2);
    expect(getFileContentFromCache('w1', 's1', 'a.ts')).toEqual(data1);
    expect(getFileContentFromCache('w1', 's2', 'a.ts')).toEqual(data2);
  });
});

// ============================================================================
// Expiration
// ============================================================================

describe('expiration', () => {
  it('returns null for expired entries (>5 min)', () => {
    setFileContentInCache('w1', 's1', 'file.ts', makeFileContent('data'));
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getFileContentFromCache('w1', 's1', 'file.ts')).toBeNull();
  });

  it('returns entry within TTL', () => {
    const data = makeFileContent('data');
    setFileContentInCache('w1', 's1', 'file.ts', data);
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(getFileContentFromCache('w1', 's1', 'file.ts')).toEqual(data);
  });
});

// ============================================================================
// LRU eviction
// ============================================================================

describe('LRU eviction', () => {
  it('evicts oldest entry when exceeding MAX_ENTRIES', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      setFileContentInCache('w1', 's1', `file${i}.ts`, makeFileContent(`content${i}`));
    }
    // All entries should exist
    expect(getFileContentFromCache('w1', 's1', 'file0.ts')).not.toBeNull();

    // Adding one more should evict the oldest (file0 — but we just accessed it via get, moving it to end)
    // Reset and re-fill without accessing file0
    clearFileContentCache();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      setFileContentInCache('w1', 's1', `file${i}.ts`, makeFileContent(`content${i}`));
    }
    // Add one more — should evict file0
    setFileContentInCache('w1', 's1', 'extra.ts', makeFileContent('extra'));
    expect(getFileContentFromCache('w1', 's1', 'file0.ts')).toBeNull();
    expect(getFileContentFromCache('w1', 's1', 'extra.ts')).not.toBeNull();
  });

  it('get refreshes LRU position', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      setFileContentInCache('w1', 's1', `file${i}.ts`, makeFileContent(`content${i}`));
    }
    // Access file0 to move it to end (most recent)
    getFileContentFromCache('w1', 's1', 'file0.ts');
    // Adding one more should evict file1 (now the oldest)
    setFileContentInCache('w1', 's1', 'extra.ts', makeFileContent('extra'));
    expect(getFileContentFromCache('w1', 's1', 'file0.ts')).not.toBeNull();
    expect(getFileContentFromCache('w1', 's1', 'file1.ts')).toBeNull();
  });
});

// ============================================================================
// Invalidation
// ============================================================================

describe('invalidation', () => {
  it('invalidates a specific file', () => {
    setFileContentInCache('w1', 's1', 'a.ts', makeFileContent('a'));
    setFileContentInCache('w1', 's1', 'b.ts', makeFileContent('b'));
    invalidateFileContentCache('w1', 's1', 'a.ts');
    expect(getFileContentFromCache('w1', 's1', 'a.ts')).toBeNull();
    expect(getFileContentFromCache('w1', 's1', 'b.ts')).not.toBeNull();
  });

  it('invalidates all entries for a session when no path given', () => {
    setFileContentInCache('w1', 's1', 'a.ts', makeFileContent('a'));
    setFileContentInCache('w1', 's1', 'b.ts', makeFileContent('b'));
    setFileContentInCache('w1', 's2', 'c.ts', makeFileContent('c'));
    invalidateFileContentCache('w1', 's1');
    expect(getFileContentFromCache('w1', 's1', 'a.ts')).toBeNull();
    expect(getFileContentFromCache('w1', 's1', 'b.ts')).toBeNull();
    expect(getFileContentFromCache('w1', 's2', 'c.ts')).not.toBeNull();
  });
});

// ============================================================================
// clearFileContentCache
// ============================================================================

describe('clearFileContentCache', () => {
  it('removes all entries', () => {
    setFileContentInCache('w1', 's1', 'a.ts', makeFileContent('a'));
    setFileContentInCache('w2', 's2', 'b.ts', makeFileContent('b'));
    clearFileContentCache();
    expect(getFileContentFromCache('w1', 's1', 'a.ts')).toBeNull();
    expect(getFileContentFromCache('w2', 's2', 'b.ts')).toBeNull();
  });
});
