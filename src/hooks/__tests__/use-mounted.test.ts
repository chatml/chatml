import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMounted } from '../use-mounted';

describe('useMounted', () => {
  it('returns true after mount', () => {
    const { result } = renderHook(() => useMounted());
    // After the first render + effect, mounted is true
    expect(result.current).toBe(true);
  });

  it('returns true on subsequent renders', () => {
    const { result, rerender } = renderHook(() => useMounted());
    rerender();
    expect(result.current).toBe(true);
  });

  it('returns true across multiple instances', () => {
    const a = renderHook(() => useMounted());
    const b = renderHook(() => useMounted());
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);
  });
});
