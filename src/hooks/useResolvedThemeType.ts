'use client';

import { useTheme } from 'next-themes';

/**
 * Returns 'dark' | 'light' with a synchronous DOM fallback for the
 * pre-hydration render where next-themes returns undefined.
 *
 * ThemeScript applies the 'dark' class to <html> synchronously in <head>,
 * so document.documentElement.classList is always correct by the time
 * any component renders.
 */
export function useResolvedThemeType(): 'dark' | 'light' {
  const { resolvedTheme } = useTheme();

  if (resolvedTheme === 'dark' || resolvedTheme === 'light') {
    return resolvedTheme;
  }

  // Fallback: read the class that ThemeScript applied synchronously
  if (typeof document !== 'undefined') {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }

  return 'dark';
}
