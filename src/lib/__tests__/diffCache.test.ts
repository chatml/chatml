import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDiffFromCache,
  setDiffInCache,
  invalidateDiffCache,
  clearDiffCache,
  MAX_ENTRIES,
} from '../diffCache';
import type { FileDiffDTO } from '../api';

const makeDiff = (path: string): FileDiffDTO => ({
  path,
  oldContent: 'old',
  newContent: 'new',
  hunks: [],
} as unknown as FileDiffDTO);

describe('diffCache', () => {
  beforeEach(() => {
    clearDiffCache();
  });

  it('returns null for cache miss', () => {
    expect(getDiffFromCache('w1', 's1', 'file.ts')).toBeNull();
  });

  it('stores and retrieves a cached diff', () => {
    const diff = makeDiff('file.ts');
    setDiffInCache('w1', 's1', 'file.ts', diff);
    expect(getDiffFromCache('w1', 's1', 'file.ts')).toBe(diff);
  });

  it('returns null after entry expires', () => {
    const baseTime = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);

    const diff = makeDiff('file.ts');
    setDiffInCache('w1', 's1', 'file.ts', diff);

    // Advance time past the 5 minute TTL
    vi.mocked(Date.now).mockReturnValue(baseTime + 6 * 60 * 1000);
    expect(getDiffFromCache('w1', 's1', 'file.ts')).toBeNull();
    vi.restoreAllMocks();
  });

  it('invalidates a specific path', () => {
    setDiffInCache('w1', 's1', 'a.ts', makeDiff('a.ts'));
    setDiffInCache('w1', 's1', 'b.ts', makeDiff('b.ts'));

    invalidateDiffCache('w1', 's1', 'a.ts');

    expect(getDiffFromCache('w1', 's1', 'a.ts')).toBeNull();
    expect(getDiffFromCache('w1', 's1', 'b.ts')).not.toBeNull();
  });

  it('invalidates all entries for a session when no path given', () => {
    setDiffInCache('w1', 's1', 'a.ts', makeDiff('a.ts'));
    setDiffInCache('w1', 's1', 'b.ts', makeDiff('b.ts'));
    setDiffInCache('w1', 's2', 'c.ts', makeDiff('c.ts'));

    invalidateDiffCache('w1', 's1');

    expect(getDiffFromCache('w1', 's1', 'a.ts')).toBeNull();
    expect(getDiffFromCache('w1', 's1', 'b.ts')).toBeNull();
    expect(getDiffFromCache('w1', 's2', 'c.ts')).not.toBeNull();
  });

  it('clearDiffCache removes everything', () => {
    setDiffInCache('w1', 's1', 'a.ts', makeDiff('a.ts'));
    setDiffInCache('w2', 's2', 'b.ts', makeDiff('b.ts'));

    clearDiffCache();

    expect(getDiffFromCache('w1', 's1', 'a.ts')).toBeNull();
    expect(getDiffFromCache('w2', 's2', 'b.ts')).toBeNull();
  });

  it('evicts oldest entry when exceeding max size', () => {
    // Fill cache to MAX_ENTRIES
    for (let i = 0; i < MAX_ENTRIES; i++) {
      setDiffInCache('w1', 's1', `file${i}.ts`, makeDiff(`file${i}.ts`));
    }

    // Add one more — should evict file0.ts
    setDiffInCache('w1', 's1', 'overflow.ts', makeDiff('overflow.ts'));

    expect(getDiffFromCache('w1', 's1', 'file0.ts')).toBeNull();
    expect(getDiffFromCache('w1', 's1', 'overflow.ts')).not.toBeNull();
    // file1.ts should still be cached
    expect(getDiffFromCache('w1', 's1', 'file1.ts')).not.toBeNull();
  });

  it('LRU: accessing an entry moves it to the end', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      setDiffInCache('w1', 's1', `file${i}.ts`, makeDiff(`file${i}.ts`));
    }

    // Access file0.ts to move it to end (LRU refresh)
    getDiffFromCache('w1', 's1', 'file0.ts');

    // Add new entry — should evict file1.ts (now oldest), not file0.ts
    setDiffInCache('w1', 's1', 'new.ts', makeDiff('new.ts'));

    expect(getDiffFromCache('w1', 's1', 'file0.ts')).not.toBeNull();
    expect(getDiffFromCache('w1', 's1', 'file1.ts')).toBeNull();
  });
});
