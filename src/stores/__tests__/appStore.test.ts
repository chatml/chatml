import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore - lastFileChange', () => {
  beforeEach(() => {
    // Reset lastFileChange to initial state
    useAppStore.setState({ lastFileChange: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial value is null', () => {
    expect(useAppStore.getState().lastFileChange).toBeNull();
  });

  it('setLastFileChange sets event with timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    useAppStore.getState().setLastFileChange({
      workspaceId: 'ws-1',
      path: 'src/file.ts',
      fullPath: '/full/path/src/file.ts',
    });

    const result = useAppStore.getState().lastFileChange;
    expect(result).toEqual({
      workspaceId: 'ws-1',
      path: 'src/file.ts',
      fullPath: '/full/path/src/file.ts',
      timestamp: Date.now(),
    });
  });

  it('setLastFileChange overwrites previous value', () => {
    useAppStore.getState().setLastFileChange({
      workspaceId: 'ws-1',
      path: 'first.ts',
      fullPath: '/first.ts',
    });

    useAppStore.getState().setLastFileChange({
      workspaceId: 'ws-2',
      path: 'second.ts',
      fullPath: '/second.ts',
    });

    const result = useAppStore.getState().lastFileChange;
    expect(result?.workspaceId).toBe('ws-2');
    expect(result?.path).toBe('second.ts');
  });

  it('setLastFileChange adds timestamp automatically', () => {
    const before = Date.now();

    useAppStore.getState().setLastFileChange({
      workspaceId: 'ws-1',
      path: 'file.ts',
      fullPath: '/file.ts',
    });

    const after = Date.now();
    const result = useAppStore.getState().lastFileChange;
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('appStore - lastStatsInvalidation', () => {
  beforeEach(() => {
    useAppStore.setState({ lastStatsInvalidation: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial value is null', () => {
    expect(useAppStore.getState().lastStatsInvalidation).toBeNull();
  });

  it('setLastStatsInvalidation sets sessionId with timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    useAppStore.getState().setLastStatsInvalidation('session-1');

    const result = useAppStore.getState().lastStatsInvalidation;
    expect(result).toEqual({
      sessionId: 'session-1',
      timestamp: Date.now(),
    });
  });

  it('setLastStatsInvalidation overwrites previous value', () => {
    useAppStore.getState().setLastStatsInvalidation('session-1');
    useAppStore.getState().setLastStatsInvalidation('session-2');

    const result = useAppStore.getState().lastStatsInvalidation;
    expect(result?.sessionId).toBe('session-2');
  });

  it('setLastStatsInvalidation adds timestamp automatically', () => {
    const before = Date.now();

    useAppStore.getState().setLastStatsInvalidation('session-1');

    const after = Date.now();
    const result = useAppStore.getState().lastStatsInvalidation;
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp).toBeLessThanOrEqual(after);
  });
});
