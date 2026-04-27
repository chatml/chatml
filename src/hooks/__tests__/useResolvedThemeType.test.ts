import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useResolvedThemeType } from '../useResolvedThemeType';

let mockResolvedTheme: string | undefined = 'dark';

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: mockResolvedTheme }),
}));

describe('useResolvedThemeType', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it("returns 'dark' when next-themes reports 'dark'", () => {
    mockResolvedTheme = 'dark';
    const { result } = renderHook(() => useResolvedThemeType());
    expect(result.current).toBe('dark');
  });

  it("returns 'light' when next-themes reports 'light'", () => {
    mockResolvedTheme = 'light';
    const { result } = renderHook(() => useResolvedThemeType());
    expect(result.current).toBe('light');
  });

  it("falls back to DOM .dark class when next-themes is undefined", () => {
    mockResolvedTheme = undefined;
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useResolvedThemeType());
    expect(result.current).toBe('dark');
  });

  it("falls back to 'light' when neither resolvedTheme nor .dark class is set", () => {
    mockResolvedTheme = undefined;
    document.documentElement.classList.remove('dark');
    const { result } = renderHook(() => useResolvedThemeType());
    expect(result.current).toBe('light');
  });

  it('ignores unrecognized resolvedTheme values', () => {
    mockResolvedTheme = 'system' as never;
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useResolvedThemeType());
    expect(result.current).toBe('dark');
  });
});
