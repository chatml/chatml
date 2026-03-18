'use client';

import { useEffect, useState } from 'react';
import { File as PierreFile, PIERRE_THEMES } from '@/lib/pierre';
import type { FileContents, FileOptions } from '@/lib/pierre';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';

const WARMUP_FILE: FileContents = {
  name: 'warmup.ts',
  contents: 'const x = 1;',
  lang: 'typescript',
  cacheKey: 'pierre-warmup:ts',
};

/**
 * Renders a hidden Pierre <File> during idle time to trigger Shiki
 * initialization (engine, language grammars, themes) before the user
 * opens their first file/diff. Without this, the first Pierre render
 * pays a ~200-500ms cold-start and may flash with the wrong theme.
 *
 * Follows the same idle-warm-up pattern as markdownConfig.ts.
 * Self-destructs after the initial render completes.
 */
export function PierreWarmup() {
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const themeType = useResolvedThemeType();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const trigger = () => { if (!cancelled) setReady(true); };

    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(trigger, { timeout: 5000 });
    } else {
      timeoutHandle = setTimeout(trigger, 2000);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, []);

  // After Pierre renders once, self-destruct — we only need the side-effect.
  // Pierre's Shiki highlighter is a module-level singleton, so it persists
  // after unmount. We keep the component mounted for 500ms to give Pierre
  // time to finish any async language/theme loading.
  useEffect(() => {
    if (ready && !done) {
      const timerId = setTimeout(() => {
        setDone(true);
      }, 500);
      return () => clearTimeout(timerId);
    }
  }, [ready, done]);

  if (!ready || done) return null;

  const options: FileOptions<undefined> = {
    theme: PIERRE_THEMES,
    themeType,
    tokenizeMaxLineLength: 500,
  };

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      <PierreFile file={WARMUP_FILE} options={options} />
    </div>
  );
}
